import type { ChatInputCommandInteraction } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubFetch, type FetchMock } from '../../../testkit/fetch';

let fetchMock: FetchMock;

const isAdminMock = vi.fn();
const getGuildApiKeyMock = vi.fn();
const upsertGuildApiKeyMock = vi.fn();

vi.mock('@/bot/handlers/sage-command-handlers', () => ({
  isAdmin: isAdminMock,
}));

vi.mock('@/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: getGuildApiKeyMock,
  upsertGuildApiKey: upsertGuildApiKeyMock,
}));

function createInteraction(
  overrides: Partial<ChatInputCommandInteraction> = {},
): ChatInputCommandInteraction {
  return {
    guildId: 'guild-1',
    options: {
      getString: vi.fn().mockReturnValue('sk_validkey1234'),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
}

describe('key command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = stubFetch();
    isAdminMock.mockReturnValue(true);
  });

  it('normalizes invalid profile timeout inputs to safe bounds', async () => {
    const { resolveProfileTimeoutMs } = await import('@/bot/commands/api-key-handlers');

    expect(resolveProfileTimeoutMs(undefined)).toBe(30_000);
    expect(resolveProfileTimeoutMs(Number.NaN)).toBe(30_000);
    expect(resolveProfileTimeoutMs(0)).toBe(30_000);
    expect(resolveProfileTimeoutMs(999)).toBe(30_000);
    expect(resolveProfileTimeoutMs(4_500.9)).toBe(4_500);
    expect(resolveProfileTimeoutMs(999_999)).toBe(120_000);
  });

  it('includes zero pollen balance when setting a key', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: 'alice', credits: 0 }),
    } satisfies { ok: boolean; json: () => Promise<unknown> });

    const interaction = createInteraction();
    const { handleKeySet } = await import('@/bot/commands/api-key-handlers');

    await handleKeySet(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Balance: 0 pollen'),
    );
  });

  it('accepts profile payloads without id/username during key verification', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ credits: 9 }),
    } satisfies { ok: boolean; json: () => Promise<unknown> });

    const interaction = createInteraction();
    const { handleKeySet } = await import('@/bot/commands/api-key-handlers');

    await handleKeySet(interaction);

    expect(upsertGuildApiKeyMock).toHaveBeenCalledWith('guild-1', 'sk_validkey1234');
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Account: Verified (Balance: 9 pollen)'),
    );
  });

  it('accepts nested profile identity fields during key verification', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { username: 'alice', credits: 3 } }),
    } satisfies { ok: boolean; json: () => Promise<unknown> });

    const interaction = createInteraction();
    const { handleKeySet } = await import('@/bot/commands/api-key-handlers');

    await handleKeySet(interaction);

    expect(upsertGuildApiKeyMock).toHaveBeenCalledWith('guild-1', 'sk_validkey1234');
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Account: alice (Balance: 3 pollen)'),
    );
  });

  it('rejects unauthorized keys with actionable invalid/expired guidance', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ success: false }),
    } satisfies { ok: boolean; status: number; json: () => Promise<unknown> });

    const interaction = createInteraction();
    const { handleKeySet } = await import('@/bot/commands/api-key-handlers');

    await handleKeySet(interaction);

    expect(upsertGuildApiKeyMock).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('invalid or expired'),
    );
  });

  it('rejects timed-out verification attempts with retry guidance', async () => {
    const timeoutError = new Error('aborted');
    timeoutError.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(timeoutError);

    const interaction = createInteraction();
    const { handleKeySet } = await import('@/bot/commands/api-key-handlers');

    await handleKeySet(interaction);

    expect(upsertGuildApiKeyMock).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
    );
  });

  it('rejects non-object profile payloads as invalid verification responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ['not-an-object'],
    } satisfies { ok: boolean; json: () => Promise<unknown> });

    const interaction = createInteraction();
    const { handleKeySet } = await import('@/bot/commands/api-key-handlers');

    await handleKeySet(interaction);

    expect(upsertGuildApiKeyMock).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('unexpected verification response'),
    );
  });

  it('trims API key input before storing it', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: 'alice', credits: 3 }),
    } satisfies { ok: boolean; json: () => Promise<unknown> });

    const interaction = createInteraction();
    const getStringMock = interaction.options.getString as unknown as ReturnType<typeof vi.fn>;
    getStringMock.mockReturnValue('   sk_validkey1234   ');
    const { handleKeySet } = await import('@/bot/commands/api-key-handlers');

    await handleKeySet(interaction);

    expect(upsertGuildApiKeyMock).toHaveBeenCalledWith('guild-1', 'sk_validkey1234');
  });

  it('denies key status checks for non-admin users', async () => {
    isAdminMock.mockReturnValue(false);

    const interaction = createInteraction();
    const { handleKeyCheck } = await import('@/bot/commands/api-key-handlers');

    await handleKeyCheck(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '❌ Only server admins can check the API key.',
        ephemeral: true,
      }),
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('formats key status output on one line per field', async () => {
    getGuildApiKeyMock.mockResolvedValue('sk_abcdefgh12345678');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: 'alice', credits: 7 }),
    } satisfies { ok: boolean; json: () => Promise<unknown> });

    const interaction = createInteraction();
    const { handleKeyCheck } = await import('@/bot/commands/api-key-handlers');

    await handleKeyCheck(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('- **Key**: sk_a...5678\n- **Account**: alice\n- **Balance**: 7 pollen'),
    );
  });

  it('treats profile checks as verified when profile object has no identity fields', async () => {
    getGuildApiKeyMock.mockResolvedValue('sk_abcdefgh12345678');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ credits: 0 }),
    } satisfies { ok: boolean; json: () => Promise<unknown> });

    const interaction = createInteraction();
    const { handleKeyCheck } = await import('@/bot/commands/api-key-handlers');

    await handleKeyCheck(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('- **Key**: sk_a...5678\n- **Account**: Verified\n- **Balance**: 0 pollen'),
    );
  });
});

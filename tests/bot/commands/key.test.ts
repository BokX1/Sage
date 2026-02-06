import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const isAdminMock = vi.fn();
const getGuildApiKeyMock = vi.fn();
const upsertGuildApiKeyMock = vi.fn();

vi.mock('../../../src/bot/handlers/sage-command-handlers', () => ({
  isAdmin: isAdminMock,
}));

vi.mock('../../../src/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: getGuildApiKeyMock,
  upsertGuildApiKey: upsertGuildApiKeyMock,
}));

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createInteraction(overrides: Record<string, unknown> = {}) {
  return {
    guildId: 'guild-1',
    options: {
      getString: vi.fn().mockReturnValue('sk_validkey1234'),
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    ...overrides,
  };
}

describe('key command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdminMock.mockReturnValue(true);
  });

  it('includes zero pollen balance when setting a key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'alice', credits: 0 }),
    });

    const interaction = createInteraction();
    const { handleKeySet } = await import('../../../src/bot/commands/api-key-handlers');

    await handleKeySet(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Balance: 0 pollen'),
    );
  });

  it('formats key status output on one line per field', async () => {
    getGuildApiKeyMock.mockResolvedValue('sk_abcdefgh12345678');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'alice', credits: 7 }),
    });

    const interaction = createInteraction();
    const { handleKeyCheck } = await import('../../../src/bot/commands/api-key-handlers');

    await handleKeyCheck(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('- **Key**: sk_a...5678\n- **Account**: alice\n- **Balance**: 7 pollen'),
    );
  });
});

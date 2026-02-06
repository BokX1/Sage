import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from 'discord.js';

const onMock = vi.fn();

vi.mock('../../../src/bot/client', () => ({
  client: {
    on: onMock,
    listenerCount: vi.fn().mockReturnValue(1),
  },
}));

const logger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
};

vi.mock('../../../src/core/utils/logger', () => ({ logger }));
vi.mock('../../../src/core/llm', () => ({
  getLLMClient: vi.fn(),
}));
vi.mock('../../../src/core/config/legacy-config-adapter', () => ({
  config: { llmProvider: 'pollinations' },
}));
vi.mock('../../../src/bot/handlers/sage-command-handlers', () => ({
  isAdmin: vi.fn().mockReturnValue(false),
  handleAdminRelationshipGraph: vi.fn(),
  handleAdminStats: vi.fn(),
  handleAdminSummarize: vi.fn(),
  handleAdminTrace: vi.fn(),
  handleRelationshipSet: vi.fn(),
  handleWhoiswho: vi.fn(),
}));
vi.mock('../../../src/bot/commands/api-key-handlers', () => ({
  handleKeyCheck: vi.fn(),
  handleKeyClear: vi.fn(),
  handleKeyLogin: vi.fn(),
  handleKeySet: vi.fn(),
}));
vi.mock('../../../src/bot/commands/voice-channel-handlers', () => ({
  handleJoinCommand: vi.fn(),
  handleLeaveCommand: vi.fn(),
}));

describe('interactionCreate handler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const registrationKey = Symbol.for('sage.handlers.interactionCreate.registered');
    delete (globalThis as any)[registrationKey];
  });

  it('rejects /llm_ping for non-admin users', async () => {
    const { registerInteractionCreateHandler } = await import('../../../src/bot/handlers/interactionCreate');
    registerInteractionCreateHandler();

    expect(onMock).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    const handler = onMock.mock.calls[0][1] as (interaction: any) => Promise<void>;

    const reply = vi.fn().mockResolvedValue(undefined);
    await handler({
      isChatInputCommand: () => true,
      commandName: 'llm_ping',
      reply,
    });

    expect(reply).toHaveBeenCalledWith({ content: '❌ Admin only.', ephemeral: true });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from 'discord.js';

const mockRegisterCommands = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockBackfillChannelHistory = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/bot/commands/slash-command-registry', () => ({
  registerCommands: mockRegisterCommands,
}));

vi.mock('../../../src/core/ingest/historyBackfill', () => ({
  backfillChannelHistory: mockBackfillChannelHistory,
}));

vi.mock('../../../src/core/utils/logger', () => ({
  logger: mockLogger,
}));

vi.mock('../../../src/config', () => ({
  config: {
    NODE_ENV: 'test',
    CONTEXT_TRANSCRIPT_MAX_MESSAGES: 12,
  },
}));

import { registerReadyHandler } from '../../../src/bot/handlers/ready';

describe('ready handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterCommands.mockResolvedValue(undefined);
    mockBackfillChannelHistory.mockResolvedValue(undefined);
    const readyKey = Symbol.for('sage.handlers.ready');
    delete (globalThis as { [key: symbol]: boolean })[readyKey];
  });

  it('continues startup backfill when slash command registration fails', async () => {
    mockRegisterCommands.mockRejectedValue(new Error('discord rest timeout'));

    let readyCallback: ((client: any) => Promise<void>) | null = null;

    const fakeBotClient = {
      once: vi.fn((event: Events, callback: typeof readyCallback) => {
        if (event === Events.ClientReady) {
          readyCallback = callback;
        }
      }),
    };

    registerReadyHandler(fakeBotClient as never);
    expect(fakeBotClient.once).toHaveBeenCalledWith(Events.ClientReady, expect.any(Function));
    expect(readyCallback).not.toBeNull();

    const allChannels = new Map<string, { isTextBased: () => boolean; isDMBased: () => boolean }>([
      ['ch-1', { isTextBased: () => true, isDMBased: () => false }],
      ['ch-2', { isTextBased: () => true, isDMBased: () => false }],
      ['dm-1', { isTextBased: () => true, isDMBased: () => true }],
    ]);

    const readyDiscordClient = {
      user: { tag: 'sage#0001' },
      guilds: {
        cache: new Map<string, { id: string }>([
          ['guild-1', { id: 'guild-1' }],
          ['guild-2', { id: 'guild-2' }],
        ]),
      },
      channels: {
        cache: {
          filter: (
            predicate: (channel: { isTextBased: () => boolean; isDMBased: () => boolean }) => boolean,
          ) =>
            new Map<string, { isTextBased: () => boolean; isDMBased: () => boolean }>(
              [...allChannels.entries()].filter(([, channel]) => predicate(channel)),
            ),
        },
      },
    };

    await readyCallback?.(readyDiscordClient);

    expect(mockRegisterCommands).toHaveBeenCalledTimes(1);
    expect(mockRegisterCommands).toHaveBeenCalledWith({
      knownGuildIds: ['guild-1', 'guild-2'],
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Slash command registration failed; continuing startup initialization',
    );
    expect(mockBackfillChannelHistory).toHaveBeenCalledTimes(2);
    expect(mockBackfillChannelHistory).toHaveBeenCalledWith('ch-1', 12);
    expect(mockBackfillChannelHistory).toHaveBeenCalledWith('ch-2', 12);
  });
});

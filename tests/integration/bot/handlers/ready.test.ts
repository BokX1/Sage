import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events, type Client } from 'discord.js';

const mockRegisterCommands = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockBackfillChannelHistory = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/bot/commands/slash-command-registry', () => ({
  registerCommands: mockRegisterCommands,
}));

vi.mock('@/core/ingest/historyBackfill', () => ({
  backfillChannelHistory: mockBackfillChannelHistory,
}));

vi.mock('@/config', () => ({
  config: {
    NODE_ENV: 'test',
    CONTEXT_TRANSCRIPT_MAX_MESSAGES: 12,
  },
}));

import { registerReadyHandler } from '@/bot/handlers/ready';
import { logger } from '@/core/utils/logger';

describe('ready handler', () => {
  beforeEach(() => {
    mockRegisterCommands.mockResolvedValue(undefined);
    mockBackfillChannelHistory.mockResolvedValue(undefined);
    const readyKey = Symbol.for('sage.handlers.ready');
    const g = globalThis as unknown as { [key: symbol]: unknown };
    delete g[readyKey];
  });

  it('continues startup backfill when slash command registration fails', async () => {
    mockRegisterCommands.mockRejectedValue(new Error('discord rest timeout'));

    type ChannelStub = { isTextBased: () => boolean; isDMBased: () => boolean };
    type ReadyClientStub = {
      user: { tag: string };
      guilds: { cache: Map<string, { id: string }> };
      channels: { cache: { filter: (predicate: (channel: ChannelStub) => boolean) => Map<string, ChannelStub> } };
    };

    const fakeBotClient = {
      once: vi.fn(),
    };

    registerReadyHandler(fakeBotClient as unknown as Client);
    expect(fakeBotClient.once).toHaveBeenCalledWith(Events.ClientReady, expect.any(Function));

    const readyCallback = fakeBotClient.once.mock.calls.find(
      ([event]) => event === Events.ClientReady,
    )?.[1];

    const allChannels = new Map<string, ChannelStub>([
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
            predicate: (channel: ChannelStub) => boolean,
          ) =>
            new Map<string, ChannelStub>(
              [...allChannels.entries()].filter(([, channel]) => predicate(channel)),
            ),
        },
      },
    };

    if (!readyCallback) {
      throw new Error('Expected ready callback to be registered');
    }

    await (readyCallback as (client: ReadyClientStub) => Promise<void>)(readyDiscordClient);

    expect(mockRegisterCommands).toHaveBeenCalledTimes(1);
    expect(mockRegisterCommands).toHaveBeenCalledWith({
      knownGuildIds: ['guild-1', 'guild-2'],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Slash command registration failed; continuing startup initialization',
    );
    expect(mockBackfillChannelHistory).toHaveBeenCalledTimes(2);
    expect(mockBackfillChannelHistory).toHaveBeenCalledWith('ch-1', 12);
    expect(mockBackfillChannelHistory).toHaveBeenCalledWith('ch-2', 12);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events, type Client } from 'discord.js';

const mockBackfillChannelHistory = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/app/discord/historyBackfill', () => ({
  backfillChannelHistory: mockBackfillChannelHistory,
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    NODE_ENV: 'test',
    CONTEXT_TRANSCRIPT_MAX_MESSAGES: 12,
  },
}));

import { registerReadyHandler } from '@/app/discord/handlers/ready';

describe('ready handler', () => {
  beforeEach(() => {
    mockBackfillChannelHistory.mockResolvedValue(undefined);
    const readyKey = Symbol.for('sage.handlers.ready');
    const g = globalThis as unknown as { [key: symbol]: unknown };
    delete g[readyKey];
  });

  it('clears legacy application commands before startup backfill', async () => {
    type ChannelStub = { isTextBased: () => boolean; isDMBased: () => boolean };
    const setGlobalCommands = vi.fn().mockResolvedValue([]);
    const setGuildOneCommands = vi.fn().mockResolvedValue([]);
    const setGuildTwoCommands = vi.fn().mockResolvedValue([]);
    type ReadyClientStub = {
      user: { tag: string };
      application: { commands: { set: typeof setGlobalCommands } };
      guilds: { cache: Map<string, { id: string; commands: { set: typeof setGuildOneCommands } }> };
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
      application: {
        commands: {
          set: setGlobalCommands,
        },
      },
      guilds: {
        cache: new Map([
          ['guild-1', { id: 'guild-1', commands: { set: setGuildOneCommands } }],
          ['guild-2', { id: 'guild-2', commands: { set: setGuildTwoCommands } }],
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

    expect(setGlobalCommands).toHaveBeenCalledWith([]);
    expect(setGuildOneCommands).toHaveBeenCalledWith([]);
    expect(setGuildTwoCommands).toHaveBeenCalledWith([]);
    expect(mockBackfillChannelHistory).toHaveBeenCalledTimes(2);
    expect(mockBackfillChannelHistory).toHaveBeenCalledWith('ch-1', 12);
    expect(mockBackfillChannelHistory).toHaveBeenCalledWith('ch-2', 12);
  });
});

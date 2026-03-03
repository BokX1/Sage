/**
 * @module tests/integration/bot/handlers/guildCreate.test
 * @description Defines the guild create.test module.
 */
import type { Client, Guild, TextChannel } from 'discord.js';
import { ChannelType, Events } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGuildCreate, registerGuildCreateHandler } from '@/bot/handlers/guildCreate';

describe('guildCreate handler', () => {
  beforeEach(() => {
    const registrationKey = Symbol.for('sage.handlers.guildCreate.registered');
    const g = globalThis as unknown as { [key: symbol]: unknown };
    delete g[registrationKey];
  });

  it('registers only one GuildCreate listener', () => {
    const on = vi.fn();
    const listenerCount = vi.fn().mockReturnValue(1);
    const client = { on, listenerCount } as unknown as Client;

    registerGuildCreateHandler(client);
    registerGuildCreateHandler(client);

    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith(Events.GuildCreate, expect.any(Function));
  });

  it('uses a fallback text channel when member cache is unavailable', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fallbackChannel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      permissionsFor: vi.fn(),
      send,
    } as unknown as TextChannel;

    const guild = {
      id: 'guild-1',
      name: 'Guild One',
      systemChannel: null,
      members: { me: null },
      channels: {
        cache: {
          find: (predicate: (channel: TextChannel) => boolean) =>
            predicate(fallbackChannel) ? fallbackChannel : undefined,
        },
      },
    } as unknown as Guild;

    await handleGuildCreate(guild);

    expect(send).toHaveBeenCalledTimes(1);
  });
});

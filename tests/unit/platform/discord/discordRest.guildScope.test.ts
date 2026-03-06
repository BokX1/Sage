import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubFetch, type FetchMock } from '../../../testkit/fetch';
import { discordRestRequestGuildScoped } from '@/platform/discord/discordRestPolicy';

function makeHeaders(values: Record<string, string>): { get: (name: string) => string | null } {
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    lower.set(key.toLowerCase(), value);
  }
  return {
    get: (name: string) => lower.get(name.toLowerCase()) ?? null,
  };
}

describe('discordRestRequestGuildScoped', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock = stubFetch();
    fetchMock.mockReset();
  });

  it('allows /guilds/{guildId} routes in the active guild', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: makeHeaders({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ id: 'guild-1' }),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      headers: { get: (name: string) => string | null };
      text: () => Promise<string>;
    });

    const result = await discordRestRequestGuildScoped({
      guildId: 'guild-1',
      method: 'GET',
      path: '/guilds/guild-1',
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks cross-guild /guilds routes', async () => {
    await expect(
      discordRestRequestGuildScoped({
        guildId: 'guild-1',
        method: 'GET',
        path: '/guilds/guild-2/channels',
      }),
    ).rejects.toThrow(/cross-guild/i);

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('allows /channels/{channelId} routes when the channel belongs to the active guild', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url === 'https://discord.com/api/v10/channels/channel-allow-1') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: makeHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'channel-allow-1', guild_id: 'guild-1' }),
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          headers: { get: (name: string) => string | null };
          text: () => Promise<string>;
        };
      }
      if (url === 'https://discord.com/api/v10/channels/channel-allow-1/messages') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: makeHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ ok: true }),
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          headers: { get: (name: string) => string | null };
          text: () => Promise<string>;
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await discordRestRequestGuildScoped({
      guildId: 'guild-1',
      method: 'GET',
      path: '/channels/channel-allow-1/messages',
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks /channels/{channelId} routes when the channel is in another guild', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: makeHeaders({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ id: 'channel-deny-1', guild_id: 'guild-2' }),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      headers: { get: (name: string) => string | null };
      text: () => Promise<string>;
    });

    await expect(
      discordRestRequestGuildScoped({
        guildId: 'guild-1',
        method: 'GET',
        path: '/channels/channel-deny-1/messages',
      }),
    ).rejects.toThrow(/cross-guild/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks /channels/{channelId} routes for DM channels (missing guild_id)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: makeHeaders({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ id: 'channel-dm-1', type: 1 }),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      headers: { get: (name: string) => string | null };
      text: () => Promise<string>;
    });

    await expect(
      discordRestRequestGuildScoped({
        guildId: 'guild-1',
        method: 'GET',
        path: '/channels/channel-dm-1/messages',
      }),
    ).rejects.toThrow(/dm/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows /stage-instances/{channelId} routes when the channel belongs to the active guild', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url === 'https://discord.com/api/v10/channels/channel-stage-1') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: makeHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'channel-stage-1', guild_id: 'guild-1' }),
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          headers: { get: (name: string) => string | null };
          text: () => Promise<string>;
        };
      }
      if (url === 'https://discord.com/api/v10/stage-instances/channel-stage-1') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: makeHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'stage-1' }),
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          headers: { get: (name: string) => string | null };
          text: () => Promise<string>;
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await discordRestRequestGuildScoped({
      guildId: 'guild-1',
      method: 'GET',
      path: '/stage-instances/channel-stage-1',
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks direct /webhooks routes', async () => {
    await expect(
      discordRestRequestGuildScoped({
        guildId: 'guild-1',
        method: 'GET',
        path: '/webhooks/123/secret',
      }),
    ).rejects.toThrow(/webhooks/i);

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('blocks bot-wide endpoints (for example /users/@me)', async () => {
    await expect(
      discordRestRequestGuildScoped({
        guildId: 'guild-1',
        method: 'DELETE',
        path: '/users/@me',
      }),
    ).rejects.toThrow(/restricted/i);

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('blocks dot-segment path traversal attempts', async () => {
    await expect(
      discordRestRequestGuildScoped({
        guildId: 'guild-1',
        method: 'GET',
        path: '/guilds/guild-1/../../users/@me',
      }),
    ).rejects.toThrow(/dot-segments/i);

    await expect(
      discordRestRequestGuildScoped({
        guildId: 'guild-1',
        method: 'GET',
        path: '/guilds/guild-1/%2e%2e/%2e%2e/users/@me',
      }),
    ).rejects.toThrow(/dot-segments/i);

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('redacts sensitive fields (for example webhook tokens) in JSON responses', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url === 'https://discord.com/api/v10/channels/channel-hook-1') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: makeHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'channel-hook-1', guild_id: 'guild-1' }),
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          headers: { get: (name: string) => string | null };
          text: () => Promise<string>;
        };
      }
      if (url === 'https://discord.com/api/v10/channels/channel-hook-1/webhooks') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: makeHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify([{ id: 'wh-1', token: 'super-secret-token' }]),
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          headers: { get: (name: string) => string | null };
          text: () => Promise<string>;
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await discordRestRequestGuildScoped({
      guildId: 'guild-1',
      method: 'GET',
      path: '/channels/channel-hook-1/webhooks',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        isJson: true,
        rawText: '[omitted]',
        data: [{ id: 'wh-1', token: '[REDACTED]' }],
      }),
    );
  });
});

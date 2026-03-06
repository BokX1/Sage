import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@/features/agent-runtime/toolRegistry';
import { config } from '@/platform/config/env';

const mocks = vi.hoisted(() => ({
  requestDiscordRestWriteForTool: vi.fn(),
}));

vi.mock('@/features/admin/adminActionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/admin/adminActionService')>();
  return {
    ...actual,
    requestDiscordRestWriteForTool: mocks.requestDiscordRestWriteForTool,
  };
});

import { discordTool } from '@/features/agent-runtime/discordTool';

describe('discord tool typed REST wrappers', () => {
  const adminCtx: ToolExecutionContext = {
    traceId: 'trace',
    userId: 'user-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    invokedBy: 'command',
    invokerIsAdmin: true,
  };

  beforeEach(() => {
    mocks.requestDiscordRestWriteForTool.mockReset().mockResolvedValue({
      status: 'pending_approval',
      actionId: 'action-1',
    });
  });

  it('queues messages.edit as an approval-gated REST write', async () => {
    const result = await discordTool.execute(
      {
        think: 'Edit a message safely',
        action: 'messages.edit',
        messageId: 'msg-1',
        content: 'Updated',
      },
      adminCtx,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'pending_approval',
      }),
    );
    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledTimes(1);
    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledWith({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedBy: 'user-1',
      request: {
        method: 'PATCH',
        path: '/channels/channel-1/messages/msg-1',
        body: {
          content: 'Updated',
          allowed_mentions: { parse: [] },
        },
        reason: undefined,
      },
    });
  });

  it('queues channels.create and ignores text-only fields for voice channels', async () => {
    await discordTool.execute(
      {
        think: 'Create a voice channel',
        action: 'channels.create',
        name: 'Voice Lounge',
        type: 'voice',
        topic: 'should be ignored',
        rateLimitPerUser: 10,
      },
      adminCtx,
    );

    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledTimes(1);
    const call = mocks.requestDiscordRestWriteForTool.mock.calls[0]?.[0] as {
      request: { body?: Record<string, unknown> };
    };
    expect(call.request.body).toEqual(
      expect.objectContaining({
        name: 'Voice Lounge',
        type: 2,
      }),
    );
    expect(call.request.body?.topic).toBeUndefined();
    expect(call.request.body?.rate_limit_per_user).toBeUndefined();
  });

  it('queues roles.create and converts colorHex to Discord integer color', async () => {
    await discordTool.execute(
      {
        think: 'Create a new role',
        action: 'roles.create',
        name: 'Moderators',
        colorHex: '#ff0000',
        permissions: '8',
      },
      adminCtx,
    );

    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledTimes(1);
    const call = mocks.requestDiscordRestWriteForTool.mock.calls[0]?.[0] as {
      request: { method: string; path: string; body?: Record<string, unknown> };
    };
    expect(call.request.method).toBe('POST');
    expect(call.request.path).toBe('/guilds/guild-1/roles');
    expect(call.request.body).toEqual(
      expect.objectContaining({
        name: 'Moderators',
        color: 0xff0000,
        permissions: '8',
      }),
    );
  });

  it('generates an OAuth2 invite URL using the configured app id', async () => {
    const result = await discordTool.execute(
      {
        think: 'Generate invite URL',
        action: 'oauth2.invite_url',
      },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'oauth2.invite_url',
        url: expect.any(String),
      }),
    );
    const url = new URL((result as { url: string }).url);
    expect(url.hostname).toBe('discord.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe(config.DISCORD_APP_ID.trim());
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(url.searchParams.get('permissions')).toBe('0');
  });
});

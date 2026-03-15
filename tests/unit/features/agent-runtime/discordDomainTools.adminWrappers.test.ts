import { PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@/features/agent-runtime/toolRegistry';
import { config } from '@/platform/config/env';
import { ApprovalRequiredSignal } from '@/features/agent-runtime/toolControlSignals';

const mocks = vi.hoisted(() => ({
  requestDiscordAdminActionForTool: vi.fn(),
  requestDiscordRestWriteForTool: vi.fn(),
  discordRestRequestGuildScoped: vi.fn(),
  guildFetch: vi.fn(),
}));

vi.mock('@/features/admin/adminActionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/admin/adminActionService')>();
  return {
    ...actual,
    requestDiscordAdminActionForTool: mocks.requestDiscordAdminActionForTool,
    requestDiscordRestWriteForTool: mocks.requestDiscordRestWriteForTool,
  };
});

vi.mock('@/platform/discord/discordRestPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/discord/discordRestPolicy')>();
  return {
    ...actual,
    discordRestRequestGuildScoped: mocks.discordRestRequestGuildScoped,
  };
});

vi.mock('@/platform/discord/client', () => ({
  client: {
    guilds: {
      fetch: mocks.guildFetch,
    },
  },
}));

import { discordAdminTool } from '@/features/agent-runtime/discordDomainTools';

describe('discord admin domain typed REST wrappers', () => {
  const adminCtx: ToolExecutionContext = {
    traceId: 'trace',
    userId: 'user-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    invokedBy: 'mention',
    invokerIsAdmin: true,
  };

  beforeEach(() => {
    mocks.requestDiscordAdminActionForTool.mockReset().mockResolvedValue({
      ok: true,
      requestId: 'approval-1',
    });
    mocks.requestDiscordRestWriteForTool.mockReset().mockRejectedValue(
      new ApprovalRequiredSignal({
        kind: 'discord_rest_write',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-1',
        requestedBy: 'user-1',
        dedupeKey: 'dedupe-1',
        executionPayloadJson: {},
        reviewSnapshotJson: {},
      }),
    );
    mocks.discordRestRequestGuildScoped.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'message-1' },
    });
    mocks.guildFetch.mockReset();
  });

  it('queues edit_message as an approval-gated REST write', async () => {
    await expect(
      discordAdminTool.execute(
        {
          action: 'edit_message',
          messageId: 'msg-1',
          content: 'Updated',
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredSignal);
    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledTimes(1);
    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledWith({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedBy: 'user-1',
      sourceMessageId: null,
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
    await expect(
      discordAdminTool.execute(
        {
          action: 'create_channel',
          name: 'Voice Lounge',
          type: 'voice',
          topic: 'should be ignored',
          rateLimitPerUser: 10,
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredSignal);

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
    await expect(
      discordAdminTool.execute(
        {
          action: 'create_role',
          name: 'Moderators',
          colorHex: '#ff0000',
          permissions: '8',
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredSignal);

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
    const result = await discordAdminTool.execute(
      {
        action: 'get_invite_url',
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
        action: 'get_invite_url',
        url: expect.any(String),
      }),
    );
    const url = new URL((result as { url: string }).url);
    expect(url.hostname).toBe('discord.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe(config.DISCORD_APP_ID.trim());
    expect(url.searchParams.get('scope')).toBe('bot');
    expect(url.searchParams.get('permissions')).toBe('0');
  });

  it('blocks non-admin api GET requests', async () => {
    await expect(
      discordAdminTool.execute(
        {
          action: 'api',
          method: 'GET',
          path: '/channels/channel-1/messages/message-1',
        },
        {
          traceId: 'trace',
          userId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          invokedBy: 'mention',
          invokerIsAdmin: false,
        },
      ),
    ).rejects.toThrow(/admin/i);
    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledTimes(0);
    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledTimes(0);
  });

  it('blocks non-admin api writes', async () => {
    await expect(
      discordAdminTool.execute(
        {
          action: 'api',
          method: 'PATCH',
          path: '/channels/channel-1/messages/message-1',
          body: { content: 'Updated' },
        },
        {
          traceId: 'trace',
          userId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          invokedBy: 'mention',
          invokerIsAdmin: false,
        },
      ),
    ).rejects.toThrow(/admin/i);
  });

  it('allows moderator-only submit_moderation when the requester has Manage Messages in the target channel', async () => {
    const targetChannelId = '123456789012345678';
    const messageIds = ['223456789012345678', '323456789012345678'];
    const requester = {
      permissions: new PermissionsBitField(0n),
      permissionsIn: vi.fn(
        () => new PermissionsBitField(PermissionsBitField.Flags.ManageMessages),
      ),
    };
    const targetChannel = { id: targetChannelId };
    mocks.guildFetch.mockResolvedValue({
      members: {
        fetch: vi.fn().mockResolvedValue(requester),
      },
      channels: {
        fetch: vi.fn().mockResolvedValue(targetChannel),
      },
    });

    const result = await discordAdminTool.execute(
      {
        action: 'submit_moderation',
        request: {
          action: 'bulk_delete_messages',
          channelId: targetChannelId,
          messageIds,
          reason: 'Raid cleanup',
        },
      },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        invokedBy: 'mention',
        invokerIsAdmin: false,
        invokerCanModerate: true,
      },
    );

    expect(result).toEqual({
      ok: true,
      requestId: 'approval-1',
    });
    expect(mocks.requestDiscordAdminActionForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedBy: 'user-1',
        sourceMessageId: null,
        request: {
          action: 'bulk_delete_messages',
          channelId: targetChannelId,
          messageIds,
          reason: 'Raid cleanup',
        },
      }),
    );
  });

  it('keeps non-moderation admin actions blocked for moderator-only turns', async () => {
    await expect(
      discordAdminTool.execute(
        {
          action: 'clear_server_api_key',
        },
        {
          traceId: 'trace',
          userId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          invokedBy: 'mention',
          invokerIsAdmin: false,
          invokerCanModerate: true,
        },
      ),
    ).rejects.toThrow(/admin/i);
    expect(mocks.requestDiscordAdminActionForTool).toHaveBeenCalledTimes(0);
  });
});

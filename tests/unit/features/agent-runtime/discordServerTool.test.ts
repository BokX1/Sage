import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsBitField } from 'discord.js';
import type { ToolExecutionContext } from '@/features/agent-runtime/toolRegistry';

const mocks = vi.hoisted(() => ({
  requestDiscordInteractionForTool: vi.fn(),
  discordRestRequestGuildScoped: vi.fn(),
  filterChannelIdsByMemberAccess: vi.fn(),
  guildFetch: vi.fn(),
}));

vi.mock('@/features/admin/adminActionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/admin/adminActionService')>();
  return {
    ...actual,
    requestDiscordInteractionForTool: mocks.requestDiscordInteractionForTool,
  };
});

vi.mock('@/platform/discord/discordRestPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/discord/discordRestPolicy')>();
  return {
    ...actual,
    discordRestRequestGuildScoped: mocks.discordRestRequestGuildScoped,
  };
});

vi.mock('@/platform/discord/channel-access', () => ({
  filterChannelIdsByMemberAccess: mocks.filterChannelIdsByMemberAccess,
}));

vi.mock('@/platform/discord/client', () => ({
  client: {
    guilds: {
      fetch: mocks.guildFetch,
    },
  },
}));

import { discordMessagesTool, discordServerTool } from '@/features/agent-runtime/discordDomainTools';

describe('discord server tool', () => {
  const publicCtx: ToolExecutionContext = {
    traceId: 'trace',
    userId: 'user-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    invokedBy: 'mention',
    invokerIsAdmin: false,
  };

  const adminCtx: ToolExecutionContext = {
    ...publicCtx,
    invokerIsAdmin: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discordRestRequestGuildScoped.mockReset();
    mocks.requestDiscordInteractionForTool.mockReset();
    mocks.filterChannelIdsByMemberAccess.mockReset().mockResolvedValue(new Set());
    mocks.guildFetch.mockReset();
  });

  it('lists only accessible channels for the requester', async () => {
    mocks.discordRestRequestGuildScoped.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        { id: 'channel-1', guild_id: 'guild-1', type: 0, name: 'general', permission_overwrites: [] },
        { id: 'channel-2', guild_id: 'guild-1', type: 2, name: 'voice', permission_overwrites: [] },
      ],
    });
    mocks.filterChannelIdsByMemberAccess.mockResolvedValue(new Set(['channel-1']));

    const result = await discordServerTool.execute(
      {
        action: 'list_channels',
      },
      publicCtx,
    );

    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        method: 'GET',
        path: '/guilds/guild-1/channels',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'list_channels',
        accessibleCount: 1,
        items: [
          expect.objectContaining({
            id: 'channel-1',
            name: 'general',
            type: 'text',
          }),
        ],
      }),
    );
  });

  it('forwards create_thread through discord_server to the interaction service', async () => {
    mocks.requestDiscordInteractionForTool.mockResolvedValue({
      status: 'executed',
      action: 'create_thread',
      channelId: 'channel-1',
      threadId: 'thread-1',
    });

    const result = await discordServerTool.execute(
      {
        action: 'create_thread',
        name: 'Release follow-up',
      },
      publicCtx,
    );

    expect(mocks.requestDiscordInteractionForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedBy: 'user-1',
        invokedBy: 'mention',
        request: expect.objectContaining({
          action: 'create_thread',
          name: 'Release follow-up',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'executed',
        action: 'create_thread',
      }),
    );
  });

  it('keeps discord_messages.create_thread as a compatibility alias', async () => {
    mocks.requestDiscordInteractionForTool.mockResolvedValue({
      status: 'executed',
      action: 'create_thread',
      channelId: 'channel-1',
      threadId: 'thread-2',
    });

    const result = await discordMessagesTool.execute(
      {
        action: 'create_thread',
        name: 'Legacy alias',
      },
      publicCtx,
    );

    expect(mocks.requestDiscordInteractionForTool).toHaveBeenCalledTimes(1);
    expect(mocks.requestDiscordInteractionForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          action: 'create_thread',
          name: 'Legacy alias',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'executed',
        action: 'create_thread',
      }),
    );
  });

  it('returns admin-only permission snapshots for a member target', async () => {
    const permissions = new PermissionsBitField([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
    ]);

    mocks.guildFetch.mockResolvedValue({
      id: 'guild-1',
      channels: {
        fetch: vi.fn().mockResolvedValue({
          id: 'channel-1',
          isDMBased: () => false,
          permissionsFor: vi.fn().mockReturnValue(permissions),
        }),
      },
      members: {
        fetch: vi.fn().mockResolvedValue({ id: 'user-2' }),
      },
      roles: {
        fetch: vi.fn(),
      },
    });

    const result = await discordServerTool.execute(
      {
        action: 'get_permission_snapshot',
        channelId: 'channel-1',
        userId: 'user-2',
      },
      adminCtx,
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'get_permission_snapshot',
        targetType: 'member',
        targetId: 'user-2',
        permissions: expect.objectContaining({
          isAdministrator: false,
          names: expect.arrayContaining(['ViewChannel', 'SendMessages']),
        }),
      }),
    );
  });

  it('blocks discord_server writes in autopilot turns', async () => {
    await expect(
      discordServerTool.execute(
        {
          action: 'update_thread',
          threadId: 'thread-1',
          archived: true,
        },
        {
          ...publicCtx,
          invokedBy: 'autopilot',
        },
      ),
    ).rejects.toThrow(/autopilot/i);
  });
});

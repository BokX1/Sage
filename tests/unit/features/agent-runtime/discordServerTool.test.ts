import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, PermissionsBitField } from 'discord.js';
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

import { discordServerTool, discordVoiceTool } from '@/features/agent-runtime/discordDomainTools';

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

  it('requires parentChannelId when archived threads are requested', () => {
    const parsed = discordServerTool.schema.safeParse({
      action: 'list_threads',
      includeArchived: true,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['parentChannelId'],
        }),
      ]),
    );
  });

  it('reports voice connection status through discord_voice', async () => {
    mocks.guildFetch.mockResolvedValue({
      channels: {
        fetch: vi.fn().mockResolvedValue({ id: 'voice-1', name: 'Standup' }),
      },
    });

    const { VoiceManager } = await import('@/features/voice/voiceManager');
    const getConnectionSpy = vi.spyOn(VoiceManager.getInstance(), 'getConnection').mockReturnValue({
      joinConfig: { channelId: 'voice-1' },
    } as never);

    const result = await discordVoiceTool.execute({ action: 'get_status' }, publicCtx);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'get_status',
        connected: true,
        channelId: 'voice-1',
        channelName: 'Standup',
      }),
    );

    getConnectionSpy.mockRestore();
  });

  it('joins the invoker current voice channel through discord_voice', async () => {
    const channel = {
      id: 'voice-2',
      name: 'Pairing',
      type: ChannelType.GuildVoice,
      guild: { id: 'guild-1' },
    };
    mocks.guildFetch.mockResolvedValue({
      members: {
        fetch: vi.fn().mockResolvedValue({
          voice: { channel },
        }),
      },
    });

    const { VoiceManager } = await import('@/features/voice/voiceManager');
    const joinSpy = vi.spyOn(VoiceManager.getInstance(), 'joinChannel').mockResolvedValue({} as never);

    const result = await discordVoiceTool.execute({ action: 'join_current_channel' }, publicCtx);

    expect(joinSpy).toHaveBeenCalledWith({
      channel,
      initiatedByUserId: 'user-1',
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'join_current_channel',
        channelId: 'voice-2',
      }),
    );

    joinSpy.mockRestore();
  });
});

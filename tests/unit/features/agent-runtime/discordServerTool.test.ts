import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, PermissionsBitField } from 'discord.js';
import type { ToolExecutionContext } from '../../../../src/features/agent-runtime/toolRegistry';

const mocks = vi.hoisted(() => ({
  requestDiscordInteractionForTool: vi.fn(),
  discordRestRequestGuildScoped: vi.fn(),
  filterChannelIdsByMemberAccess: vi.fn(),
  guildFetch: vi.fn(),
}));

vi.mock('../../../../src/features/admin/adminActionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/features/admin/adminActionService')>();
  return {
    ...actual,
    requestDiscordInteractionForTool: mocks.requestDiscordInteractionForTool,
  };
});

vi.mock('../../../../src/platform/discord/discordRestPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/platform/discord/discordRestPolicy')>();
  return {
    ...actual,
    discordRestRequestGuildScoped: mocks.discordRestRequestGuildScoped,
  };
});

vi.mock('../../../../src/platform/discord/channel-access', () => ({
  filterChannelIdsByMemberAccess: mocks.filterChannelIdsByMemberAccess,
}));

vi.mock('../../../../src/platform/discord/client', () => ({
  client: {
    guilds: {
      fetch: mocks.guildFetch,
    },
  },
}));

import { discordServerTools, discordVoiceTools } from '../../../../src/features/agent-runtime/discordDomainTools';

function serverTool(name: string) {
  const found = discordServerTools.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing server tool ${name}`);
  return found;
}

function voiceTool(name: string) {
  const found = discordVoiceTools.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing voice tool ${name}`);
  return found;
}

describe('discord granular server and voice tools', () => {
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

    const result = await serverTool('discord_server_list_channels').execute({}, publicCtx);

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

  it('routes create_thread through the interaction service', async () => {
    mocks.requestDiscordInteractionForTool.mockResolvedValue({
      status: 'executed',
      action: 'create_thread',
      channelId: 'channel-1',
      threadId: 'thread-1',
    });

    const result = await serverTool('discord_server_create_thread').execute(
      {
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

    const result = await serverTool('discord_server_get_permission_snapshot').execute(
      {
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

  it('blocks thread updates in autopilot turns', async () => {
    await expect(
      serverTool('discord_server_update_thread').execute(
        {
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
    const schema = serverTool('discord_server_list_threads').schema;
    if (!schema) {
      throw new Error('Expected discord_server_list_threads to expose a runtime schema.');
    }
    const parsed = schema.safeParse({
      includeArchived: true,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error('Expected archived thread validation to fail without parentChannelId.');
    }
    expect(parsed.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['parentChannelId'],
        }),
      ]),
    );
  });

  it('reports voice connection status', async () => {
    mocks.guildFetch.mockResolvedValue({
      channels: {
        fetch: vi.fn().mockResolvedValue({ id: 'voice-1', name: 'Standup' }),
      },
    });

    const { VoiceManager } = await import('../../../../src/features/voice/voiceManager');
    const getConnectionSpy = vi.spyOn(VoiceManager.getInstance(), 'getConnection').mockReturnValue({
      joinConfig: { channelId: 'voice-1' },
    } as never);

    const result = await voiceTool('discord_voice_get_status').execute({}, publicCtx);

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

  it('joins the invoker current voice channel', async () => {
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

    const { VoiceManager } = await import('../../../../src/features/voice/voiceManager');
    const joinSpy = vi.spyOn(VoiceManager.getInstance(), 'joinChannel').mockResolvedValue({} as never);

    const result = await voiceTool('discord_voice_join_current_channel').execute({}, publicCtx);

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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const allowAllPermissions = {
    has: vi.fn(() => true),
  };

  const botMember = {
    permissions: allowAllPermissions,
    permissionsIn: vi.fn(() => allowAllPermissions),
    roles: {
      highest: {
        comparePositionTo: vi.fn(() => 1),
      },
    },
  };

  const targetMember = {
    id: 'user-8',
    guild: { ownerId: 'owner-1' },
    roles: {
      highest: {
        position: 1,
      },
    },
    communicationDisabledUntilTimestamp: Date.now() + 60_000,
  };

  const message = {
    id: 'msg-1',
    channelId: 'chan-9',
    guildId: 'guild-1',
    content: 'buy cheap spam now',
    author: {
      id: 'user-8',
      username: 'spammer',
      globalName: 'Spammer',
      bot: false,
    },
    member: {
      displayName: 'Spammer',
    },
    reactions: {
      resolve: vi.fn(() => null),
      fetch: vi.fn(async () => null),
      cache: new Map(),
      removeAll: vi.fn(async () => undefined),
    },
    delete: vi.fn(async () => undefined),
    react: vi.fn(async () => undefined),
    startThread: vi.fn(async () => ({ id: 'thread-1' })),
  };

  const channel = {
    id: 'chan-9',
    guildId: 'guild-1',
    isDMBased: vi.fn(() => false),
    send: vi.fn(async () => ({ id: 'sent-1' })),
    messages: {
      fetch: vi.fn(async () => message),
    },
  };

  const guild = {
    id: 'guild-1',
    members: {
      me: botMember,
      fetchMe: vi.fn(async () => botMember),
      fetch: vi.fn(async () => targetMember),
    },
    bans: {
      fetch: vi.fn(async () => ({ user: { id: 'user-8' } })),
    },
  };

  return {
    clearGuildSagePersona: vi.fn(),
    getGuildSagePersonaRecord: vi.fn(),
    upsertGuildSagePersona: vi.fn(),
    getGuildApprovalReviewChannelId: vi.fn(async () => null),
    computeParamsHash: vi.fn(() => 'hash'),
    logAdminAction: vi.fn(async () => undefined),
    assertDiscordRestRequestGuildScoped: vi.fn(),
    discordRestRequestGuildScoped: vi.fn(),
    discordRestRequest: vi.fn(),
    client: {
      guilds: {
        fetch: vi.fn(async () => guild),
      },
      channels: {
        fetch: vi.fn(async () => channel),
      },
    },
    guild,
    channel,
    message,
    targetMember,
  };
});

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApprovalReviewChannelId: mocks.getGuildApprovalReviewChannelId,
}));

vi.mock('@/features/settings/guildSagePersonaRepo', () => ({
  clearGuildSagePersona: mocks.clearGuildSagePersona,
  getGuildSagePersonaRecord: mocks.getGuildSagePersonaRecord,
  upsertGuildSagePersona: mocks.upsertGuildSagePersona,
}));

vi.mock('@/features/relationships/adminAuditRepo', () => ({
  computeParamsHash: mocks.computeParamsHash,
  logAdminAction: mocks.logAdminAction,
}));

vi.mock('@/platform/discord/discordRestPolicy', () => ({
  assertDiscordRestRequestGuildScoped: mocks.assertDiscordRestRequestGuildScoped,
  discordRestRequestGuildScoped: mocks.discordRestRequestGuildScoped,
}));

vi.mock('@/platform/discord/discordRest', () => ({
  discordRestRequest: mocks.discordRestRequest,
}));

vi.mock('@/platform/discord/client', () => ({
  client: mocks.client,
}));

import { requestDiscordAdminActionForTool } from '@/features/admin/adminActionService';
import { ApprovalRequiredSignal } from '@/features/agent-runtime/toolControlSignals';

async function expectApprovalSignal(promise: Promise<never>): Promise<ApprovalRequiredSignal> {
  try {
    await promise;
    throw new Error('Expected ApprovalRequiredSignal');
  } catch (error) {
    expect(error).toBeInstanceOf(ApprovalRequiredSignal);
    return error as ApprovalRequiredSignal;
  }
}

describe('adminActionService moderation preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGuildApprovalReviewChannelId.mockResolvedValue(null);
    mocks.client.channels.fetch.mockImplementation(async () => mocks.channel);
    mocks.channel.messages.fetch.mockResolvedValue(mocks.message);
    mocks.guild.members.fetch.mockResolvedValue(mocks.targetMember);
    mocks.guild.bans.fetch.mockResolvedValue({ user: { id: 'user-8' } });
  });

  it('resolves reply-target delete moderation into a canonical prepared payload', async () => {
    const signal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'delete_message',
          reason: 'Spam cleanup',
        },
        replyTarget: {
          messageId: 'msg-1',
          guildId: 'guild-1',
          channelId: 'chan-9',
          authorId: 'user-8',
          authorDisplayName: 'Spammer',
          authorIsBot: false,
          replyToMessageId: null,
          mentionedUserIds: [],
          content: 'buy cheap spam now',
        },
      }),
    );

    const prepared = signal.payload.executionPayloadJson as {
      canonicalAction: { action: string; channelId: string; messageId: string; reason: string };
      evidence: { source: string; messageUrl: string; messageExcerpt: string };
    };

    expect(prepared.canonicalAction).toEqual({
      action: 'delete_message',
      channelId: 'chan-9',
      messageId: 'msg-1',
      reason: 'Spam cleanup',
    });
    expect(prepared.evidence).toEqual(
      expect.objectContaining({
        source: 'reply_target',
        messageUrl: 'https://discord.com/channels/guild-1/chan-9/msg-1',
        messageExcerpt: 'buy cheap spam now',
      }),
    );
  });

  it('resolves explicit bulk-delete moderation targets into a deterministic canonical payload', async () => {
    const signal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'bulk_delete_messages',
          channelId: 'chan-9',
          messageIds: [
            '2002',
            'https://discord.com/channels/guild-1/chan-9/3003',
            '2002',
          ],
          reason: 'Raid cleanup',
        },
      }),
    );

    const prepared = signal.payload.executionPayloadJson as {
      canonicalAction: { action: string; channelId: string; messageIds: string[]; reason: string };
      evidence: { source: string; messageUrl: string | null };
      preflight: { notes: string[] };
    };

    expect(prepared.canonicalAction).toEqual({
      action: 'bulk_delete_messages',
      channelId: 'chan-9',
      messageIds: ['2002', '3003'],
      reason: 'Raid cleanup',
    });
    expect(prepared.evidence).toEqual(
      expect.objectContaining({
        source: 'bulk_explicit_ids',
        messageUrl: 'https://discord.com/channels/guild-1/chan-9/2002',
      }),
    );
    expect(prepared.preflight.notes.join(' ')).toContain('skip messages older than 14 days');
  });

  it('infers bulk-delete channel scope from Discord message URLs when request.channelId is omitted', async () => {
    mocks.client.channels.fetch.mockImplementation(async (...args: unknown[]) => ({
      ...mocks.channel,
      id: typeof args[0] === 'string' ? args[0] : mocks.channel.id,
    }));

    const signal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'bulk_delete_messages',
          messageIds: [
            'https://discord.com/channels/guild-1/chan-42/3004',
            'https://discord.com/channels/guild-1/chan-42/3003',
          ],
          reason: 'Raid cleanup',
        },
      }),
    );

    const prepared = signal.payload.executionPayloadJson as {
      canonicalAction: { action: string; channelId: string; messageIds: string[]; reason: string };
      evidence: { source: string; messageUrl: string | null };
    };

    expect(prepared.canonicalAction).toEqual({
      action: 'bulk_delete_messages',
      channelId: 'chan-42',
      messageIds: ['3003', '3004'],
      reason: 'Raid cleanup',
    });
    expect(prepared.evidence).toEqual(
      expect.objectContaining({
        source: 'bulk_explicit_ids',
        messageUrl: 'https://discord.com/channels/guild-1/chan-42/3003',
      }),
    );
    expect(mocks.client.channels.fetch).toHaveBeenCalledWith('chan-42');
  });

  it('rejects bulk-delete requests that mix Discord message URLs from different channels', async () => {
    await expect(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'bulk_delete_messages',
          messageIds: [
            'https://discord.com/channels/guild-1/chan-9/3003',
            'https://discord.com/channels/guild-1/chan-42/3004',
          ],
          reason: 'Raid cleanup',
        },
      }),
    ).rejects.toThrow(/cannot mix message targets from different channels/i);
  });

  it('resolves purge_recent_messages to explicit canonical bulk-delete ids during preflight', async () => {
    const now = Date.now();
    const iso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();
    mocks.discordRestRequestGuildScoped.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: [
        {
          id: '3004',
          channel_id: 'chan-9',
          content: 'spam one',
          timestamp: iso(1),
          pinned: false,
          author: { id: 'user-8', username: 'spammer' },
        },
        {
          id: '3003',
          channel_id: 'chan-9',
          content: 'spam two',
          timestamp: iso(2),
          pinned: false,
          author: { id: 'user-8', username: 'spammer' },
        },
        {
          id: '3002',
          channel_id: 'chan-9',
          content: 'different author',
          timestamp: iso(3),
          pinned: false,
          author: { id: 'user-9', username: 'other' },
        },
        {
          id: '3001',
          channel_id: 'chan-9',
          content: 'older message',
          timestamp: iso(120),
          pinned: false,
          author: { id: 'user-8', username: 'spammer' },
        },
      ],
    });

    const signal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'purge_recent_messages',
          channelId: 'chan-9',
          limit: 2,
          windowMinutes: 30,
          authorUserId: 'user-8',
          reason: 'Purge raid burst',
        },
      }),
    );

    const prepared = signal.payload.executionPayloadJson as {
      originalRequest: { action: string; limit?: number; windowMinutes?: number; authorUserId?: string };
      canonicalAction: { action: string; channelId: string; messageIds: string[]; reason: string };
      evidence: { source: string; userId: string | null };
      preflight: { notes: string[] };
    };

    expect(prepared.originalRequest).toEqual(
      expect.objectContaining({
        action: 'purge_recent_messages',
        limit: 2,
        windowMinutes: 30,
        authorUserId: 'user-8',
      }),
    );
    expect(prepared.canonicalAction).toEqual({
      action: 'bulk_delete_messages',
      channelId: 'chan-9',
      messageIds: ['3003', '3004'],
      reason: 'Purge raid burst',
    });
    expect(prepared.evidence).toEqual(
      expect.objectContaining({
        source: 'purge_recent_scan',
        userId: 'user-8',
      }),
    );
    expect(prepared.preflight.notes.join(' ')).toContain('Matched 2 message(s)');
    expect(prepared.preflight.notes.join(' ')).toContain('skip messages older than 14 days');
  });

  it('resolves member moderation from a Discord message URL to the referenced author', async () => {
    const signal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'timeout_member',
          userId: 'https://discord.com/channels/guild-1/chan-9/msg-1',
          durationMinutes: 30,
          reason: 'Spam wave',
        },
      }),
    );

    const prepared = signal.payload.executionPayloadJson as {
      canonicalAction: { action: string; userId: string; durationMinutes: number; reason: string };
      evidence: { source: string; messageAuthorId: string; messageUrl: string };
    };

    expect(prepared.canonicalAction).toEqual({
      action: 'timeout_member',
      userId: 'user-8',
      durationMinutes: 30,
      reason: 'Spam wave',
    });
    expect(prepared.evidence).toEqual(
      expect.objectContaining({
        source: 'message_author_url',
        messageAuthorId: 'user-8',
        messageUrl: 'https://discord.com/channels/guild-1/chan-9/msg-1',
      }),
    );
  });

  it('rejects moderation requests that omit both an explicit member target and a reply target', async () => {
    await expect(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'timeout_member',
          durationMinutes: 30,
          reason: 'Spam wave',
        },
      }),
    ).rejects.toThrow(/requires either an explicit target or a direct reply target/i);
  });

  it('rejects remove_user_reaction requests that only identify the message via the reply target', async () => {
    await expect(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'remove_user_reaction',
          emoji: '🔥',
          reason: 'Remove the abusive reaction',
        },
        replyTarget: {
          messageId: 'msg-1',
          guildId: 'guild-1',
          channelId: 'chan-9',
          authorId: 'user-8',
          authorDisplayName: 'Spammer',
          authorIsBot: false,
          replyToMessageId: null,
          mentionedUserIds: [],
          content: 'buy cheap spam now',
        },
      }),
    ).rejects.toThrow(/requires an explicit Discord user mention, user ID, or message URL/i);
  });

  it('allows ban_member preflight to queue a raw user-id ban when the target already left the guild', async () => {
    mocks.guild.members.fetch.mockRejectedValueOnce(new Error('Unknown Member'));

    const signal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'ban_member',
          userId: 'user-8',
          reason: 'Spam raid',
        },
      }),
    );

    const prepared = signal.payload.executionPayloadJson as {
      canonicalAction: { action: string; userId: string; reason: string };
      evidence: { source: string; userId: string };
      preflight: { hierarchyChecked: boolean; notes: string[] };
    };

    expect(prepared.canonicalAction).toEqual({
      action: 'ban_member',
      userId: 'user-8',
      reason: 'Spam raid',
    });
    expect(prepared.evidence).toEqual(
      expect.objectContaining({
        source: 'explicit_id',
        userId: 'user-8',
      }),
    );
    expect(prepared.preflight).toEqual(
      expect.objectContaining({
        hierarchyChecked: false,
      }),
    );
    expect(prepared.preflight.notes.join(' ')).toContain('not an active guild member');
  });
});

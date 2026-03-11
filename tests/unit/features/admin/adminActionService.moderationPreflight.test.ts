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
    createPendingAdminAction: vi.fn(async (params: { payloadJson: unknown }) => ({
      id: 'action-1',
      guildId: 'guild-1',
      sourceChannelId: 'channel-source',
      reviewChannelId: 'channel-source',
      approvalMessageId: 'approval-1',
      requestMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      payloadJson: params.payloadJson,
      status: 'pending',
      expiresAt: new Date('2026-03-12T00:10:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-03-12T00:00:00.000Z'),
      updatedAt: new Date('2026-03-12T00:00:00.000Z'),
    })),
    attachPendingAdminActionRequestMessageId: vi.fn(),
    clearPendingAdminActionApprovalMessageId: vi.fn(),
    findMatchingPendingAdminAction: vi.fn(async () => null),
    getPendingAdminActionById: vi.fn(),
    markPendingAdminActionDecisionIfPending: vi.fn(),
    markPendingAdminActionExecutedIfApproved: vi.fn(),
    markPendingAdminActionExpired: vi.fn(),
    markPendingAdminActionFailedIfApproved: vi.fn(),
    updatePendingAdminActionReviewSurface: vi.fn(),
    clearServerInstructions: vi.fn(),
    getServerInstructionsRecord: vi.fn(),
    upsertServerInstructions: vi.fn(),
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
    botMember,
    targetMember,
  };
});

vi.mock('@/features/admin/pendingAdminActionRepo', () => ({
  createPendingAdminAction: mocks.createPendingAdminAction,
  attachPendingAdminActionRequestMessageId: mocks.attachPendingAdminActionRequestMessageId,
  clearPendingAdminActionApprovalMessageId: mocks.clearPendingAdminActionApprovalMessageId,
  findMatchingPendingAdminAction: mocks.findMatchingPendingAdminAction,
  getPendingAdminActionById: mocks.getPendingAdminActionById,
  markPendingAdminActionDecisionIfPending: mocks.markPendingAdminActionDecisionIfPending,
  markPendingAdminActionExecutedIfApproved: mocks.markPendingAdminActionExecutedIfApproved,
  markPendingAdminActionExpired: mocks.markPendingAdminActionExpired,
  markPendingAdminActionFailedIfApproved: mocks.markPendingAdminActionFailedIfApproved,
  updatePendingAdminActionReviewSurface: mocks.updatePendingAdminActionReviewSurface,
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApprovalReviewChannelId: mocks.getGuildApprovalReviewChannelId,
}));

vi.mock('@/features/settings/serverInstructionsRepo', () => ({
  clearServerInstructions: mocks.clearServerInstructions,
  getServerInstructionsRecord: mocks.getServerInstructionsRecord,
  upsertServerInstructions: mocks.upsertServerInstructions,
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

describe('adminActionService moderation preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMatchingPendingAdminAction.mockResolvedValue(null);
    mocks.getGuildApprovalReviewChannelId.mockResolvedValue(null);
    mocks.channel.messages.fetch.mockResolvedValue(mocks.message);
    mocks.guild.members.fetch.mockResolvedValue(mocks.targetMember);
    mocks.guild.bans.fetch.mockResolvedValue({ user: { id: 'user-8' } });
  });

  it('resolves reply-target delete moderation into a canonical prepared payload', async () => {
    const result = await requestDiscordAdminActionForTool({
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
    });

    expect(result).toMatchObject({
      status: 'pending_approval',
      action: 'delete_message',
    });
    const createCall = mocks.createPendingAdminAction.mock.calls[0]?.[0] as {
      payloadJson: {
        prepared: {
          canonicalAction: { action: string; channelId: string; messageId: string };
          evidence: { source: string; messageUrl: string; messageExcerpt: string };
        };
      };
    };
    expect(createCall.payloadJson.prepared.canonicalAction).toEqual({
      action: 'delete_message',
      channelId: 'chan-9',
      messageId: 'msg-1',
      reason: 'Spam cleanup',
    });
    expect(createCall.payloadJson.prepared.evidence).toEqual(
      expect.objectContaining({
        source: 'reply_target',
        messageUrl: 'https://discord.com/channels/guild-1/chan-9/msg-1',
        messageExcerpt: 'buy cheap spam now',
      }),
    );
  });

  it('resolves member moderation from a Discord message URL to the referenced author', async () => {
    const result = await requestDiscordAdminActionForTool({
      guildId: 'guild-1',
      channelId: 'channel-source',
      requestedBy: 'admin-1',
      request: {
        action: 'timeout_member',
        userId: 'https://discord.com/channels/guild-1/chan-9/msg-1',
        durationMinutes: 30,
        reason: 'Spam wave',
      },
    });

    expect(result).toMatchObject({
      status: 'pending_approval',
      action: 'timeout_member',
    });
    const createCall = mocks.createPendingAdminAction.mock.calls[0]?.[0] as {
      payloadJson: {
        prepared: {
          canonicalAction: { action: string; userId: string; durationMinutes: number };
          evidence: { source: string; messageAuthorId: string; messageUrl: string };
        };
      };
    };
    expect(createCall.payloadJson.prepared.canonicalAction).toEqual({
      action: 'timeout_member',
      userId: 'user-8',
      durationMinutes: 30,
      reason: 'Spam wave',
    });
    expect(createCall.payloadJson.prepared.evidence).toEqual(
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
    expect(mocks.createPendingAdminAction).not.toHaveBeenCalled();
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
    expect(mocks.createPendingAdminAction).not.toHaveBeenCalled();
  });

  it('allows ban_member preflight to queue a raw user-id ban when the target already left the guild', async () => {
    mocks.guild.members.fetch.mockRejectedValueOnce(new Error('Unknown Member'));

    const result = await requestDiscordAdminActionForTool({
      guildId: 'guild-1',
      channelId: 'channel-source',
      requestedBy: 'admin-1',
      request: {
        action: 'ban_member',
        userId: 'user-9',
        deleteMessageSeconds: 600,
        reason: 'Drive-by spam raid',
      },
    });

    expect(result).toMatchObject({
      status: 'pending_approval',
      action: 'ban_member',
    });
    const createCall = mocks.createPendingAdminAction.mock.calls[0]?.[0] as {
      payloadJson: {
        prepared: {
          canonicalAction: { action: string; userId: string; deleteMessageSeconds?: number };
          preflight: { hierarchyChecked: boolean; notes: string[] };
        };
      };
    };
    expect(createCall.payloadJson.prepared.canonicalAction).toEqual({
      action: 'ban_member',
      userId: 'user-9',
      deleteMessageSeconds: 600,
      reason: 'Drive-by spam raid',
    });
    expect(createCall.payloadJson.prepared.preflight).toEqual(
      expect.objectContaining({
        hierarchyChecked: false,
      }),
    );
    expect(createCall.payloadJson.prepared.preflight.notes).toContain(
      'Target user was not an active guild member during preflight; Sage will execute the ban by raw user ID if approved.',
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsBitField } from 'discord.js';

const ADMIN_MEMBER_PERMISSIONS = String(PermissionsBitField.Flags.ManageGuild);
const ADMIN_AND_MODERATE_MEMBER_PERMISSIONS = String(
  PermissionsBitField.Flags.ManageGuild | PermissionsBitField.Flags.ModerateMembers,
);
const ADMIN_AND_BAN_MEMBER_PERMISSIONS = String(
  PermissionsBitField.Flags.ManageGuild | PermissionsBitField.Flags.BanMembers,
);

const mocks = vi.hoisted(() => {
  const allowAllPermissions = {
    has: vi.fn(() => true),
  };
  const denyAllPermissions = {
    has: vi.fn(() => false),
  };

  const targetChannel = {
    id: 'chan-target',
    guildId: 'guild-1',
    isDMBased: vi.fn(() => false),
    send: vi.fn(async () => ({ id: 'sent-1' })),
    messages: {
      fetch: vi.fn(),
    },
  };

  const approverMemberWithoutManageMessages = {
    permissionsIn: vi.fn(() => denyAllPermissions),
  };

  const approverMemberWithManageMessages = {
    permissionsIn: vi.fn(() => allowAllPermissions),
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

  const guild = {
    members: {
      me: botMember,
      fetchMe: vi.fn(async () => botMember),
      fetch: vi.fn(async () => approverMemberWithoutManageMessages),
    },
    bans: {
      fetch: vi.fn(),
      remove: vi.fn(async () => undefined),
    },
  };

  return {
    createPendingAdminAction: vi.fn(),
    attachPendingAdminActionRequestMessageId: vi.fn(),
    clearPendingAdminActionApprovalMessageId: vi.fn(),
    findMatchingPendingAdminAction: vi.fn(),
    getPendingAdminActionById: vi.fn(),
    markPendingAdminActionDecisionIfPending: vi.fn(),
    markPendingAdminActionExecutedIfApproved: vi.fn(),
    markPendingAdminActionExpired: vi.fn(),
    markPendingAdminActionFailedIfApproved: vi.fn(),
    updatePendingAdminActionReviewSurface: vi.fn(),
    clearServerInstructions: vi.fn(),
    getServerInstructionsRecord: vi.fn(),
    upsertServerInstructions: vi.fn(),
    getGuildApprovalReviewChannelId: vi.fn(),
    computeParamsHash: vi.fn(() => 'hash'),
    logAdminAction: vi.fn(),
    assertDiscordRestRequestGuildScoped: vi.fn(),
    discordRestRequestGuildScoped: vi.fn(async (): Promise<{
      ok: boolean;
      status: number;
      statusText: string;
      data?: { id: string };
      error?: unknown;
    }> => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: { id: 'message-1' },
    })),
    discordRestRequest: vi.fn(),
    client: {
      guilds: {
        fetch: vi.fn(async () => guild),
      },
      channels: {
        fetch: vi.fn(async () => targetChannel),
      },
    },
    guild,
    targetChannel,
    approverMemberWithManageMessages,
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

import { handleAdminActionButtonInteraction } from '@/features/admin/adminActionService';

function makePendingAction(payloadJson: unknown) {
  return {
    id: 'action-1',
    guildId: 'guild-1',
    sourceChannelId: 'channel-source',
    reviewChannelId: 'channel-review',
    approvalMessageId: 'approval-1',
    requestMessageId: 'request-1',
    requestedBy: 'admin-1',
    kind: 'discord_queue_moderation_action',
    payloadJson,
    status: 'pending' as const,
    expiresAt: new Date(Date.now() + 60_000),
    decidedBy: null,
    decidedAt: null,
    executedAt: null,
    resultJson: null,
    decisionReasonText: null,
    errorText: null,
    createdAt: new Date('2026-03-12T00:00:00.000Z'),
    updatedAt: new Date('2026-03-12T00:00:00.000Z'),
  };
}

function makeInteraction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    customId: 'sage:admin_action:approve:action-1',
    guildId: 'guild-1',
    channelId: 'channel-review',
    message: { id: 'approval-1' },
    guild: mocks.guild,
    user: { id: 'admin-2' },
    member: {
      permissions: ADMIN_MEMBER_PERMISSIONS,
    },
    inGuild: () => true,
    reply: vi.fn(async () => undefined),
    deferUpdate: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('adminActionService approval permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks approver permissions in the target channel for message moderation approvals', async () => {
    mocks.getPendingAdminActionById.mockResolvedValue(
      makePendingAction({
        prepared: {
          version: 1,
          originalRequest: {
            action: 'delete_message',
            channelId: 'chan-target',
            messageId: 'msg-1',
            reason: 'Spam cleanup',
          },
          canonicalAction: {
            action: 'delete_message',
            channelId: 'chan-target',
            messageId: 'msg-1',
            reason: 'Spam cleanup',
          },
          evidence: {
            targetKind: 'message',
            source: 'explicit_id',
            channelId: 'chan-target',
            messageId: 'msg-1',
            messageUrl: 'https://discord.com/channels/guild-1/chan-target/msg-1',
            userId: 'user-8',
            messageAuthorId: 'user-8',
            messageAuthorDisplayName: 'Spammer',
            messageExcerpt: 'spam',
          },
          preflight: {
            approverPermission: 'Manage Messages',
            botPermissionChecks: ['Manage Messages'],
            targetChannelScope: 'chan-target',
            hierarchyChecked: false,
            notes: ['Resolved from exact identifiers.'],
          },
          dedupeKey: '{"action":"delete_message","channelId":"chan-target","messageId":"msg-1","reason":"Spam cleanup"}',
        },
      }),
    );

    const interaction = makeInteraction();
    const handled = await handleAdminActionButtonInteraction(interaction as never);

    expect(handled).toBe(true);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '❌ Missing required permission to approve this action in <#chan-target>: Manage Messages.',
      ephemeral: true,
    });
    expect(mocks.markPendingAdminActionDecisionIfPending).not.toHaveBeenCalled();
  });

  it('uses guild-level moderation permissions for member moderation approvals', async () => {
    mocks.getPendingAdminActionById.mockResolvedValue(
      makePendingAction({
        prepared: {
          version: 1,
          originalRequest: {
            action: 'timeout_member',
            userId: 'user-8',
            durationMinutes: 30,
            reason: 'Spam cleanup',
          },
          canonicalAction: {
            action: 'timeout_member',
            userId: 'user-8',
            durationMinutes: 30,
            reason: 'Spam cleanup',
          },
          evidence: {
            targetKind: 'member',
            source: 'explicit_id',
            channelId: null,
            messageId: null,
            messageUrl: null,
            userId: 'user-8',
            messageAuthorId: null,
            messageAuthorDisplayName: null,
            messageExcerpt: null,
          },
          preflight: {
            approverPermission: 'Moderate Members',
            botPermissionChecks: ['Moderate Members'],
            targetChannelScope: null,
            hierarchyChecked: true,
            notes: ['Resolved from explicit user reference.'],
          },
          dedupeKey: '{"action":"timeout_member","durationMinutes":30,"reason":"Spam cleanup","userId":"user-8"}',
        },
      }),
    );

    const interaction = makeInteraction();
    const handled = await handleAdminActionButtonInteraction(interaction as never);

    expect(handled).toBe(true);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '❌ Missing required permission to approve this action: Moderate Members.',
      ephemeral: true,
    });
    expect(mocks.markPendingAdminActionDecisionIfPending).not.toHaveBeenCalled();
  });

  it('handles an approval race without executing the action twice', async () => {
    mocks.getPendingAdminActionById
      .mockResolvedValueOnce(
        makePendingAction({
          prepared: {
            version: 1,
            originalRequest: {
              action: 'timeout_member',
              userId: 'user-8',
              durationMinutes: 30,
              reason: 'Spam cleanup',
            },
            canonicalAction: {
              action: 'timeout_member',
              userId: 'user-8',
              durationMinutes: 30,
              reason: 'Spam cleanup',
            },
            evidence: {
              targetKind: 'member',
              source: 'explicit_id',
              channelId: null,
              messageId: null,
              messageUrl: null,
              userId: 'user-8',
              messageAuthorId: null,
              messageAuthorDisplayName: null,
              messageExcerpt: null,
            },
            preflight: {
              approverPermission: 'Moderate Members',
              botPermissionChecks: ['Moderate Members'],
              targetChannelScope: null,
              hierarchyChecked: true,
              notes: ['Resolved from explicit user reference.'],
            },
            dedupeKey: '{"action":"timeout_member","durationMinutes":30,"reason":"Spam cleanup","userId":"user-8"}',
          },
        }),
      )
      .mockResolvedValueOnce(
        {
          ...makePendingAction({}),
          status: 'executed',
        },
      );
    mocks.markPendingAdminActionDecisionIfPending.mockResolvedValue(null);

    const interaction = makeInteraction({
      member: {
        permissions: ADMIN_AND_MODERATE_MEMBER_PERMISSIONS,
      },
    });
    const handled = await handleAdminActionButtonInteraction(interaction as never);

    expect(handled).toBe(true);
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Action is already executed.',
      ephemeral: true,
    });
    expect(mocks.markPendingAdminActionExecutedIfApproved).not.toHaveBeenCalled();
  });

  it('records a noop result when deleting a message that is already gone', async () => {
    const pendingAction = makePendingAction({
      prepared: {
        version: 1,
        originalRequest: {
          action: 'delete_message',
          channelId: 'chan-target',
          messageId: 'msg-1',
          reason: 'Spam cleanup',
        },
        canonicalAction: {
          action: 'delete_message',
          channelId: 'chan-target',
          messageId: 'msg-1',
          reason: 'Spam cleanup',
        },
        evidence: {
          targetKind: 'message',
          source: 'reply_target',
          channelId: 'chan-target',
          messageId: 'msg-1',
          messageUrl: 'https://discord.com/channels/guild-1/chan-target/msg-1',
          userId: 'user-8',
          messageAuthorId: 'user-8',
          messageAuthorDisplayName: 'Spammer',
          messageExcerpt: 'spam',
        },
        preflight: {
          approverPermission: 'Manage Messages',
          botPermissionChecks: ['Manage Messages'],
          targetChannelScope: 'chan-target',
          hierarchyChecked: false,
          notes: ['Resolved from reply target.'],
        },
        dedupeKey: '{"action":"delete_message","channelId":"chan-target","messageId":"msg-1","reason":"Spam cleanup"}',
      },
    });
    mocks.getPendingAdminActionById.mockResolvedValueOnce(pendingAction).mockResolvedValueOnce(null);
    mocks.guild.members.fetch.mockResolvedValueOnce(mocks.approverMemberWithManageMessages);
    mocks.markPendingAdminActionDecisionIfPending.mockResolvedValue({
      ...pendingAction,
      status: 'approved',
    });
    mocks.discordRestRequestGuildScoped.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      error: 'Unknown Message',
    });
    mocks.markPendingAdminActionExecutedIfApproved.mockResolvedValue(null);

    const interaction = makeInteraction();
    const handled = await handleAdminActionButtonInteraction(interaction as never);

    expect(handled).toBe(true);
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(mocks.markPendingAdminActionExecutedIfApproved).toHaveBeenCalledWith({
      id: 'action-1',
      resultJson: {
        action: 'delete_message',
        channelId: 'chan-target',
        messageId: 'msg-1',
        noop: true,
        status: 'noop',
      },
    });
  });

  it('records a noop result when the target reaction is already missing', async () => {
    const pendingAction = makePendingAction({
      prepared: {
        version: 1,
        originalRequest: {
          action: 'remove_user_reaction',
          channelId: 'chan-target',
          messageId: 'msg-1',
          emoji: '🔥',
          userId: 'user-8',
          reason: 'Reaction cleanup',
        },
        canonicalAction: {
          action: 'remove_user_reaction',
          channelId: 'chan-target',
          messageId: 'msg-1',
          emoji: '🔥',
          userId: 'user-8',
          reason: 'Reaction cleanup',
        },
        evidence: {
          targetKind: 'reaction',
          source: 'explicit_id',
          channelId: 'chan-target',
          messageId: 'msg-1',
          messageUrl: 'https://discord.com/channels/guild-1/chan-target/msg-1',
          userId: 'user-8',
          messageAuthorId: 'user-8',
          messageAuthorDisplayName: 'Spammer',
          messageExcerpt: 'spam',
        },
        preflight: {
          approverPermission: 'Manage Messages',
          botPermissionChecks: ['Manage Messages', 'Read Message History'],
          targetChannelScope: 'chan-target',
          hierarchyChecked: false,
          notes: ['Resolved from explicit identifiers.'],
        },
        dedupeKey: '{"action":"remove_user_reaction","channelId":"chan-target","emoji":"🔥","messageId":"msg-1","reason":"Reaction cleanup","userId":"user-8"}',
      },
    });
    mocks.getPendingAdminActionById.mockResolvedValueOnce(pendingAction).mockResolvedValueOnce(null);
    mocks.guild.members.fetch.mockResolvedValueOnce(mocks.approverMemberWithManageMessages);
    mocks.markPendingAdminActionDecisionIfPending.mockResolvedValue({
      ...pendingAction,
      status: 'approved',
    });
    mocks.targetChannel.messages.fetch.mockResolvedValueOnce({
      id: 'msg-1',
      reactions: {
        resolve: vi.fn(() => null),
        fetch: vi.fn(async () => null),
        cache: new Map(),
      },
    });
    mocks.markPendingAdminActionExecutedIfApproved.mockResolvedValue(null);

    const interaction = makeInteraction();
    const handled = await handleAdminActionButtonInteraction(interaction as never);

    expect(handled).toBe(true);
    expect(mocks.markPendingAdminActionExecutedIfApproved).toHaveBeenCalledWith({
      id: 'action-1',
      resultJson: {
        action: 'remove_user_reaction',
        channelId: 'chan-target',
        emoji: '🔥',
        messageId: 'msg-1',
        noop: true,
        status: 'noop',
        userId: 'user-8',
      },
    });
  });

  it('records a noop result when unbanning a user who is already not banned', async () => {
    const pendingAction = makePendingAction({
      prepared: {
        version: 1,
        originalRequest: {
          action: 'unban_member',
          userId: 'user-8',
          reason: 'Appeal accepted',
        },
        canonicalAction: {
          action: 'unban_member',
          userId: 'user-8',
          reason: 'Appeal accepted',
        },
        evidence: {
          targetKind: 'member',
          source: 'explicit_id',
          channelId: null,
          messageId: null,
          messageUrl: null,
          userId: 'user-8',
          messageAuthorId: null,
          messageAuthorDisplayName: null,
          messageExcerpt: null,
        },
        preflight: {
          approverPermission: 'Ban Members',
          botPermissionChecks: ['Ban Members'],
          targetChannelScope: null,
          hierarchyChecked: false,
          notes: ['Resolved from explicit user reference.'],
        },
        dedupeKey: '{"action":"unban_member","reason":"Appeal accepted","userId":"user-8"}',
      },
    });
    mocks.getPendingAdminActionById.mockResolvedValueOnce(pendingAction).mockResolvedValueOnce(null);
    mocks.markPendingAdminActionDecisionIfPending.mockResolvedValue({
      ...pendingAction,
      status: 'approved',
    });
    mocks.guild.bans.fetch.mockRejectedValueOnce({ code: 10026 });
    mocks.markPendingAdminActionExecutedIfApproved.mockResolvedValue(null);

    const interaction = makeInteraction({
      member: {
        permissions: ADMIN_AND_BAN_MEMBER_PERMISSIONS,
      },
    });
    const handled = await handleAdminActionButtonInteraction(interaction as never);

    expect(handled).toBe(true);
    expect(mocks.markPendingAdminActionExecutedIfApproved).toHaveBeenCalledWith({
      id: 'action-1',
      resultJson: {
        action: 'unban_member',
        noop: true,
        status: 'noop',
        userId: 'user-8',
      },
    });
  });
});

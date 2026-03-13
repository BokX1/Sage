import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsBitField } from 'discord.js';
import type { ApprovalReviewRequestRecord } from '@/features/admin/approvalReviewRequestRepo';

const ADMIN_MEMBER_PERMISSIONS = String(PermissionsBitField.Flags.ManageGuild);
const ADMIN_AND_MODERATE_MEMBER_PERMISSIONS = String(
  PermissionsBitField.Flags.ManageGuild | PermissionsBitField.Flags.ModerateMembers,
);
const DISCORD_SNOWFLAKE_EPOCH_MS = 1_420_070_400_000n;

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
    createApprovalReviewRequest: vi.fn(),
    attachApprovalReviewRequesterStatusMessageId: vi.fn(),
    clearApprovalReviewReviewerMessageId: vi.fn(),
    findMatchingPendingApprovalReviewRequest: vi.fn(),
    getApprovalReviewRequestById: vi.fn(),
    listPendingApprovalReviewsExpiredBy: vi.fn(),
    markApprovalReviewRequestDecisionIfPending: vi.fn(),
    markApprovalReviewRequestExecutedIfApproved: vi.fn(),
    markApprovalReviewRequestExpired: vi.fn(),
    markApprovalReviewRequestExpiredIfPending: vi.fn(),
    markApprovalReviewRequestFailedIfApproved: vi.fn(),
    updateApprovalReviewSurface: vi.fn(),
    clearGuildSagePersona: vi.fn(),
    getGuildSagePersonaRecord: vi.fn(),
    upsertGuildSagePersona: vi.fn(),
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
    resumeAgentGraphTurn: vi.fn(async () => ({
      replyText: 'Approved. I completed that action.',
      toolResults: [],
      files: [],
      roundsCompleted: 1,
      completedWindows: 0,
      totalRoundsCompleted: 1,
      deduplicatedCallCount: 0,
      truncatedCallCount: 0,
      guardrailBlockedCallCount: 0,
      roundEvents: [],
      finalization: {
        attempted: false,
        succeeded: true,
        fallbackUsed: false,
        returnedToolCallCount: 0,
        completedAt: '2026-03-12T00:00:00.000Z',
        terminationReason: 'assistant_reply',
      },
      terminationReason: 'assistant_reply',
      graphStatus: 'completed',
      pendingInterrupt: null,
      interruptResolution: null,
      langSmithRunId: null,
      langSmithTraceId: null,
    })),
    upsertTraceStart: vi.fn(),
    updateTraceEnd: vi.fn(),
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

vi.mock('@/features/admin/approvalReviewRequestRepo', () => ({
  createApprovalReviewRequest: mocks.createApprovalReviewRequest,
  attachApprovalReviewRequesterStatusMessageId: mocks.attachApprovalReviewRequesterStatusMessageId,
  clearApprovalReviewReviewerMessageId: mocks.clearApprovalReviewReviewerMessageId,
  findMatchingPendingApprovalReviewRequest: mocks.findMatchingPendingApprovalReviewRequest,
  getApprovalReviewRequestById: mocks.getApprovalReviewRequestById,
  listPendingApprovalReviewsExpiredBy: mocks.listPendingApprovalReviewsExpiredBy,
  markApprovalReviewRequestDecisionIfPending: mocks.markApprovalReviewRequestDecisionIfPending,
  markApprovalReviewRequestExecutedIfApproved: mocks.markApprovalReviewRequestExecutedIfApproved,
  markApprovalReviewRequestExpired: mocks.markApprovalReviewRequestExpired,
  markApprovalReviewRequestExpiredIfPending: mocks.markApprovalReviewRequestExpiredIfPending,
  markApprovalReviewRequestFailedIfApproved: mocks.markApprovalReviewRequestFailedIfApproved,
  updateApprovalReviewSurface: mocks.updateApprovalReviewSurface,
}));

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

vi.mock('@/features/agent-runtime/langgraph/runtime', () => ({
  resumeAgentGraphTurn: mocks.resumeAgentGraphTurn,
}));

vi.mock('@/features/agent-runtime/agent-trace-repo', () => ({
  upsertTraceStart: mocks.upsertTraceStart,
  updateTraceEnd: mocks.updateTraceEnd,
}));

import {
  createOrReuseApprovalReviewRequestFromSignal,
  executeApprovedReviewRequest,
  handleAdminActionButtonInteraction,
  reconcileExpiredApprovalReviewRequests,
} from '@/features/admin/adminActionService';
import { ApprovalRequiredSignal } from '@/features/agent-runtime/toolControlSignals';

function makeReviewRequest(executionPayloadJson: unknown, overrides: Partial<ApprovalReviewRequestRecord> = {}): ApprovalReviewRequestRecord {
  return {
    id: 'action-1',
    threadId: 'thread-1',
    originTraceId: 'trace-origin-1',
    resumeTraceId: null,
    guildId: 'guild-1',
    sourceChannelId: 'channel-source',
    reviewChannelId: 'channel-review',
    sourceMessageId: 'message-source',
    requesterStatusMessageId: 'request-1',
    reviewerMessageId: 'approval-1',
    requestedBy: 'admin-1',
    kind: 'discord_queue_moderation_action',
    dedupeKey: 'dedupe-key',
    executionPayloadJson,
    reviewSnapshotJson: executionPayloadJson,
    interruptMetadataJson: { kind: 'discord_queue_moderation_action' },
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
    decidedBy: null,
    decidedAt: null,
    executedAt: null,
    resultJson: null,
    decisionReasonText: null,
    errorText: null,
    createdAt: new Date('2026-03-12T00:00:00.000Z'),
    updatedAt: new Date('2026-03-12T00:00:00.000Z'),
    ...overrides,
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

function snowflakeFromTimestampMs(timestampMs: number, increment = 0): string {
  const timestampPart = (BigInt(Math.trunc(timestampMs)) - DISCORD_SNOWFLAKE_EPOCH_MS) << 22n;
  return String(timestampPart + BigInt(increment));
}

function makeApprovedBulkDeleteRequest(messageIds: string[]): ApprovalReviewRequestRecord {
  return makeReviewRequest(
    {
      prepared: {
        version: 1,
        originalRequest: {
          action: 'bulk_delete_messages',
          channelId: 'chan-target',
          messageIds,
          reason: 'Raid cleanup',
        },
        canonicalAction: {
          action: 'bulk_delete_messages',
          channelId: 'chan-target',
          messageIds,
          reason: 'Raid cleanup',
        },
        evidence: {
          targetKind: 'message',
          source: 'bulk_explicit_ids',
          channelId: 'chan-target',
          messageId: messageIds[0] ?? null,
          messageUrl: messageIds[0] ? `https://discord.com/channels/guild-1/chan-target/${messageIds[0]}` : null,
          userId: null,
          messageAuthorId: null,
          messageAuthorDisplayName: null,
          messageExcerpt: `Resolved ${messageIds.length} explicit message target(s) for bulk deletion.`,
        },
        preflight: {
          approverPermission: 'Manage Messages',
          botPermissionChecks: ['Manage Messages'],
          targetChannelScope: 'chan-target',
          hierarchyChecked: false,
          notes: ['Resolved explicit targets.'],
        },
        dedupeKey:
          '{"action":"bulk_delete_messages","channelId":"chan-target","messageIds":["msg-1"],"reason":"Raid cleanup"}',
      },
    },
    { status: 'approved' },
  );
}

describe('adminActionService approval permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logAdminAction.mockResolvedValue(undefined);
    mocks.upsertTraceStart.mockResolvedValue(undefined);
    mocks.updateTraceEnd.mockResolvedValue(undefined);
  });

  it('skips requester status card publication when review and source channels are the same', async () => {
    const pending = makeReviewRequest(
      {
        operation: 'set',
        newInstructionsText: 'Keep replies short.',
        reason: 'Tone refresh',
        baseVersion: 2,
      },
      {
        kind: 'server_instructions_update',
        sourceChannelId: 'channel-source',
        reviewChannelId: 'channel-source',
        requesterStatusMessageId: null,
        reviewerMessageId: null,
      },
    );

    mocks.findMatchingPendingApprovalReviewRequest.mockResolvedValue(null);
    mocks.createApprovalReviewRequest.mockResolvedValue(pending);
    mocks.updateApprovalReviewSurface.mockResolvedValue({
      ...pending,
      reviewerMessageId: 'approval-1',
    });

    await createOrReuseApprovalReviewRequestFromSignal({
      threadId: 'thread-1',
      originTraceId: 'trace-origin-1',
      signal: new ApprovalRequiredSignal({
        kind: 'server_instructions_update',
        guildId: 'guild-1',
        sourceChannelId: 'channel-source',
        reviewChannelId: 'channel-source',
        sourceMessageId: 'message-source',
        requestedBy: 'admin-1',
        dedupeKey: 'dedupe-key',
        executionPayloadJson: pending.executionPayloadJson,
        reviewSnapshotJson: pending.reviewSnapshotJson,
      }),
    });

    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledTimes(1);
    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/channels/channel-source/messages',
      }),
    );
    expect(mocks.attachApprovalReviewRequesterStatusMessageId).not.toHaveBeenCalled();
  });

  it('posts a requester acknowledgement when a same-channel approval request coalesces onto an existing reviewer card', async () => {
    const pending = makeReviewRequest(
      {
        operation: 'set',
        newInstructionsText: 'Keep replies short.',
        reason: 'Tone refresh',
        baseVersion: 2,
      },
      {
        kind: 'server_instructions_update',
        sourceChannelId: 'channel-source',
        reviewChannelId: 'channel-source',
        requesterStatusMessageId: null,
        reviewerMessageId: 'approval-existing',
      },
    );

    mocks.findMatchingPendingApprovalReviewRequest.mockResolvedValue(pending);
    mocks.getApprovalReviewRequestById.mockResolvedValue(pending);
    mocks.attachApprovalReviewRequesterStatusMessageId.mockResolvedValue({
      ...pending,
      requesterStatusMessageId: 'requester-2',
    });

    await createOrReuseApprovalReviewRequestFromSignal({
      threadId: 'thread-1',
      originTraceId: 'trace-origin-1',
      signal: new ApprovalRequiredSignal({
        kind: 'server_instructions_update',
        guildId: 'guild-1',
        sourceChannelId: 'channel-source',
        reviewChannelId: 'channel-source',
        sourceMessageId: 'message-source-2',
        requestedBy: 'admin-1',
        dedupeKey: 'dedupe-key',
        executionPayloadJson: pending.executionPayloadJson,
        reviewSnapshotJson: pending.reviewSnapshotJson,
      }),
    });

    expect(mocks.createApprovalReviewRequest).not.toHaveBeenCalled();
    expect(mocks.updateApprovalReviewSurface).not.toHaveBeenCalled();
    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledTimes(1);
    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/channels/channel-source/messages',
      }),
    );
    expect(mocks.attachApprovalReviewRequesterStatusMessageId).toHaveBeenCalledWith({
      id: 'action-1',
      requesterStatusMessageId: 'message-1',
    });
  });

  it('does not fail the turn when requester status publication errors after the review card is already posted', async () => {
    const pending = makeReviewRequest(
      {
        operation: 'set',
        newInstructionsText: 'Keep replies short.',
        reason: 'Tone refresh',
        baseVersion: 2,
      },
      {
        kind: 'server_instructions_update',
        sourceChannelId: 'channel-source',
        reviewChannelId: 'channel-review',
        requesterStatusMessageId: null,
        reviewerMessageId: null,
      },
    );

    mocks.findMatchingPendingApprovalReviewRequest.mockResolvedValue(null);
    mocks.createApprovalReviewRequest.mockResolvedValue(pending);
    mocks.updateApprovalReviewSurface.mockResolvedValue({
      ...pending,
      reviewerMessageId: 'approval-1',
    });
    mocks.discordRestRequestGuildScoped
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        data: { id: 'approval-1' },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        error: 'requester status failed',
      });

    await expect(
      createOrReuseApprovalReviewRequestFromSignal({
        threadId: 'thread-1',
        originTraceId: 'trace-origin-1',
        signal: new ApprovalRequiredSignal({
          kind: 'server_instructions_update',
          guildId: 'guild-1',
          sourceChannelId: 'channel-source',
          reviewChannelId: 'channel-review',
          sourceMessageId: 'message-source',
          requestedBy: 'admin-1',
          dedupeKey: 'dedupe-key',
          executionPayloadJson: pending.executionPayloadJson,
          reviewSnapshotJson: pending.reviewSnapshotJson,
        }),
      }),
    ).resolves.toMatchObject({
      request: expect.objectContaining({
        id: 'action-1',
      }),
      coalesced: false,
    });

    expect(mocks.updateApprovalReviewSurface).toHaveBeenCalledWith({
      id: 'action-1',
      reviewChannelId: 'channel-review',
      reviewerMessageId: 'approval-1',
    });
    expect(mocks.attachApprovalReviewRequesterStatusMessageId).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        adminId: 'admin-1',
        command: 'tool_server_instructions_update',
      }),
    );
  });

  it('posts the resumed approval acknowledgement back to the source channel', async () => {
    const action = makeReviewRequest(
      {
        operation: 'set',
        newInstructionsText: 'Keep replies short.',
        reason: 'Tone refresh',
        baseVersion: 2,
      },
      {
        kind: 'server_instructions_update',
      },
    );
    const approved = {
      ...action,
      status: 'approved' as const,
      decidedBy: 'admin-2',
      decidedAt: new Date('2026-03-12T00:01:00.000Z'),
    };

    mocks.getApprovalReviewRequestById.mockResolvedValue(action);
    mocks.markApprovalReviewRequestDecisionIfPending.mockResolvedValue(approved);
    mocks.resumeAgentGraphTurn.mockResolvedValue({
      replyText: 'Approved. I completed that action.',
      toolResults: [],
      files: [],
      roundsCompleted: 1,
      completedWindows: 0,
      totalRoundsCompleted: 1,
      deduplicatedCallCount: 0,
      truncatedCallCount: 0,
      guardrailBlockedCallCount: 0,
      roundEvents: [],
      finalization: {
        attempted: false,
        succeeded: true,
        fallbackUsed: false,
        returnedToolCallCount: 0,
        completedAt: '2026-03-12T00:00:00.000Z',
        terminationReason: 'assistant_reply',
      },
      terminationReason: 'assistant_reply',
      graphStatus: 'completed',
      pendingInterrupt: null,
      interruptResolution: null,
      langSmithRunId: null,
      langSmithTraceId: null,
    });

    await handleAdminActionButtonInteraction(
      makeInteraction({
        customId: 'sage:admin_action:approve:action-1',
      }) as never,
    );

    expect(mocks.resumeAgentGraphTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        resume: expect.objectContaining({
          interruptKind: 'approval_review',
          status: 'approved',
        }),
      }),
    );
    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/channels/channel-source/messages',
        body: expect.objectContaining({
          content: 'Approved. I completed that action.',
          message_reference: {
            message_id: 'message-source',
            fail_if_not_exists: false,
          },
        }),
      }),
    );
  });

  it('reconciles expired pending approvals and resumes their LangGraph threads once', async () => {
    const now = new Date('2026-03-12T00:10:00.000Z');
    const pending = makeReviewRequest(
      {
        operation: 'set',
        newInstructionsText: 'Keep replies short.',
        reason: 'Tone refresh',
        baseVersion: 2,
      },
      {
        kind: 'server_instructions_update',
        status: 'pending',
        expiresAt: new Date('2026-03-12T00:00:00.000Z'),
      },
    );
    const expired = {
      ...pending,
      status: 'expired' as const,
      decidedAt: now,
      resumeTraceId: 'trace-expired-1',
    };

    mocks.listPendingApprovalReviewsExpiredBy.mockResolvedValue([pending]);
    mocks.markApprovalReviewRequestExpiredIfPending.mockResolvedValue(expired);
    mocks.resumeAgentGraphTurn.mockResolvedValue({
      replyText: 'The approval expired before anyone approved it.',
      toolResults: [],
      files: [],
      roundsCompleted: 1,
      completedWindows: 0,
      totalRoundsCompleted: 1,
      deduplicatedCallCount: 0,
      truncatedCallCount: 0,
      guardrailBlockedCallCount: 0,
      roundEvents: [],
      finalization: {
        attempted: false,
        succeeded: true,
        fallbackUsed: false,
        returnedToolCallCount: 0,
        completedAt: '2026-03-12T00:00:00.000Z',
        terminationReason: 'assistant_reply',
      },
      terminationReason: 'assistant_reply',
      graphStatus: 'completed',
      pendingInterrupt: null,
      interruptResolution: null,
      langSmithRunId: null,
      langSmithTraceId: null,
    });

    const resolvedCount = await reconcileExpiredApprovalReviewRequests({ now, limit: 10 });

    expect(resolvedCount).toBe(1);
    expect(mocks.markApprovalReviewRequestExpiredIfPending).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'action-1',
        now,
      }),
    );
    expect(mocks.resumeAgentGraphTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        resume: expect.objectContaining({
          interruptKind: 'approval_review',
          status: 'expired',
        }),
      }),
    );
    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/channels/channel-source/messages',
        body: expect.objectContaining({
          content: 'The approval expired before anyone approved it.',
        }),
      }),
    );
  });

  it('checks approver permissions in the target channel for message moderation approvals', async () => {
    mocks.getApprovalReviewRequestById.mockResolvedValue(
      makeReviewRequest({
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
          dedupeKey:
            '{"action":"delete_message","channelId":"chan-target","messageId":"msg-1","reason":"Spam cleanup"}',
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
    expect(mocks.markApprovalReviewRequestDecisionIfPending).not.toHaveBeenCalled();
  });

  it('checks approver permissions in the target channel for bulk moderation approvals', async () => {
    mocks.getApprovalReviewRequestById.mockResolvedValue(
      makeReviewRequest({
        prepared: {
          version: 1,
          originalRequest: {
            action: 'bulk_delete_messages',
            channelId: 'chan-target',
            messageIds: ['msg-1', 'msg-2'],
            reason: 'Raid cleanup',
          },
          canonicalAction: {
            action: 'bulk_delete_messages',
            channelId: 'chan-target',
            messageIds: ['msg-1', 'msg-2'],
            reason: 'Raid cleanup',
          },
          evidence: {
            targetKind: 'message',
            source: 'bulk_explicit_ids',
            channelId: 'chan-target',
            messageId: 'msg-1',
            messageUrl: 'https://discord.com/channels/guild-1/chan-target/msg-1',
            userId: null,
            messageAuthorId: null,
            messageAuthorDisplayName: null,
            messageExcerpt: 'bulk',
          },
          preflight: {
            approverPermission: 'Manage Messages',
            botPermissionChecks: ['Manage Messages'],
            targetChannelScope: 'chan-target',
            hierarchyChecked: false,
            notes: ['Resolved explicit targets.'],
          },
          dedupeKey:
            '{"action":"bulk_delete_messages","channelId":"chan-target","messageIds":["msg-1","msg-2"],"reason":"Raid cleanup"}',
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
    expect(mocks.markApprovalReviewRequestDecisionIfPending).not.toHaveBeenCalled();
  });

  it('uses guild-level moderation permissions for member moderation approvals', async () => {
    mocks.getApprovalReviewRequestById.mockResolvedValue(
      makeReviewRequest({
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
          dedupeKey:
            '{"action":"timeout_member","durationMinutes":30,"reason":"Spam cleanup","userId":"user-8"}',
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
    expect(mocks.markApprovalReviewRequestDecisionIfPending).not.toHaveBeenCalled();
  });

  it('handles an approval race without executing the action twice', async () => {
    mocks.getApprovalReviewRequestById.mockResolvedValueOnce(
      makeReviewRequest({
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
          dedupeKey:
            '{"action":"timeout_member","durationMinutes":30,"reason":"Spam cleanup","userId":"user-8"}',
        },
      }),
    ).mockResolvedValueOnce(null);
    mocks.markApprovalReviewRequestDecisionIfPending.mockResolvedValue(null);

    const interaction = makeInteraction({
      member: {
        permissions: ADMIN_AND_MODERATE_MEMBER_PERMISSIONS,
      },
    });
    const handled = await handleAdminActionButtonInteraction(interaction as never);

    expect(handled).toBe(true);
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Action is already resolved.',
      ephemeral: true,
    });
    expect(mocks.resumeAgentGraphTurn).not.toHaveBeenCalled();
  });

  it('records a noop result when deleting a message that is already gone', async () => {
    const approved = makeReviewRequest(
      {
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
          dedupeKey:
            '{"action":"delete_message","channelId":"chan-target","messageId":"msg-1","reason":"Spam cleanup"}',
        },
      },
      { status: 'approved' },
    );
    mocks.getApprovalReviewRequestById.mockResolvedValueOnce(approved).mockResolvedValueOnce(null);
    mocks.discordRestRequestGuildScoped.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      error: 'Unknown Message',
    });
    mocks.markApprovalReviewRequestExecutedIfApproved.mockResolvedValue(null);

    const result = await executeApprovedReviewRequest({
      requestId: 'action-1',
      reviewerId: 'admin-2',
    });

    expect(result).toBeNull();
    expect(mocks.markApprovalReviewRequestExecutedIfApproved).toHaveBeenCalledWith({
      id: 'action-1',
      resultJson: {
        action: 'delete_message',
        channelId: 'chan-target',
        messageId: 'msg-1',
        noop: true,
        status: 'noop',
      },
      resumeTraceId: null,
    });
  });

  it('chunks bulk-delete moderation into 100-message requests and skips older-than-14-day targets', async () => {
    const now = Date.now();
    const eligibleIds = Array.from({ length: 205 }, (_, index) =>
      snowflakeFromTimestampMs(now - 60_000 - index * 1_000, index + 1),
    );
    const tooOldId = snowflakeFromTimestampMs(now - (15 * 24 * 60 * 60 * 1_000), 999);
    const approved = makeApprovedBulkDeleteRequest([...eligibleIds, tooOldId]);

    mocks.getApprovalReviewRequestById.mockResolvedValueOnce(approved).mockResolvedValueOnce(null);
    mocks.discordRestRequestGuildScoped.mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      data: { id: 'bulk-ok' },
    });
    mocks.markApprovalReviewRequestExecutedIfApproved.mockResolvedValue(null);

    const result = await executeApprovedReviewRequest({
      requestId: 'action-1',
      reviewerId: 'admin-2',
    });

    expect(result).toBeNull();
    const bulkCalls = mocks.discordRestRequestGuildScoped.mock.calls as unknown as Array<
      [
        {
          method?: string;
          path?: string;
          body?: { messages?: string[] };
        },
      ]
    >;
    expect(bulkCalls).toHaveLength(3);
    expect(bulkCalls.every(([call]) => call.method === 'POST')).toBe(true);
    expect(bulkCalls.every(([call]) => call.path === '/channels/chan-target/messages/bulk-delete')).toBe(true);
    expect((bulkCalls[0]?.[0]?.body?.messages ?? [])).toHaveLength(100);
    expect((bulkCalls[1]?.[0]?.body?.messages ?? [])).toHaveLength(100);
    expect((bulkCalls[2]?.[0]?.body?.messages ?? [])).toHaveLength(5);
    expect(mocks.markApprovalReviewRequestExecutedIfApproved).toHaveBeenCalledWith({
      id: 'action-1',
      resultJson: expect.objectContaining({
        action: 'bulk_delete_messages',
        channelId: 'chan-target',
        requested: 206,
        eligible: 205,
        deleted: 205,
        skipped_too_old: 1,
        not_found: 0,
        noop: false,
        status: 'executed',
      }),
      resumeTraceId: null,
    });
  });

  it('uses single-message delete for a one-item eligible bulk-delete set', async () => {
    const now = Date.now();
    const eligibleId = snowflakeFromTimestampMs(now - 45_000, 1);
    const tooOldId = snowflakeFromTimestampMs(now - (15 * 24 * 60 * 60 * 1_000), 2);
    const approved = makeApprovedBulkDeleteRequest([eligibleId, tooOldId]);

    mocks.getApprovalReviewRequestById.mockResolvedValueOnce(approved).mockResolvedValueOnce(null);
    mocks.discordRestRequestGuildScoped.mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      data: { id: 'bulk-ok' },
    });
    mocks.markApprovalReviewRequestExecutedIfApproved.mockResolvedValue(null);

    const result = await executeApprovedReviewRequest({
      requestId: 'action-1',
      reviewerId: 'admin-2',
    });

    expect(result).toBeNull();
    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledTimes(1);
    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: `/channels/chan-target/messages/${eligibleId}`,
      }),
    );
    expect(mocks.markApprovalReviewRequestExecutedIfApproved).toHaveBeenCalledWith({
      id: 'action-1',
      resultJson: expect.objectContaining({
        action: 'bulk_delete_messages',
        channelId: 'chan-target',
        requested: 2,
        eligible: 1,
        deleted: 1,
        skipped_too_old: 1,
        not_found: 0,
        noop: false,
        status: 'executed',
      }),
      resumeTraceId: null,
    });
  });

  it('records a noop result when the target reaction is already missing', async () => {
    const approved = makeReviewRequest(
      {
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
          dedupeKey:
            '{"action":"remove_user_reaction","channelId":"chan-target","emoji":"🔥","messageId":"msg-1","reason":"Reaction cleanup","userId":"user-8"}',
        },
      },
      { status: 'approved' },
    );
    mocks.getApprovalReviewRequestById.mockResolvedValueOnce(approved).mockResolvedValueOnce(null);
    mocks.targetChannel.messages.fetch.mockResolvedValueOnce({
      id: 'msg-1',
      reactions: {
        resolve: vi.fn(() => null),
        fetch: vi.fn(async () => null),
        cache: new Map(),
      },
    });
    mocks.markApprovalReviewRequestExecutedIfApproved.mockResolvedValue(null);

    const result = await executeApprovedReviewRequest({
      requestId: 'action-1',
      reviewerId: 'admin-2',
    });

    expect(result).toBeNull();
    expect(mocks.markApprovalReviewRequestExecutedIfApproved).toHaveBeenCalledWith({
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
      resumeTraceId: null,
    });
  });

  it('records a noop result when unbanning a user who is already not banned', async () => {
    const approved = makeReviewRequest(
      {
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
      },
      { status: 'approved' },
    );
    mocks.getApprovalReviewRequestById.mockResolvedValueOnce(approved).mockResolvedValueOnce(null);
    mocks.guild.bans.fetch.mockRejectedValueOnce({ code: 10026 });
    mocks.markApprovalReviewRequestExecutedIfApproved.mockResolvedValue(null);

    const result = await executeApprovedReviewRequest({
      requestId: 'action-1',
      reviewerId: 'admin-2',
    });

    expect(result).toBeNull();
    expect(mocks.markApprovalReviewRequestExecutedIfApproved).toHaveBeenCalledWith({
      id: 'action-1',
      resultJson: {
        action: 'unban_member',
        noop: true,
        status: 'noop',
        userId: 'user-8',
      },
      resumeTraceId: null,
    });
  });
});

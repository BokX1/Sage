import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';

import {
  buildApprovalReviewDetailsText,
  buildApprovalReviewRequesterCardPayload,
  buildApprovalReviewReviewerCardPayload,
} from '@/features/admin/governanceCards';
import type { ApprovalReviewRequestRecord } from '@/features/admin/approvalReviewRequestRepo';

function makeReviewRequest(
  overrides: Partial<ApprovalReviewRequestRecord> = {},
): ApprovalReviewRequestRecord {
  return {
    id: 'action-123',
    threadId: 'thread-123',
    originTraceId: 'trace-origin-123',
    resumeTraceId: null,
    guildId: 'guild-1',
    sourceChannelId: 'channel-source',
    reviewChannelId: 'channel-review',
    sourceMessageId: 'message-source',
    requesterStatusMessageId: 'request-1',
    reviewerMessageId: 'approval-1',
    requestedBy: 'user-1',
    kind: 'server_instructions_update',
    dedupeKey: '{"operation":"set"}',
    executionPayloadJson: {
      operation: 'set',
      newInstructionsText: 'Keep replies concise and Discord-native.',
      reason: 'Refresh tone',
      baseVersion: 4,
    },
    reviewSnapshotJson: {
      operation: 'set',
      newInstructionsText: 'Keep replies concise and Discord-native.',
      reason: 'Refresh tone',
      baseVersion: 4,
    },
    interruptMetadataJson: {
      reasonHash: 'hash',
    },
    status: 'pending',
    expiresAt: new Date('2026-03-10T08:00:00.000Z'),
    decidedBy: null,
    decidedAt: null,
    executedAt: null,
    resultJson: null,
    decisionReasonText: null,
    errorText: null,
    createdAt: new Date('2026-03-10T07:45:00.000Z'),
    updatedAt: new Date('2026-03-10T07:45:00.000Z'),
    ...overrides,
  };
}

describe('governanceCards', () => {
  it('renders coalesced requester cards without raw action IDs', () => {
    const payload = buildApprovalReviewRequesterCardPayload({
      action: makeReviewRequest(),
      coalesced: true,
    });

    const serialized = JSON.stringify(payload);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(serialized).toContain('Joined existing review');
    expect(serialized).toContain('<#channel-review>');
    expect(serialized).not.toContain('action-123');
  });

  it('renders reviewer cards with approve, reject, and details controls', () => {
    const payload = buildApprovalReviewReviewerCardPayload({
      action: makeReviewRequest(),
      approveCustomId: 'approve-1',
      rejectCustomId: 'reject-1',
      detailsCustomId: 'details-1',
    });

    const serialized = JSON.stringify(payload);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(serialized).toContain('Review required');
    expect(serialized).toContain('Approve');
    expect(serialized).toContain('Reject');
    expect(serialized).toContain('Details');
  });

  it('puts operational metadata in details text and requester-facing reason text on rejection', () => {
    const action = makeReviewRequest({
      status: 'rejected',
      decidedBy: 'admin-1',
      decidedAt: new Date('2026-03-10T07:50:00.000Z'),
      decisionReasonText: 'Need legal review before changing policy.',
    });

    const requesterPayload = buildApprovalReviewRequesterCardPayload({ action });
    const requesterSerialized = JSON.stringify(requesterPayload);
    const detailsText = buildApprovalReviewDetailsText(action);

    expect(requesterSerialized).toContain('Rejected');
    expect(requesterSerialized).toContain('Need legal review before changing policy.');
    expect(detailsText).toContain('Action ID: `action-123`');
    expect(detailsText).toContain('Review channel: <#channel-review>');
  });

  it('shows prepared moderation evidence and preflight details in the reviewer details text', () => {
    const action = makeReviewRequest({
      kind: 'discord_queue_moderation_action',
      executionPayloadJson: {
        prepared: {
          version: 1,
          originalRequest: {
            action: 'delete_message',
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
            messageExcerpt: 'buy cheap spam now',
          },
          preflight: {
            approverPermission: 'Manage Messages',
            botPermissionChecks: ['Manage Messages', 'Read Message History'],
            targetChannelScope: 'chan-target',
            hierarchyChecked: false,
            notes: ['Resolved from direct reply target.'],
          },
          dedupeKey:
            '{"action":"delete_message","channelId":"chan-target","messageId":"msg-1","reason":"Spam cleanup"}',
        },
      },
      reviewSnapshotJson: {
        action: 'delete_message',
      },
    });

    const detailsText = buildApprovalReviewDetailsText(action);

    expect(detailsText).toContain('Approver permission: Manage Messages');
    expect(detailsText).toContain('Target channel scope: <#chan-target>');
    expect(detailsText).toContain('Message link: https://discord.com/channels/guild-1/chan-target/msg-1');
    expect(detailsText).toContain('Evidence author: Spammer (user-8)');
    expect(detailsText).toContain('Evidence excerpt: buy cheap spam now');
    expect(detailsText).toContain('Bot checks: Manage Messages, Read Message History');
    expect(detailsText).toContain('Preflight notes: Resolved from direct reply target.');
  });

  it('summarizes bulk moderation outcomes with skipped older-than-14-day counts', () => {
    const action = makeReviewRequest({
      kind: 'discord_queue_moderation_action',
      status: 'executed',
      executedAt: new Date('2026-03-10T07:55:00.000Z'),
      executionPayloadJson: {
        prepared: {
          version: 1,
          originalRequest: {
            action: 'bulk_delete_messages',
            channelId: 'chan-target',
            messageIds: ['msg-1', 'msg-2', 'msg-3'],
            reason: 'Raid cleanup',
          },
          canonicalAction: {
            action: 'bulk_delete_messages',
            channelId: 'chan-target',
            messageIds: ['msg-1', 'msg-2', 'msg-3'],
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
            messageExcerpt: 'bulk cleanup',
          },
          preflight: {
            approverPermission: 'Manage Messages',
            botPermissionChecks: ['Manage Messages'],
            targetChannelScope: 'chan-target',
            hierarchyChecked: false,
            notes: ['Execution policy: skip messages older than 14 days and report them in the outcome summary.'],
          },
          dedupeKey:
            '{"action":"bulk_delete_messages","channelId":"chan-target","messageIds":["msg-1","msg-2","msg-3"],"reason":"Raid cleanup"}',
        },
      },
      reviewSnapshotJson: {
        action: 'bulk_delete_messages',
      },
      resultJson: {
        action: 'bulk_delete_messages',
        status: 'executed',
        requested: 3,
        eligible: 2,
        deleted: 1,
        skipped_too_old: 1,
        not_found: 1,
        noop: false,
      },
    });

    const requesterPayload = buildApprovalReviewRequesterCardPayload({ action });
    const requesterSerialized = JSON.stringify(requesterPayload);
    const detailsText = buildApprovalReviewDetailsText(action);

    expect(requesterSerialized).toContain('Bulk delete messages');
    expect(requesterSerialized).toContain('skipped older than 14 days=1');
    expect(detailsText).toContain('Intent: Bulk delete messages');
    expect(detailsText).toContain(
      'Outcome summary: requested=3, eligible=2, deleted=1, skipped older than 14 days=1, not_found=1.',
    );
  });

  it('renders code mode effect approvals with human-friendly Discord action copy', () => {
    const action = makeReviewRequest({
      kind: 'code_mode_effect',
      executionPayloadJson: {
        executionId: 'exec-123',
        taskId: 'task-123',
        effectIndex: 2,
        effectLabel: 'discord.messages.send',
        requestHash: 'hash-123',
      },
      reviewSnapshotJson: {
        kind: 'code_mode_effect',
        effectLabel: 'discord.messages.send',
        effectIndex: 2,
        executionId: 'exec-123',
        title: 'Sage Action Review',
        intent: 'Send a Discord message',
        target: '<#channel-live>',
        impact: 'Posts a new message in the selected channel.',
        risk: 'low',
        preview: 'Deployment complete. Shipping now.',
      },
    });

    const reviewerPayload = buildApprovalReviewReviewerCardPayload({
      action,
      approveCustomId: 'approve-code',
      rejectCustomId: 'reject-code',
      detailsCustomId: 'details-code',
    });
    const requesterPayload = buildApprovalReviewRequesterCardPayload({ action });
    const detailsText = buildApprovalReviewDetailsText(action);
    const reviewerSerialized = JSON.stringify(reviewerPayload);
    const requesterSerialized = JSON.stringify(requesterPayload);

    expect(reviewerSerialized).toContain('Review required');
    expect(reviewerSerialized).toContain('Send a Discord message');
    expect(reviewerSerialized).toContain('<#channel-live>');
    expect(reviewerSerialized).toContain('Posts a new message in the selected channel.');
    expect(reviewerSerialized).toContain('Low risk');
    expect(reviewerSerialized).toContain('Deployment complete. Shipping now.');
    expect(requesterSerialized).toContain('Send a Discord message');
    expect(requesterSerialized).not.toContain('code_mode_effect');
    expect(detailsText).toContain('Review: Sage Action Review');
    expect(detailsText).toContain('Intent: Send a Discord message');
    expect(detailsText).toContain('Target: <#channel-live>');
  });

  it('falls back to a readable workspace summary for older code mode effect approvals', () => {
    const action = makeReviewRequest({
      kind: 'code_mode_effect',
      executionPayloadJson: {
        executionId: 'exec-legacy',
        taskId: 'task-legacy',
        effectIndex: 1,
        effectLabel: 'workspace.delete',
        requestHash: 'hash-legacy',
      },
      reviewSnapshotJson: {
        kind: 'code_mode_effect',
        effectLabel: 'workspace.delete',
        effectIndex: 1,
        executionId: 'exec-legacy',
      },
    });

    const reviewerPayload = buildApprovalReviewReviewerCardPayload({
      action,
      approveCustomId: 'approve-legacy',
      rejectCustomId: 'reject-legacy',
      detailsCustomId: 'details-legacy',
    });
    const detailsText = buildApprovalReviewDetailsText(action);
    const reviewerSerialized = JSON.stringify(reviewerPayload);

    expect(reviewerSerialized).toContain('Workspace Review');
    expect(reviewerSerialized).toContain('Delete from the task workspace');
    expect(reviewerSerialized).toContain('Current task workspace');
    expect(reviewerSerialized).not.toContain('code_mode_effect');
    expect(detailsText).toContain('Intent: Delete from the task workspace');
    expect(detailsText).toContain('Target: Current task workspace');
  });
});

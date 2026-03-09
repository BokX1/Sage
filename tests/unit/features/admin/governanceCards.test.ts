import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';

import {
  buildPendingAdminActionDetailsText,
  buildPendingAdminActionRequesterCardPayload,
  buildPendingAdminActionReviewerCardPayload,
} from '@/features/admin/governanceCards';
import type { PendingAdminActionRecord } from '@/features/admin/pendingAdminActionRepo';

function makePendingAction(
  overrides: Partial<PendingAdminActionRecord> = {},
): PendingAdminActionRecord {
  return {
    id: 'action-123',
    guildId: 'guild-1',
    sourceChannelId: 'channel-source',
    reviewChannelId: 'channel-review',
    approvalMessageId: 'approval-1',
    requestMessageId: 'request-1',
    requestedBy: 'user-1',
    kind: 'server_instructions_update',
    payloadJson: {
      operation: 'set',
      newInstructionsText: 'Keep replies concise and Discord-native.',
      reason: 'Refresh tone',
      baseVersion: 4,
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
    const payload = buildPendingAdminActionRequesterCardPayload({
      action: makePendingAction(),
      coalesced: true,
    });

    const serialized = JSON.stringify(payload);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(serialized).toContain('Joined existing review');
    expect(serialized).toContain('<#channel-review>');
    expect(serialized).not.toContain('action-123');
  });

  it('renders reviewer cards with approve, reject, and details controls', () => {
    const payload = buildPendingAdminActionReviewerCardPayload({
      action: makePendingAction(),
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
    const action = makePendingAction({
      status: 'rejected',
      decidedBy: 'admin-1',
      decidedAt: new Date('2026-03-10T07:50:00.000Z'),
      decisionReasonText: 'Need legal review before changing policy.',
    });

    const requesterPayload = buildPendingAdminActionRequesterCardPayload({ action });
    const requesterSerialized = JSON.stringify(requesterPayload);
    const detailsText = buildPendingAdminActionDetailsText(action);

    expect(requesterSerialized).toContain('Rejected');
    expect(requesterSerialized).toContain('Need legal review before changing policy.');
    expect(detailsText).toContain('Action ID: `action-123`');
    expect(detailsText).toContain('Review channel: <#channel-review>');
  });
});

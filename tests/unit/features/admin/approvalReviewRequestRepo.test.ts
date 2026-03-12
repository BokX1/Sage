import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());
const findFirstMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const updateManyMock = vi.hoisted(() => vi.fn());

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    approvalReviewRequest: {
      create: createMock,
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
      findMany: findManyMock,
      update: updateMock,
      updateMany: updateManyMock,
    },
  },
}));

describe('approvalReviewRequestRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a pending approval review request', async () => {
    createMock.mockResolvedValue({
      id: 'approval-1',
      threadId: 'thread-1',
      originTraceId: 'trace-1',
      resumeTraceId: null,
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      sourceMessageId: 'message-1',
      requesterStatusMessageId: null,
      reviewerMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      dedupeKey: 'dedupe-1',
      executionPayloadJson: { action: 'delete_message' },
      reviewSnapshotJson: { action: 'delete_message' },
      interruptMetadataJson: { action: 'delete_message' },
      status: 'pending',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:00:00.000Z'),
    });

    const { createApprovalReviewRequest } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const result = await createApprovalReviewRequest({
      threadId: 'thread-1',
      originTraceId: 'trace-1',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      sourceMessageId: 'message-1',
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      dedupeKey: 'dedupe-1',
      executionPayloadJson: { action: 'delete_message' },
      reviewSnapshotJson: { action: 'delete_message' },
      interruptMetadataJson: { action: 'delete_message' },
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
    });

    expect(result.status).toBe('pending');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: 'thread-1',
          originTraceId: 'trace-1',
          sourceChannelId: 'channel-1',
          reviewChannelId: 'channel-review',
          dedupeKey: 'dedupe-1',
          status: 'pending',
        }),
      }),
    );
  });

  it('loads a request by id', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'approval-2',
      threadId: 'thread-2',
      originTraceId: 'trace-2',
      resumeTraceId: null,
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      sourceMessageId: null,
      requesterStatusMessageId: null,
      reviewerMessageId: null,
      requestedBy: 'admin-1',
      kind: 'server_instructions_update',
      dedupeKey: 'dedupe-2',
      executionPayloadJson: { operation: 'set' },
      reviewSnapshotJson: { operation: 'set' },
      interruptMetadataJson: null,
      status: 'pending',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:00:00.000Z'),
    });

    const { getApprovalReviewRequestById } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const result = await getApprovalReviewRequestById('approval-2');

    expect(result?.id).toBe('approval-2');
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 'approval-2' } });
  });

  it('finds a matching unresolved pending request by dedupe key', async () => {
    findFirstMock.mockResolvedValue({
      id: 'approval-3',
      threadId: 'thread-3',
      originTraceId: 'trace-3',
      resumeTraceId: null,
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      sourceMessageId: null,
      requesterStatusMessageId: null,
      reviewerMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_rest_write',
      dedupeKey: 'dedupe-3',
      executionPayloadJson: { request: { method: 'PATCH' } },
      reviewSnapshotJson: { method: 'PATCH' },
      interruptMetadataJson: null,
      status: 'pending',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:00:00.000Z'),
    });

    const { findMatchingPendingApprovalReviewRequest } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const result = await findMatchingPendingApprovalReviewRequest({
      guildId: 'guild-1',
      requestedBy: 'admin-1',
      kind: 'discord_rest_write',
      dedupeKey: 'dedupe-3',
      now: new Date('2026-02-26T12:01:00.000Z'),
    });

    expect(result?.id).toBe('approval-3');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        guildId: 'guild-1',
        requestedBy: 'admin-1',
        kind: 'discord_rest_write',
        dedupeKey: 'dedupe-3',
        status: 'pending',
        expiresAt: { gt: new Date('2026-02-26T12:01:00.000Z') },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('claims a pending decision atomically when the row is still pending', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    findUniqueMock.mockResolvedValue({
      id: 'approval-4',
      threadId: 'thread-4',
      originTraceId: 'trace-4',
      resumeTraceId: 'trace-resume-4',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      sourceMessageId: null,
      requesterStatusMessageId: null,
      reviewerMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      dedupeKey: 'dedupe-4',
      executionPayloadJson: {},
      reviewSnapshotJson: {},
      interruptMetadataJson: null,
      status: 'approved',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: 'admin-2',
      decidedAt: new Date('2026-02-26T12:01:00.000Z'),
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:01:00.000Z'),
    });

    const { markApprovalReviewRequestDecisionIfPending } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const result = await markApprovalReviewRequestDecisionIfPending({
      id: 'approval-4',
      decidedBy: 'admin-2',
      status: 'approved',
      resumeTraceId: 'trace-resume-4',
    });

    expect(result?.status).toBe('approved');
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'approval-4',
          status: 'pending',
        }),
      }),
    );
  });

  it('returns null when an atomic decision claim loses the race', async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    const { markApprovalReviewRequestDecisionIfPending } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const result = await markApprovalReviewRequestDecisionIfPending({
      id: 'approval-5',
      decidedBy: 'admin-2',
      status: 'approved',
    });

    expect(result).toBeNull();
  });

  it('marks an expired pending request atomically when its deadline has passed', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    findUniqueMock.mockResolvedValue({
      id: 'approval-expired-1',
      threadId: 'thread-expired-1',
      originTraceId: 'trace-expired-1',
      resumeTraceId: 'trace-resume-expired-1',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      sourceMessageId: null,
      requesterStatusMessageId: null,
      reviewerMessageId: null,
      requestedBy: 'admin-1',
      kind: 'server_instructions_update',
      dedupeKey: 'dedupe-expired-1',
      executionPayloadJson: {},
      reviewSnapshotJson: {},
      interruptMetadataJson: null,
      status: 'expired',
      expiresAt: new Date('2026-02-26T12:00:00.000Z'),
      decidedBy: null,
      decidedAt: new Date('2026-02-26T12:10:00.000Z'),
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-02-26T11:50:00.000Z'),
      updatedAt: new Date('2026-02-26T12:10:00.000Z'),
    });

    const { markApprovalReviewRequestExpiredIfPending } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const now = new Date('2026-02-26T12:10:00.000Z');
    const result = await markApprovalReviewRequestExpiredIfPending({
      id: 'approval-expired-1',
      now,
      resumeTraceId: 'trace-resume-expired-1',
    });

    expect(result?.status).toBe('expired');
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'approval-expired-1',
        status: 'pending',
        expiresAt: { lte: now },
      },
      data: {
        status: 'expired',
        decidedAt: now,
        resumeTraceId: 'trace-resume-expired-1',
      },
    });
  });

  it('marks a request executed with result payload after approval', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    findUniqueMock.mockResolvedValue({
      id: 'approval-6',
      threadId: 'thread-6',
      originTraceId: 'trace-6',
      resumeTraceId: 'trace-resume-6',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      sourceMessageId: null,
      requesterStatusMessageId: null,
      reviewerMessageId: null,
      requestedBy: 'admin-1',
      kind: 'server_instructions_update',
      dedupeKey: 'dedupe-6',
      executionPayloadJson: { operation: 'set' },
      reviewSnapshotJson: { operation: 'set' },
      interruptMetadataJson: null,
      status: 'executed',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: 'admin-2',
      decidedAt: new Date('2026-02-26T12:01:00.000Z'),
      executedAt: new Date('2026-02-26T12:01:10.000Z'),
      resultJson: { version: 2 },
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:01:10.000Z'),
    });

    const { markApprovalReviewRequestExecutedIfApproved } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const result = await markApprovalReviewRequestExecutedIfApproved({
      id: 'approval-6',
      resultJson: { version: 2 },
      resumeTraceId: 'trace-resume-6',
    });

    expect(result?.status).toBe('executed');
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'approval-6',
          status: 'approved',
        }),
        data: expect.objectContaining({
          status: 'executed',
          resultJson: { version: 2 },
        }),
      }),
    );
  });

  it('marks a request failed with error text after approval', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    findUniqueMock.mockResolvedValue({
      id: 'approval-7',
      threadId: 'thread-7',
      originTraceId: 'trace-7',
      resumeTraceId: 'trace-resume-7',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      sourceMessageId: null,
      requesterStatusMessageId: null,
      reviewerMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_rest_write',
      dedupeKey: 'dedupe-7',
      executionPayloadJson: { request: { method: 'PATCH' } },
      reviewSnapshotJson: { method: 'PATCH' },
      interruptMetadataJson: null,
      status: 'failed',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: 'admin-2',
      decidedAt: new Date('2026-02-26T12:01:00.000Z'),
      executedAt: new Date('2026-02-26T12:01:10.000Z'),
      resultJson: { noop: true },
      decisionReasonText: null,
      errorText: 'Discord rejected the write.',
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:01:10.000Z'),
    });

    const { markApprovalReviewRequestFailedIfApproved } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const result = await markApprovalReviewRequestFailedIfApproved({
      id: 'approval-7',
      errorText: 'Discord rejected the write.',
      resultJson: { noop: true },
      resumeTraceId: 'trace-resume-7',
    });

    expect(result?.status).toBe('failed');
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'approval-7',
          status: 'approved',
        }),
        data: expect.objectContaining({
          status: 'failed',
          errorText: 'Discord rejected the write.',
          resultJson: { noop: true },
        }),
      }),
    );
  });

  it('attaches requester and reviewer message ids', async () => {
    updateMock
      .mockResolvedValueOnce({
        id: 'approval-8',
        threadId: 'thread-8',
        originTraceId: 'trace-8',
        resumeTraceId: null,
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        sourceMessageId: null,
        requesterStatusMessageId: 'requester-123',
        reviewerMessageId: null,
        requestedBy: 'admin-1',
        kind: 'server_instructions_update',
        dedupeKey: 'dedupe-8',
        executionPayloadJson: {},
        reviewSnapshotJson: {},
        interruptMetadataJson: null,
        status: 'pending',
        expiresAt: new Date('2026-02-26T12:10:00.000Z'),
        decidedBy: null,
        decidedAt: null,
        executedAt: null,
        resultJson: null,
        decisionReasonText: null,
        errorText: null,
        createdAt: new Date('2026-02-26T12:00:00.000Z'),
        updatedAt: new Date('2026-02-26T12:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'approval-8',
        threadId: 'thread-8',
        originTraceId: 'trace-8',
        resumeTraceId: null,
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        sourceMessageId: null,
        requesterStatusMessageId: 'requester-123',
        reviewerMessageId: 'reviewer-456',
        requestedBy: 'admin-1',
        kind: 'server_instructions_update',
        dedupeKey: 'dedupe-8',
        executionPayloadJson: {},
        reviewSnapshotJson: {},
        interruptMetadataJson: null,
        status: 'pending',
        expiresAt: new Date('2026-02-26T12:10:00.000Z'),
        decidedBy: null,
        decidedAt: null,
        executedAt: null,
        resultJson: null,
        decisionReasonText: null,
        errorText: null,
        createdAt: new Date('2026-02-26T12:00:00.000Z'),
        updatedAt: new Date('2026-02-26T12:00:00.000Z'),
      });

    const repo = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const requester = await repo.attachApprovalReviewRequesterStatusMessageId({
      id: 'approval-8',
      requesterStatusMessageId: 'requester-123',
    });
    const reviewer = await repo.attachApprovalReviewReviewerMessageId({
      id: 'approval-8',
      reviewerMessageId: 'reviewer-456',
    });

    expect(requester.requesterStatusMessageId).toBe('requester-123');
    expect(reviewer.reviewerMessageId).toBe('reviewer-456');
  });

  it('lists resolved reviewer cards ready for deletion', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'approval-9',
        threadId: 'thread-9',
        originTraceId: 'trace-9',
        resumeTraceId: 'trace-resume-9',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        sourceMessageId: null,
        requesterStatusMessageId: 'requester-9',
        reviewerMessageId: 'reviewer-9',
        requestedBy: 'admin-1',
        kind: 'server_instructions_update',
        dedupeKey: 'dedupe-9',
        executionPayloadJson: {},
        reviewSnapshotJson: {},
        interruptMetadataJson: null,
        status: 'executed',
        expiresAt: new Date('2026-02-26T12:10:00.000Z'),
        decidedBy: 'admin-2',
        decidedAt: new Date('2026-02-26T12:01:00.000Z'),
        executedAt: new Date('2026-02-26T12:01:10.000Z'),
        resultJson: { ok: true },
        decisionReasonText: null,
        errorText: null,
        createdAt: new Date('2026-02-26T12:00:00.000Z'),
        updatedAt: new Date('2026-02-26T12:01:10.000Z'),
      },
    ]);

    const { listApprovalReviewsWithReviewerCardsReadyForDeletion } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const result = await listApprovalReviewsWithReviewerCardsReadyForDeletion({
      resolvedBefore: new Date('2026-02-26T12:05:00.000Z'),
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      }),
    );
  });

  it('lists pending approvals whose expiry has passed', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'approval-expired-2',
        threadId: 'thread-expired-2',
        originTraceId: 'trace-expired-2',
        resumeTraceId: null,
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        sourceMessageId: null,
        requesterStatusMessageId: null,
        reviewerMessageId: 'reviewer-2',
        requestedBy: 'admin-1',
        kind: 'server_instructions_update',
        dedupeKey: 'dedupe-expired-2',
        executionPayloadJson: {},
        reviewSnapshotJson: {},
        interruptMetadataJson: null,
        status: 'pending',
        expiresAt: new Date('2026-02-26T12:00:00.000Z'),
        decidedBy: null,
        decidedAt: null,
        executedAt: null,
        resultJson: null,
        decisionReasonText: null,
        errorText: null,
        createdAt: new Date('2026-02-26T11:50:00.000Z'),
        updatedAt: new Date('2026-02-26T12:00:00.000Z'),
      },
    ]);

    const { listPendingApprovalReviewsExpiredBy } = await import('../../../../src/features/admin/approvalReviewRequestRepo');
    const now = new Date('2026-02-26T12:05:00.000Z');
    const result = await listPendingApprovalReviewsExpiredBy({ now, limit: 5 });

    expect(result).toHaveLength(1);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        expiresAt: { lte: now },
      },
      orderBy: { expiresAt: 'asc' },
      take: 5,
    });
  });
});

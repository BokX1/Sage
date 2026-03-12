import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db/prisma-client';

export const APPROVAL_REVIEW_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'executed',
  'failed',
  'expired',
] as const;

export type ApprovalReviewRequestStatus = typeof APPROVAL_REVIEW_REQUEST_STATUSES[number];

export interface ApprovalReviewRequestRecord {
  id: string;
  threadId: string;
  originTraceId: string;
  resumeTraceId: string | null;
  guildId: string;
  sourceChannelId: string;
  reviewChannelId: string;
  sourceMessageId: string | null;
  requesterStatusMessageId: string | null;
  reviewerMessageId: string | null;
  requestedBy: string;
  kind: string;
  dedupeKey: string;
  executionPayloadJson: unknown;
  reviewSnapshotJson: unknown;
  interruptMetadataJson: unknown;
  status: ApprovalReviewRequestStatus;
  expiresAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  executedAt: Date | null;
  resultJson: unknown;
  decisionReasonText: string | null;
  errorText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeStatus(value: string): ApprovalReviewRequestStatus {
  return APPROVAL_REVIEW_REQUEST_STATUSES.includes(value as ApprovalReviewRequestStatus)
    ? (value as ApprovalReviewRequestStatus)
    : 'failed';
}

function toRecord(value: {
  id: string;
  threadId: string;
  originTraceId: string;
  resumeTraceId: string | null;
  guildId: string;
  sourceChannelId: string;
  reviewChannelId: string;
  sourceMessageId: string | null;
  requesterStatusMessageId: string | null;
  reviewerMessageId: string | null;
  requestedBy: string;
  kind: string;
  dedupeKey: string;
  executionPayloadJson: unknown;
  reviewSnapshotJson: unknown;
  interruptMetadataJson: unknown;
  status: string;
  expiresAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  executedAt: Date | null;
  resultJson: unknown;
  decisionReasonText: string | null;
  errorText: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ApprovalReviewRequestRecord {
  return {
    id: value.id,
    threadId: value.threadId,
    originTraceId: value.originTraceId,
    resumeTraceId: value.resumeTraceId,
    guildId: value.guildId,
    sourceChannelId: value.sourceChannelId,
    reviewChannelId: value.reviewChannelId,
    sourceMessageId: value.sourceMessageId,
    requesterStatusMessageId: value.requesterStatusMessageId,
    reviewerMessageId: value.reviewerMessageId,
    requestedBy: value.requestedBy,
    kind: value.kind,
    dedupeKey: value.dedupeKey,
    executionPayloadJson: value.executionPayloadJson,
    reviewSnapshotJson: value.reviewSnapshotJson,
    interruptMetadataJson: value.interruptMetadataJson,
    status: normalizeStatus(value.status),
    expiresAt: value.expiresAt,
    decidedBy: value.decidedBy,
    decidedAt: value.decidedAt,
    executedAt: value.executedAt,
    resultJson: value.resultJson,
    decisionReasonText: value.decisionReasonText,
    errorText: value.errorText,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function createApprovalReviewRequest(params: {
  threadId: string;
  originTraceId: string;
  guildId: string;
  sourceChannelId: string;
  reviewChannelId: string;
  sourceMessageId?: string | null;
  requestedBy: string;
  kind: string;
  dedupeKey: string;
  executionPayloadJson: unknown;
  reviewSnapshotJson: unknown;
  interruptMetadataJson?: unknown;
  expiresAt: Date;
}): Promise<ApprovalReviewRequestRecord> {
  const created = await prisma.approvalReviewRequest.create({
    data: {
      threadId: params.threadId.trim(),
      originTraceId: params.originTraceId.trim(),
      guildId: params.guildId,
      sourceChannelId: params.sourceChannelId.trim(),
      reviewChannelId: params.reviewChannelId.trim(),
      sourceMessageId: params.sourceMessageId?.trim() || null,
      requestedBy: params.requestedBy,
      kind: params.kind,
      dedupeKey: params.dedupeKey.trim(),
      executionPayloadJson: params.executionPayloadJson as Prisma.InputJsonValue,
      reviewSnapshotJson: params.reviewSnapshotJson as Prisma.InputJsonValue,
      interruptMetadataJson:
        params.interruptMetadataJson === undefined
          ? Prisma.JsonNull
          : (params.interruptMetadataJson as Prisma.InputJsonValue),
      status: 'pending',
      expiresAt: params.expiresAt,
    },
  });

  return toRecord(created);
}

export async function getApprovalReviewRequestById(
  id: string,
): Promise<ApprovalReviewRequestRecord | null> {
  const row = await prisma.approvalReviewRequest.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function findMatchingPendingApprovalReviewRequest(params: {
  guildId: string;
  requestedBy: string;
  kind: string;
  dedupeKey: string;
  now?: Date;
}): Promise<ApprovalReviewRequestRecord | null> {
  const row = await prisma.approvalReviewRequest.findFirst({
    where: {
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      kind: params.kind,
      dedupeKey: params.dedupeKey,
      status: 'pending',
      expiresAt: { gt: params.now ?? new Date() },
    },
    orderBy: { createdAt: 'asc' },
  });

  return row ? toRecord(row) : null;
}

export async function markApprovalReviewRequestExpired(id: string): Promise<void> {
  await prisma.approvalReviewRequest.update({
    where: { id },
    data: {
      status: 'expired',
      decidedAt: new Date(),
    },
  });
}

export async function markApprovalReviewRequestDecisionIfPending(params: {
  id: string;
  decidedBy: string;
  status: 'approved' | 'rejected';
  decisionReasonText?: string | null;
  resumeTraceId?: string | null;
}): Promise<ApprovalReviewRequestRecord | null> {
  const result = await prisma.approvalReviewRequest.updateMany({
    where: {
      id: params.id,
      status: 'pending',
    },
    data: {
      status: params.status,
      decidedBy: params.decidedBy,
      decidedAt: new Date(),
      decisionReasonText: params.decisionReasonText?.trim() || null,
      resumeTraceId: params.resumeTraceId?.trim() || null,
    },
  });

  if (result.count < 1) {
    return null;
  }

  const row = await prisma.approvalReviewRequest.findUnique({ where: { id: params.id } });
  return row ? toRecord(row) : null;
}

export async function markApprovalReviewRequestExecutedIfApproved(params: {
  id: string;
  resultJson: unknown;
  resumeTraceId?: string | null;
}): Promise<ApprovalReviewRequestRecord | null> {
  const result = await prisma.approvalReviewRequest.updateMany({
    where: {
      id: params.id,
      status: 'approved',
    },
    data: {
      status: 'executed',
      executedAt: new Date(),
      resultJson: params.resultJson as Prisma.InputJsonValue,
      errorText: null,
      resumeTraceId: params.resumeTraceId?.trim() || null,
    },
  });

  if (result.count < 1) {
    return null;
  }

  const row = await prisma.approvalReviewRequest.findUnique({ where: { id: params.id } });
  return row ? toRecord(row) : null;
}

export async function markApprovalReviewRequestFailedIfApproved(params: {
  id: string;
  errorText: string;
  resultJson?: unknown;
  resumeTraceId?: string | null;
}): Promise<ApprovalReviewRequestRecord | null> {
  const result = await prisma.approvalReviewRequest.updateMany({
    where: {
      id: params.id,
      status: 'approved',
    },
    data: params.resultJson === undefined
      ? {
          status: 'failed',
          executedAt: new Date(),
          errorText: params.errorText,
          resumeTraceId: params.resumeTraceId?.trim() || null,
        }
      : {
          status: 'failed',
          executedAt: new Date(),
          errorText: params.errorText,
          resultJson: params.resultJson as Prisma.InputJsonValue,
          resumeTraceId: params.resumeTraceId?.trim() || null,
        },
  });

  if (result.count < 1) {
    return null;
  }

  const row = await prisma.approvalReviewRequest.findUnique({ where: { id: params.id } });
  return row ? toRecord(row) : null;
}

export async function attachApprovalReviewRequesterStatusMessageId(params: {
  id: string;
  requesterStatusMessageId: string;
}): Promise<ApprovalReviewRequestRecord> {
  const updated = await prisma.approvalReviewRequest.update({
    where: { id: params.id },
    data: { requesterStatusMessageId: params.requesterStatusMessageId.trim() },
  });
  return toRecord(updated);
}

export async function attachApprovalReviewReviewerMessageId(params: {
  id: string;
  reviewerMessageId: string;
}): Promise<ApprovalReviewRequestRecord> {
  const updated = await prisma.approvalReviewRequest.update({
    where: { id: params.id },
    data: { reviewerMessageId: params.reviewerMessageId.trim() },
  });
  return toRecord(updated);
}

export async function updateApprovalReviewSurface(params: {
  id: string;
  reviewChannelId: string;
  reviewerMessageId: string;
}): Promise<ApprovalReviewRequestRecord> {
  const updated = await prisma.approvalReviewRequest.update({
    where: { id: params.id },
    data: {
      reviewChannelId: params.reviewChannelId.trim(),
      reviewerMessageId: params.reviewerMessageId.trim(),
    },
  });
  return toRecord(updated);
}

export async function clearApprovalReviewReviewerMessageId(
  id: string,
): Promise<ApprovalReviewRequestRecord> {
  const updated = await prisma.approvalReviewRequest.update({
    where: { id },
    data: { reviewerMessageId: null },
  });
  return toRecord(updated);
}

export async function listApprovalReviewsWithReviewerCardsReadyForDeletion(params: {
  resolvedBefore: Date;
  limit?: number;
}): Promise<ApprovalReviewRequestRecord[]> {
  const rows = await prisma.approvalReviewRequest.findMany({
    where: {
      reviewerMessageId: { not: null },
      OR: [
        { status: 'rejected', decidedAt: { lte: params.resolvedBefore } },
        { status: 'expired', decidedAt: { lte: params.resolvedBefore } },
        { status: 'executed', executedAt: { lte: params.resolvedBefore } },
        { status: 'failed', executedAt: { lte: params.resolvedBefore } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(params.limit ?? 50, 250)),
  });

  return rows.map(toRecord);
}

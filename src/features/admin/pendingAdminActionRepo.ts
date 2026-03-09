import { prisma } from '../../platform/db/prisma-client';
import { Prisma } from '@prisma/client';

/**
 * Declares exported bindings: PENDING_ADMIN_ACTION_STATUSES.
 */
export const PENDING_ADMIN_ACTION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'executed',
  'failed',
  'expired',
] as const;

/**
 * Represents the PendingAdminActionStatus type.
 */
export type PendingAdminActionStatus = typeof PENDING_ADMIN_ACTION_STATUSES[number];

export interface PendingAdminActionRecord {
  id: string;
  guildId: string;
  sourceChannelId: string;
  reviewChannelId: string;
  approvalMessageId: string | null;
  requestMessageId: string | null;
  requestedBy: string;
  kind: string;
  payloadJson: unknown;
  status: PendingAdminActionStatus;
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

function toRecord(value: {
  id: string;
  guildId: string;
  sourceChannelId: string;
  reviewChannelId: string;
  approvalMessageId: string | null;
  requestMessageId: string | null;
  requestedBy: string;
  kind: string;
  payloadJson: unknown;
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
}): PendingAdminActionRecord {
  const normalizedStatus: PendingAdminActionStatus = PENDING_ADMIN_ACTION_STATUSES.includes(
    value.status as PendingAdminActionStatus,
  )
    ? (value.status as PendingAdminActionStatus)
    : 'failed';

  return {
    id: value.id,
    guildId: value.guildId,
    sourceChannelId: value.sourceChannelId,
    reviewChannelId: value.reviewChannelId,
    approvalMessageId: value.approvalMessageId,
    requestMessageId: value.requestMessageId,
    requestedBy: value.requestedBy,
    kind: value.kind,
    payloadJson: value.payloadJson,
    status: normalizedStatus,
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

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = canonicalizeJsonValue(record[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function canonicalizePayloadJson(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export async function createPendingAdminAction(params: {
  guildId: string;
  sourceChannelId: string;
  reviewChannelId: string;
  requestedBy: string;
  kind: string;
  payloadJson: unknown;
  expiresAt: Date;
}): Promise<PendingAdminActionRecord> {
  const sourceChannelId = params.sourceChannelId.trim();
  const reviewChannelId = params.reviewChannelId.trim();
  if (!sourceChannelId) {
    throw new Error('sourceChannelId must be a non-empty string.');
  }
  if (!reviewChannelId) {
    throw new Error('reviewChannelId must be a non-empty string.');
  }
  const created = await prisma.pendingAdminAction.create({
    data: {
      guildId: params.guildId,
      sourceChannelId,
      reviewChannelId,
      requestedBy: params.requestedBy,
      kind: params.kind,
      payloadJson: params.payloadJson as Prisma.InputJsonValue,
      status: 'pending',
      expiresAt: params.expiresAt,
    },
  });

  return toRecord(created);
}

export async function getPendingAdminActionById(
  id: string,
): Promise<PendingAdminActionRecord | null> {
  const row = await prisma.pendingAdminAction.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function findMatchingPendingAdminAction(params: {
  guildId: string;
  requestedBy: string;
  kind: string;
  payloadJson: unknown;
  now?: Date;
}): Promise<PendingAdminActionRecord | null> {
  const now = params.now ?? new Date();
  const expectedPayload = canonicalizePayloadJson(params.payloadJson);
  const rows = await prisma.pendingAdminAction.findMany({
    where: {
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      kind: params.kind,
      status: 'pending',
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const row of rows) {
    if (canonicalizePayloadJson(row.payloadJson) === expectedPayload) {
      return toRecord(row);
    }
  }

  return null;
}

export async function markPendingAdminActionExpired(id: string): Promise<void> {
  await prisma.pendingAdminAction.update({
    where: { id },
    data: {
      status: 'expired',
      decidedAt: new Date(),
    },
  });
}

export async function markPendingAdminActionDecision(params: {
  id: string;
  decidedBy: string;
  status: 'approved' | 'rejected';
  decisionReasonText?: string | null;
}): Promise<PendingAdminActionRecord> {
  const normalizedDecisionReasonText = params.decisionReasonText?.trim() || null;
  const updated = await prisma.pendingAdminAction.update({
    where: { id: params.id },
    data: {
      status: params.status,
      decidedBy: params.decidedBy,
      decidedAt: new Date(),
      decisionReasonText: normalizedDecisionReasonText,
    },
  });
  return toRecord(updated);
}

export async function markPendingAdminActionExecuted(params: {
  id: string;
  resultJson: unknown;
}): Promise<PendingAdminActionRecord> {
  const updated = await prisma.pendingAdminAction.update({
    where: { id: params.id },
    data: {
      status: 'executed',
      executedAt: new Date(),
      resultJson: params.resultJson as Prisma.InputJsonValue,
      errorText: null,
    },
  });
  return toRecord(updated);
}

export async function markPendingAdminActionFailed(params: {
  id: string;
  errorText: string;
  resultJson?: unknown;
}): Promise<PendingAdminActionRecord> {
  const updated = await prisma.pendingAdminAction.update({
    where: { id: params.id },
    data: params.resultJson === undefined
      ? {
        status: 'failed',
        executedAt: new Date(),
        errorText: params.errorText,
      }
      : {
        status: 'failed',
        executedAt: new Date(),
        decisionReasonText: null,
        errorText: params.errorText,
        resultJson: params.resultJson as Prisma.InputJsonValue,
      },
  });
  return toRecord(updated);
}

export async function attachPendingAdminActionRequestMessageId(params: {
  id: string;
  requestMessageId: string;
}): Promise<PendingAdminActionRecord> {
  const requestMessageId = params.requestMessageId.trim();
  if (!requestMessageId) {
    throw new Error('requestMessageId must be a non-empty string.');
  }

  const updated = await prisma.pendingAdminAction.update({
    where: { id: params.id },
    data: { requestMessageId },
  });

  return toRecord(updated);
}

export async function attachPendingAdminActionApprovalMessageId(params: {
  id: string;
  approvalMessageId: string;
}): Promise<PendingAdminActionRecord> {
  const approvalMessageId = params.approvalMessageId.trim();
  if (!approvalMessageId) {
    throw new Error('approvalMessageId must be a non-empty string.');
  }

  const updated = await prisma.pendingAdminAction.update({
    where: { id: params.id },
    data: { approvalMessageId },
  });

  return toRecord(updated);
}

export async function updatePendingAdminActionReviewSurface(params: {
  id: string;
  reviewChannelId: string;
  approvalMessageId: string;
}): Promise<PendingAdminActionRecord> {
  const reviewChannelId = params.reviewChannelId.trim();
  const approvalMessageId = params.approvalMessageId.trim();
  if (!reviewChannelId) {
    throw new Error('reviewChannelId must be a non-empty string.');
  }
  if (!approvalMessageId) {
    throw new Error('approvalMessageId must be a non-empty string.');
  }

  const updated = await prisma.pendingAdminAction.update({
    where: { id: params.id },
    data: {
      reviewChannelId,
      approvalMessageId,
    },
  });

  return toRecord(updated);
}

export async function clearPendingAdminActionApprovalMessageId(id: string): Promise<PendingAdminActionRecord> {
  const updated = await prisma.pendingAdminAction.update({
    where: { id },
    data: { approvalMessageId: null },
  });

  return toRecord(updated);
}

export async function listPendingAdminActionsWithApprovalCardsReadyForDeletion(params: {
  resolvedBefore: Date;
  limit?: number;
}): Promise<PendingAdminActionRecord[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 250));

  const rows = await prisma.pendingAdminAction.findMany({
    where: {
      approvalMessageId: { not: null },
      OR: [
        { status: 'rejected', decidedAt: { lte: params.resolvedBefore } },
        { status: 'expired', decidedAt: { lte: params.resolvedBefore } },
        { status: 'executed', executedAt: { lte: params.resolvedBefore } },
        { status: 'failed', executedAt: { lte: params.resolvedBefore } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });

  return rows.map(toRecord);
}

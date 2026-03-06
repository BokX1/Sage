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
  channelId: string;
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
  errorText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(value: {
  id: string;
  guildId: string;
  channelId: string;
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
    channelId: value.channelId,
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
    errorText: value.errorText,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function createPendingAdminAction(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  kind: string;
  payloadJson: unknown;
  expiresAt: Date;
}): Promise<PendingAdminActionRecord> {
  const created = await prisma.pendingAdminAction.create({
    data: {
      guildId: params.guildId,
      channelId: params.channelId,
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
}): Promise<PendingAdminActionRecord> {
  const updated = await prisma.pendingAdminAction.update({
    where: { id: params.id },
    data: {
      status: params.status,
      decidedBy: params.decidedBy,
      decidedAt: new Date(),
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

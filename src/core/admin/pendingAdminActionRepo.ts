/**
 * @module src/core/admin/pendingAdminActionRepo
 * @description Defines the pending admin action repo module.
 */
import { prisma } from '../../core/db/prisma-client';
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

/**
 * Represents the PendingAdminActionRecord contract.
 */
export interface PendingAdminActionRecord {
  id: string;
  guildId: string;
  channelId: string;
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

/**
 * Runs createPendingAdminAction.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
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

/**
 * Runs getPendingAdminActionById.
 *
 * @param id - Describes the id input.
 * @returns Returns the function result.
 */
export async function getPendingAdminActionById(
  id: string,
): Promise<PendingAdminActionRecord | null> {
  const row = await prisma.pendingAdminAction.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

/**
 * Runs markPendingAdminActionExpired.
 *
 * @param id - Describes the id input.
 * @returns Returns the function result.
 */
export async function markPendingAdminActionExpired(id: string): Promise<void> {
  await prisma.pendingAdminAction.update({
    where: { id },
    data: {
      status: 'expired',
      decidedAt: new Date(),
    },
  });
}

/**
 * Runs markPendingAdminActionDecision.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
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

/**
 * Runs markPendingAdminActionExecuted.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
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

/**
 * Runs markPendingAdminActionFailed.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
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

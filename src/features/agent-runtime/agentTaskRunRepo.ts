import { prisma } from '../../platform/db/prisma-client';
import type { AgentTaskRun as PrismaAgentTaskRun } from '@prisma/client';

type AgentTaskRunDelegate = {
  create: (args: unknown) => Promise<PrismaAgentTaskRun>;
  findUnique: (args: unknown) => Promise<PrismaAgentTaskRun | null>;
  upsert: (args: unknown) => Promise<PrismaAgentTaskRun>;
  update: (args: unknown) => Promise<PrismaAgentTaskRun>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
  findMany: (args: unknown) => Promise<PrismaAgentTaskRun[]>;
  deleteMany: (args: unknown) => Promise<unknown>;
};

const agentTaskRunDelegate = (prisma as unknown as {
  agentTaskRun: AgentTaskRunDelegate;
}).agentTaskRun;

export const AGENT_RUN_DEFAULT_MAX_TOTAL_DURATION_MS = 60 * 60_000;
export const AGENT_RUN_DEFAULT_MAX_IDLE_WAIT_MS = 24 * 60 * 60_000;

export type AgentTaskRunStatus =
  | 'running'
  | 'waiting_user_input'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentTaskWaitingKind = 'user_input' | 'approval_review';

export interface AgentTaskRunActiveUserInterruptPayload {
  messageId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  userText: string;
  userContent?: unknown;
}

export interface AgentTaskRunRecord {
  id: string;
  threadId: string;
  originTraceId: string;
  latestTraceId: string;
  guildId: string | null;
  channelId: string;
  requestedByUserId: string;
  sourceMessageId: string | null;
  responseMessageId: string | null;
  status: AgentTaskRunStatus;
  waitingKind: AgentTaskWaitingKind | null;
  latestDraftText: string;
  draftRevision: number;
  completionKind: string | null;
  stopReason: string | null;
  nextRunnableAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  resumeCount: number;
  taskWallClockMs: number;
  maxTotalDurationMs: number;
  maxIdleWaitMs: number;
  lastErrorText: string | null;
  responseSessionJson: unknown;
  waitingStateJson: unknown;
  compactionStateJson: unknown;
  checkpointMetadataJson: unknown;
  activeUserInterruptJson: unknown;
  activeUserInterruptRevision: number;
  activeUserInterruptConsumedRevision: number;
  activeUserInterruptQueuedAt: Date | null;
  activeUserInterruptConsumedAt: Date | null;
  activeUserInterruptSupersededAt: Date | null;
  activeUserInterruptSupersededRevision: number | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type AgentTaskRunRow = Awaited<ReturnType<typeof agentTaskRunDelegate.findUnique>>;

function toRecord(value: NonNullable<AgentTaskRunRow>): AgentTaskRunRecord {
  return {
    id: value.id,
    threadId: value.threadId,
    originTraceId: value.originTraceId,
    latestTraceId: value.latestTraceId,
    guildId: value.guildId,
    channelId: value.channelId,
    requestedByUserId: value.requestedByUserId,
    sourceMessageId: value.sourceMessageId,
    responseMessageId: value.responseMessageId,
    status: value.status as AgentTaskRunStatus,
    waitingKind: (value.waitingKind as AgentTaskWaitingKind | null) ?? null,
    latestDraftText: value.latestDraftText,
    draftRevision: value.draftRevision,
    completionKind: value.completionKind,
    stopReason: value.stopReason,
    nextRunnableAt: value.nextRunnableAt,
    leaseOwner: value.leaseOwner,
    leaseExpiresAt: value.leaseExpiresAt,
    heartbeatAt: value.heartbeatAt,
    resumeCount: value.resumeCount,
    taskWallClockMs: value.taskWallClockMs,
    maxTotalDurationMs: value.maxTotalDurationMs,
    maxIdleWaitMs: value.maxIdleWaitMs,
    lastErrorText: value.lastErrorText,
    responseSessionJson: value.responseSessionJson,
    waitingStateJson: value.waitingStateJson,
    compactionStateJson: value.compactionStateJson,
    checkpointMetadataJson: value.checkpointMetadataJson,
    activeUserInterruptJson: value.activeUserInterruptJson,
    activeUserInterruptRevision: value.activeUserInterruptRevision,
    activeUserInterruptConsumedRevision: value.activeUserInterruptConsumedRevision,
    activeUserInterruptQueuedAt: value.activeUserInterruptQueuedAt,
    activeUserInterruptConsumedAt: value.activeUserInterruptConsumedAt,
    activeUserInterruptSupersededAt: value.activeUserInterruptSupersededAt,
    activeUserInterruptSupersededRevision: value.activeUserInterruptSupersededRevision,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export interface AgentTaskRunActiveUserInterruptState {
  payload: AgentTaskRunActiveUserInterruptPayload;
  revision: number;
  consumedRevision: number;
  queuedAt: Date | null;
  consumedAt: Date | null;
  supersededAt: Date | null;
  supersededRevision: number | null;
}

export type QueueRunningTaskRunActiveInterruptResult = 'queued' | 'stale' | 'rejected';

export function readActiveUserInterruptState(
  value: Pick<
    AgentTaskRunRecord,
    | 'activeUserInterruptJson'
    | 'activeUserInterruptRevision'
    | 'activeUserInterruptConsumedRevision'
    | 'activeUserInterruptQueuedAt'
    | 'activeUserInterruptConsumedAt'
    | 'activeUserInterruptSupersededAt'
    | 'activeUserInterruptSupersededRevision'
  >,
): AgentTaskRunActiveUserInterruptState | null {
  if (!value.activeUserInterruptJson || typeof value.activeUserInterruptJson !== 'object') {
    return null;
  }

  const payload = value.activeUserInterruptJson as Record<string, unknown>;
  if (
    typeof payload.messageId !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.channelId !== 'string' ||
    typeof payload.userText !== 'string'
  ) {
    return null;
  }

  return {
    payload: {
      messageId: payload.messageId,
      userId: payload.userId,
      channelId: payload.channelId,
      guildId:
        typeof payload.guildId === 'string' || payload.guildId === null
          ? (payload.guildId as string | null)
          : null,
      userText: payload.userText,
      userContent: payload.userContent,
    },
    revision: value.activeUserInterruptRevision,
    consumedRevision: value.activeUserInterruptConsumedRevision,
    queuedAt: value.activeUserInterruptQueuedAt,
    consumedAt: value.activeUserInterruptConsumedAt,
    supersededAt: value.activeUserInterruptSupersededAt,
    supersededRevision: value.activeUserInterruptSupersededRevision,
  };
}

function readResponseMessageId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = (value as Record<string, unknown>).responseMessageId;
  return typeof candidate === 'string' ? candidate : null;
}

export async function createAgentTaskRun(params: {
  threadId: string;
  originTraceId: string;
  latestTraceId: string;
  guildId: string | null;
  channelId: string;
  requestedByUserId: string;
  sourceMessageId?: string | null;
  responseMessageId?: string | null;
  status: AgentTaskRunStatus;
  waitingKind?: AgentTaskWaitingKind | null;
  latestDraftText: string;
  draftRevision?: number;
  completionKind?: string | null;
  stopReason?: string | null;
  nextRunnableAt?: Date | null;
  responseSessionJson?: unknown;
  waitingStateJson?: unknown;
  compactionStateJson?: unknown;
  checkpointMetadataJson?: unknown;
  activeUserInterruptJson?: unknown;
  activeUserInterruptRevision?: number;
  activeUserInterruptConsumedRevision?: number;
  activeUserInterruptQueuedAt?: Date | null;
  activeUserInterruptConsumedAt?: Date | null;
  activeUserInterruptSupersededAt?: Date | null;
  activeUserInterruptSupersededRevision?: number | null;
  maxTotalDurationMs?: number;
  maxIdleWaitMs?: number;
}): Promise<AgentTaskRunRecord> {
  const created = await agentTaskRunDelegate.create({
    data: {
      threadId: params.threadId,
      originTraceId: params.originTraceId,
      latestTraceId: params.latestTraceId,
      guildId: params.guildId,
      channelId: params.channelId,
      requestedByUserId: params.requestedByUserId,
      sourceMessageId: params.sourceMessageId ?? null,
      responseMessageId: params.responseMessageId ?? null,
      status: params.status,
      waitingKind: params.waitingKind ?? null,
      latestDraftText: params.latestDraftText,
      draftRevision: params.draftRevision ?? 0,
      completionKind: params.completionKind ?? null,
      stopReason: params.stopReason ?? null,
      nextRunnableAt: params.nextRunnableAt ?? null,
      responseSessionJson: params.responseSessionJson,
      waitingStateJson: params.waitingStateJson,
      compactionStateJson: params.compactionStateJson,
      checkpointMetadataJson: params.checkpointMetadataJson,
      activeUserInterruptJson: params.activeUserInterruptJson,
      activeUserInterruptRevision: params.activeUserInterruptRevision ?? 0,
      activeUserInterruptConsumedRevision: params.activeUserInterruptConsumedRevision ?? 0,
      activeUserInterruptQueuedAt: params.activeUserInterruptQueuedAt ?? null,
      activeUserInterruptConsumedAt: params.activeUserInterruptConsumedAt ?? null,
      activeUserInterruptSupersededAt: params.activeUserInterruptSupersededAt ?? null,
      activeUserInterruptSupersededRevision: params.activeUserInterruptSupersededRevision ?? null,
      maxTotalDurationMs: params.maxTotalDurationMs ?? AGENT_RUN_DEFAULT_MAX_TOTAL_DURATION_MS,
      maxIdleWaitMs: params.maxIdleWaitMs ?? AGENT_RUN_DEFAULT_MAX_IDLE_WAIT_MS,
    },
  });

  return toRecord(created);
}

export async function getAgentTaskRunById(id: string): Promise<AgentTaskRunRecord | null> {
  const row = await agentTaskRunDelegate.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function getAgentTaskRunByThreadId(threadId: string): Promise<AgentTaskRunRecord | null> {
  const row = await agentTaskRunDelegate.findUnique({ where: { threadId } });
  return row ? toRecord(row) : null;
}

export async function upsertAgentTaskRun(params: {
  threadId: string;
  originTraceId: string;
  latestTraceId: string;
  guildId: string | null;
  channelId: string;
  requestedByUserId: string;
  sourceMessageId?: string | null;
  responseMessageId?: string | null;
  status: AgentTaskRunStatus;
  waitingKind?: AgentTaskWaitingKind | null;
  latestDraftText: string;
  draftRevision: number;
  completionKind?: string | null;
  stopReason?: string | null;
  nextRunnableAt?: Date | null;
  responseSessionJson?: unknown;
  waitingStateJson?: unknown;
  compactionStateJson?: unknown;
  checkpointMetadataJson?: unknown;
  activeUserInterruptJson?: unknown;
  activeUserInterruptRevision?: number;
  activeUserInterruptConsumedRevision?: number;
  activeUserInterruptQueuedAt?: Date | null;
  activeUserInterruptConsumedAt?: Date | null;
  activeUserInterruptSupersededAt?: Date | null;
  activeUserInterruptSupersededRevision?: number | null;
  maxTotalDurationMs?: number;
  maxIdleWaitMs?: number;
  taskWallClockMs?: number;
  resumeCount?: number;
  completedAt?: Date | null;
  lastErrorText?: string | null;
}): Promise<AgentTaskRunRecord> {
  const row = await agentTaskRunDelegate.upsert({
    where: { threadId: params.threadId },
    create: {
      threadId: params.threadId,
      originTraceId: params.originTraceId,
      latestTraceId: params.latestTraceId,
      guildId: params.guildId,
      channelId: params.channelId,
      requestedByUserId: params.requestedByUserId,
      sourceMessageId: params.sourceMessageId ?? null,
      responseMessageId: params.responseMessageId ?? null,
      status: params.status,
      waitingKind: params.waitingKind ?? null,
      latestDraftText: params.latestDraftText,
      draftRevision: params.draftRevision,
      completionKind: params.completionKind ?? null,
      stopReason: params.stopReason ?? null,
      nextRunnableAt: params.nextRunnableAt ?? null,
      responseSessionJson: params.responseSessionJson,
      waitingStateJson: params.waitingStateJson,
      compactionStateJson: params.compactionStateJson,
      checkpointMetadataJson: params.checkpointMetadataJson,
      activeUserInterruptJson: params.activeUserInterruptJson,
      activeUserInterruptRevision: params.activeUserInterruptRevision ?? 0,
      activeUserInterruptConsumedRevision: params.activeUserInterruptConsumedRevision ?? 0,
      activeUserInterruptQueuedAt: params.activeUserInterruptQueuedAt ?? null,
      activeUserInterruptConsumedAt: params.activeUserInterruptConsumedAt ?? null,
      activeUserInterruptSupersededAt: params.activeUserInterruptSupersededAt ?? null,
      activeUserInterruptSupersededRevision: params.activeUserInterruptSupersededRevision ?? null,
      maxTotalDurationMs: params.maxTotalDurationMs ?? AGENT_RUN_DEFAULT_MAX_TOTAL_DURATION_MS,
      maxIdleWaitMs: params.maxIdleWaitMs ?? AGENT_RUN_DEFAULT_MAX_IDLE_WAIT_MS,
      taskWallClockMs: params.taskWallClockMs ?? 0,
      resumeCount: params.resumeCount ?? 0,
      completedAt: params.completedAt ?? null,
      lastErrorText: params.lastErrorText ?? null,
    },
    update: {
      latestTraceId: params.latestTraceId,
      guildId: params.guildId,
      channelId: params.channelId,
      requestedByUserId: params.requestedByUserId,
      sourceMessageId: params.sourceMessageId ?? undefined,
      responseMessageId: params.responseMessageId ?? undefined,
      status: params.status,
      waitingKind: params.waitingKind ?? null,
      latestDraftText: params.latestDraftText,
      draftRevision: params.draftRevision,
      completionKind: params.completionKind ?? null,
      stopReason: params.stopReason ?? null,
      nextRunnableAt: params.nextRunnableAt ?? null,
      responseSessionJson: params.responseSessionJson,
      waitingStateJson: params.waitingStateJson,
      compactionStateJson: params.compactionStateJson,
      checkpointMetadataJson: params.checkpointMetadataJson,
      activeUserInterruptJson: params.activeUserInterruptJson ?? undefined,
      activeUserInterruptRevision: params.activeUserInterruptRevision ?? undefined,
      activeUserInterruptConsumedRevision: params.activeUserInterruptConsumedRevision ?? undefined,
      activeUserInterruptQueuedAt: params.activeUserInterruptQueuedAt ?? undefined,
      activeUserInterruptConsumedAt: params.activeUserInterruptConsumedAt ?? undefined,
      activeUserInterruptSupersededAt: params.activeUserInterruptSupersededAt ?? undefined,
      activeUserInterruptSupersededRevision: params.activeUserInterruptSupersededRevision ?? undefined,
      maxTotalDurationMs: params.maxTotalDurationMs ?? undefined,
      maxIdleWaitMs: params.maxIdleWaitMs ?? undefined,
      taskWallClockMs: params.taskWallClockMs ?? undefined,
      resumeCount: params.resumeCount ?? undefined,
      completedAt: params.completedAt ?? undefined,
      lastErrorText: params.lastErrorText ?? undefined,
    },
  });

  return toRecord(row);
}

export async function updateAgentTaskRunByThreadId(params: {
  threadId: string;
  latestTraceId?: string;
  sourceMessageId?: string | null;
  responseMessageId?: string | null;
  status?: AgentTaskRunStatus;
  waitingKind?: AgentTaskWaitingKind | null;
  latestDraftText?: string;
  draftRevision?: number;
  completionKind?: string | null;
  stopReason?: string | null;
  nextRunnableAt?: Date | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
  heartbeatAt?: Date | null;
  resumeCount?: number;
  taskWallClockMs?: number;
  responseSessionJson?: unknown;
  waitingStateJson?: unknown;
  compactionStateJson?: unknown;
  checkpointMetadataJson?: unknown;
  activeUserInterruptJson?: unknown;
  activeUserInterruptRevision?: number;
  activeUserInterruptConsumedRevision?: number;
  activeUserInterruptQueuedAt?: Date | null;
  activeUserInterruptConsumedAt?: Date | null;
  activeUserInterruptSupersededAt?: Date | null;
  activeUserInterruptSupersededRevision?: number | null;
  completedAt?: Date | null;
  lastErrorText?: string | null;
}): Promise<void> {
  await agentTaskRunDelegate.update({
    where: { threadId: params.threadId },
    data: {
      latestTraceId: params.latestTraceId,
      sourceMessageId: params.sourceMessageId,
      responseMessageId: params.responseMessageId,
      status: params.status,
      waitingKind: params.waitingKind,
      latestDraftText: params.latestDraftText,
      draftRevision: params.draftRevision,
      completionKind: params.completionKind,
      stopReason: params.stopReason,
      nextRunnableAt: params.nextRunnableAt,
      leaseOwner: params.leaseOwner,
      leaseExpiresAt: params.leaseExpiresAt,
      heartbeatAt: params.heartbeatAt,
      resumeCount: params.resumeCount,
      taskWallClockMs: params.taskWallClockMs,
      responseSessionJson: params.responseSessionJson,
      waitingStateJson: params.waitingStateJson,
      compactionStateJson: params.compactionStateJson,
      checkpointMetadataJson: params.checkpointMetadataJson,
      activeUserInterruptJson: params.activeUserInterruptJson,
      activeUserInterruptRevision: params.activeUserInterruptRevision,
      activeUserInterruptConsumedRevision: params.activeUserInterruptConsumedRevision,
      activeUserInterruptQueuedAt: params.activeUserInterruptQueuedAt,
      activeUserInterruptConsumedAt: params.activeUserInterruptConsumedAt,
      activeUserInterruptSupersededAt: params.activeUserInterruptSupersededAt,
      activeUserInterruptSupersededRevision: params.activeUserInterruptSupersededRevision,
      completedAt: params.completedAt,
      lastErrorText: params.lastErrorText,
    },
  });
}

export async function claimRunnableAgentTaskRun(params: {
  id: string;
  leaseOwner: string;
  leaseExpiresAt: Date;
  now?: Date;
}): Promise<boolean> {
  const now = params.now ?? new Date();
  const updated = await agentTaskRunDelegate.updateMany({
    where: {
      id: params.id,
      status: 'running',
      nextRunnableAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: {
      leaseOwner: params.leaseOwner,
      leaseExpiresAt: params.leaseExpiresAt,
      heartbeatAt: now,
    },
  });
  return updated.count > 0;
}

export async function heartbeatAgentTaskRun(params: {
  id: string;
  leaseOwner: string;
  leaseExpiresAt: Date;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  await agentTaskRunDelegate.updateMany({
    where: {
      id: params.id,
      leaseOwner: params.leaseOwner,
    },
    data: {
      heartbeatAt: now,
      leaseExpiresAt: params.leaseExpiresAt,
    },
  });
}

export async function releaseAgentTaskRunLease(params: {
  id: string;
  leaseOwner: string;
}): Promise<void> {
  await agentTaskRunDelegate.updateMany({
    where: {
      id: params.id,
      leaseOwner: params.leaseOwner,
    },
    data: {
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
}

export async function listRunnableAgentTaskRuns(params: {
  now?: Date;
  limit: number;
}): Promise<AgentTaskRunRecord[]> {
  const now = params.now ?? new Date();
  const rows = await agentTaskRunDelegate.findMany({
    where: {
      status: 'running',
      nextRunnableAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: [{ nextRunnableAt: 'asc' }, { updatedAt: 'asc' }],
    take: params.limit,
  });
  return rows.map((row: NonNullable<AgentTaskRunRow>) => toRecord(row));
}

export async function findWaitingUserInputTaskRun(params: {
  guildId: string | null;
  channelId: string;
  requestedByUserId: string;
  replyToMessageId?: string | null;
}): Promise<AgentTaskRunRecord | null> {
  const rows = await agentTaskRunDelegate.findMany({
    where: {
      status: 'waiting_user_input',
      waitingKind: 'user_input',
      channelId: params.channelId,
      requestedByUserId: params.requestedByUserId,
      guildId: params.guildId,
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (rows.length === 0) {
    return null;
  }

  if (params.replyToMessageId) {
    const directMatch = rows.find((row) => {
      const persistedResponseMessageId = readResponseMessageId(row.responseSessionJson);
      return row.responseMessageId === params.replyToMessageId || persistedResponseMessageId === params.replyToMessageId;
    });
    if (directMatch) {
      return toRecord(directMatch);
    }
  }

  return null;
}

export async function findRunningTaskRunForActiveInterrupt(params: {
  guildId: string | null;
  channelId: string;
  requestedByUserId: string;
  replyToMessageId?: string | null;
}): Promise<AgentTaskRunRecord | null> {
  if (!params.replyToMessageId) {
    return null;
  }

  const rows = await agentTaskRunDelegate.findMany({
    where: {
      status: 'running',
      channelId: params.channelId,
      requestedByUserId: params.requestedByUserId,
      guildId: params.guildId,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const directMatch = rows.find((row) => {
    const persistedResponseMessageId = readResponseMessageId(row.responseSessionJson);
    return row.responseMessageId === params.replyToMessageId || persistedResponseMessageId === params.replyToMessageId;
  });
  return directMatch ? toRecord(directMatch) : null;
}

export async function queueRunningTaskRunActiveInterrupt(params: {
  threadId: string;
  requestedByUserId: string;
  guildId: string | null;
  channelId: string;
  messageId: string;
  userText: string;
  userContent?: unknown;
  now?: Date;
}): Promise<QueueRunningTaskRunActiveInterruptResult> {
  const now = params.now ?? new Date();
  const existing = await getAgentTaskRunByThreadId(params.threadId);
  if (!existing || existing.status !== 'running') {
    return 'stale';
  }
  if (
    existing.requestedByUserId !== params.requestedByUserId ||
    existing.channelId !== params.channelId ||
    existing.guildId !== params.guildId
  ) {
    return 'rejected';
  }

  const previousInterrupt = readActiveUserInterruptState(existing);
  const nextRevision = existing.activeUserInterruptRevision + 1;
  const payload: AgentTaskRunActiveUserInterruptPayload = {
    messageId: params.messageId,
    userId: params.requestedByUserId,
    channelId: params.channelId,
    guildId: params.guildId,
    userText: params.userText,
    userContent: params.userContent,
  };

  await agentTaskRunDelegate.update({
    where: { threadId: params.threadId },
    data: {
      activeUserInterruptJson: payload,
      activeUserInterruptRevision: nextRevision,
      activeUserInterruptQueuedAt: now,
      activeUserInterruptConsumedAt: null,
      activeUserInterruptSupersededAt:
        previousInterrupt && previousInterrupt.revision > previousInterrupt.consumedRevision ? now : null,
      activeUserInterruptSupersededRevision:
        previousInterrupt && previousInterrupt.revision > previousInterrupt.consumedRevision
          ? previousInterrupt.revision
          : null,
      nextRunnableAt: now,
      completedAt: null,
    },
  });

  return 'queued';
}

export async function deleteAgentTaskRunByThreadId(threadId: string): Promise<void> {
  await agentTaskRunDelegate.deleteMany({ where: { threadId } });
}

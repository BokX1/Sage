import { prisma } from '../../platform/db/prisma-client';
import type { ScheduledTaskRecord, ScheduledTaskRunRecord } from './types';

type ScheduledTaskRow = {
  id: string;
  guildId: string;
  channelId: string;
  createdByUserId: string;
  kind: string;
  status: string;
  timezone: string;
  cronExpr: string | null;
  runAt: Date | null;
  nextRunAt: Date | null;
  skipUntil: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  payloadJson: unknown;
  provenanceJson: unknown;
  lastErrorText: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ScheduledTaskRunRow = {
  id: string;
  taskId: string;
  dedupeKey: string;
  status: string;
  scheduledFor: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorText: string | null;
  resultJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ScheduledTaskDelegate = {
  create: (args: unknown) => Promise<ScheduledTaskRow>;
  findUnique: (args: unknown) => Promise<ScheduledTaskRow | null>;
  findMany: (args: unknown) => Promise<ScheduledTaskRow[]>;
  update: (args: unknown) => Promise<ScheduledTaskRow>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

type ScheduledTaskRunDelegate = {
  create: (args: unknown) => Promise<ScheduledTaskRunRow>;
  findUnique: (args: unknown) => Promise<ScheduledTaskRunRow | null>;
  findMany: (args: unknown) => Promise<ScheduledTaskRunRow[]>;
  update: (args: unknown) => Promise<ScheduledTaskRunRow>;
};

const taskDelegate = (prisma as unknown as { scheduledTask: ScheduledTaskDelegate }).scheduledTask;
const runDelegate = (prisma as unknown as { scheduledTaskRun: ScheduledTaskRunDelegate }).scheduledTaskRun;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toTaskRecord(row: ScheduledTaskRow): ScheduledTaskRecord {
  return {
    ...row,
    kind: row.kind as ScheduledTaskRecord['kind'],
    status: row.status as ScheduledTaskRecord['status'],
    payloadJson: row.payloadJson as ScheduledTaskRecord['payloadJson'],
    provenanceJson: asRecord(row.provenanceJson),
  };
}

function toTaskRunRecord(row: ScheduledTaskRunRow): ScheduledTaskRunRecord {
  return {
    ...row,
    status: row.status as ScheduledTaskRunRecord['status'],
    resultJson: asRecord(row.resultJson),
  };
}

export async function listScheduledTasksByGuild(guildId: string): Promise<ScheduledTaskRecord[]> {
  const rows = await taskDelegate.findMany({
    where: { guildId },
    orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }, { updatedAt: 'desc' }],
  });
  return rows.map(toTaskRecord);
}

export async function getScheduledTaskById(id: string): Promise<ScheduledTaskRecord | null> {
  const row = await taskDelegate.findUnique({ where: { id } });
  return row ? toTaskRecord(row) : null;
}

export async function upsertScheduledTask(params: {
  id?: string;
  guildId: string;
  channelId: string;
  createdByUserId: string;
  kind: ScheduledTaskRecord['kind'];
  status: ScheduledTaskRecord['status'];
  timezone: string;
  cronExpr?: string | null;
  runAt?: Date | null;
  nextRunAt?: Date | null;
  skipUntil?: Date | null;
  payloadJson: ScheduledTaskRecord['payloadJson'];
  provenanceJson?: Record<string, unknown> | null;
}): Promise<ScheduledTaskRecord> {
  if (params.id) {
    const row = await taskDelegate.update({
      where: { id: params.id },
      data: {
        channelId: params.channelId,
        kind: params.kind,
        status: params.status,
        timezone: params.timezone,
        cronExpr: params.cronExpr ?? null,
        runAt: params.runAt ?? null,
        nextRunAt: params.nextRunAt ?? null,
        skipUntil: params.skipUntil ?? null,
        payloadJson: params.payloadJson,
        provenanceJson: params.provenanceJson ?? undefined,
        lastErrorText: null,
      },
    });
    return toTaskRecord(row);
  }

  const row = await taskDelegate.create({
    data: {
      guildId: params.guildId,
      channelId: params.channelId,
      createdByUserId: params.createdByUserId,
      kind: params.kind,
      status: params.status,
      timezone: params.timezone,
      cronExpr: params.cronExpr ?? null,
      runAt: params.runAt ?? null,
      nextRunAt: params.nextRunAt ?? null,
      skipUntil: params.skipUntil ?? null,
      payloadJson: params.payloadJson,
      provenanceJson: params.provenanceJson ?? undefined,
    },
  });
  return toTaskRecord(row);
}

export async function cancelScheduledTask(id: string): Promise<ScheduledTaskRecord> {
  const row = await taskDelegate.update({
    where: { id },
    data: {
      status: 'cancelled',
      nextRunAt: null,
      skipUntil: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  return toTaskRecord(row);
}

export async function listDueScheduledTasks(params: {
  now: Date;
  leaseOwner: string;
  leaseTtlMs: number;
  limit?: number;
}): Promise<ScheduledTaskRecord[]> {
  const dueRows = await taskDelegate.findMany({
    where: {
      status: 'active',
      nextRunAt: { lte: params.now },
      OR: [
        { skipUntil: null },
        { skipUntil: { lte: params.now } },
      ],
      AND: [{ OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: params.now } }] }],
    },
    orderBy: [{ nextRunAt: 'asc' }],
    take: params.limit ?? 10,
  });

  const leased: ScheduledTaskRecord[] = [];
  for (const row of dueRows) {
    const claimed = await taskDelegate.updateMany({
      where: {
        id: row.id,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: params.now } }],
      },
      data: {
        leaseOwner: params.leaseOwner,
        leaseExpiresAt: new Date(params.now.getTime() + params.leaseTtlMs),
      },
    });
    if (claimed.count > 0) {
      leased.push(
        toTaskRecord({
          ...row,
          leaseOwner: params.leaseOwner,
          leaseExpiresAt: new Date(params.now.getTime() + params.leaseTtlMs),
        }),
      );
    }
  }

  return leased;
}

export async function markScheduledTaskRunStart(params: {
  taskId: string;
  dedupeKey: string;
  scheduledFor: Date;
}): Promise<{ run: ScheduledTaskRunRecord; created: boolean }> {
  const existing = await runDelegate.findUnique({
    where: {
      taskId_dedupeKey: {
        taskId: params.taskId,
        dedupeKey: params.dedupeKey,
      },
    },
  });
  if (existing) {
    return {
      run: toTaskRunRecord(existing),
      created: false,
    };
  }
  const row = await runDelegate.create({
    data: {
      taskId: params.taskId,
      dedupeKey: params.dedupeKey,
      status: 'running',
      scheduledFor: params.scheduledFor,
      startedAt: new Date(),
    },
  });
  return {
    run: toTaskRunRecord(row),
    created: true,
  };
}

export async function completeScheduledTask(params: {
  id: string;
  leaseOwner: string;
  nextRunAt: Date | null;
  lastErrorText?: string | null;
  succeeded: boolean;
  finishedAt?: Date;
}): Promise<ScheduledTaskRecord> {
  const row = await taskDelegate.update({
    where: { id: params.id },
    data: {
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRunAt: params.nextRunAt,
      skipUntil: null,
      lastRunAt: params.finishedAt ?? new Date(),
      lastSuccessAt: params.succeeded ? params.finishedAt ?? new Date() : undefined,
      lastErrorText: params.lastErrorText ?? null,
    },
  });
  return toTaskRecord(row);
}

export async function completeScheduledTaskRun(params: {
  id: string;
  status: ScheduledTaskRunRecord['status'];
  resultJson?: Record<string, unknown> | null;
  errorText?: string | null;
}): Promise<ScheduledTaskRunRecord> {
  const row = await runDelegate.update({
    where: { id: params.id },
    data: {
      status: params.status,
      resultJson: params.resultJson ?? undefined,
      errorText: params.errorText ?? null,
      finishedAt: new Date(),
    },
  });
  return toTaskRunRecord(row);
}

export async function listScheduledTaskRuns(params: {
  taskId: string;
  limit?: number;
}): Promise<ScheduledTaskRunRecord[]> {
  const rows = await runDelegate.findMany({
    where: { taskId: params.taskId },
    orderBy: { createdAt: 'desc' },
    take: params.limit ?? 10,
  });
  return rows.map(toTaskRunRecord);
}

export async function updateScheduledTaskState(params: {
  id: string;
  status?: ScheduledTaskRecord['status'];
  nextRunAt?: Date | null;
  skipUntil?: Date | null;
  lastErrorText?: string | null;
}): Promise<ScheduledTaskRecord> {
  const row = await taskDelegate.update({
    where: { id: params.id },
    data: {
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.nextRunAt !== undefined ? { nextRunAt: params.nextRunAt } : {}),
      ...(params.skipUntil !== undefined ? { skipUntil: params.skipUntil } : {}),
      ...(params.lastErrorText !== undefined ? { lastErrorText: params.lastErrorText } : {}),
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  return toTaskRecord(row);
}

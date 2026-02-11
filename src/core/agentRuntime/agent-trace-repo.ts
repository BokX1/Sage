import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma-client';
import { logger } from '../utils/logger';

export interface TraceStartData {
  id: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  routeKind: string;
  routerJson: unknown;
  expertsJson: unknown;
  tokenJson?: unknown;
  reasoningText?: string;
  agentGraphJson?: unknown;
  agentEventsJson?: unknown;
  qualityJson?: unknown;
  budgetJson?: unknown;
}

export interface TraceEndData {
  id: string;
  toolJson?: unknown;
  qualityJson?: unknown;
  budgetJson?: unknown;
  agentEventsJson?: unknown;
  replyText: string;
}

export interface AgentRunWriteRow {
  traceId: string;
  nodeId: string;
  agent: string;
  status: string;
  attempts: number;
  startedAt: string | Date;
  finishedAt?: string | Date | null;
  latencyMs?: number | null;
  errorText?: string | null;
  metadataJson?: unknown;
}

function isSchemaMismatchError(error: unknown): boolean {
  if (!error) return false;

  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === 'string'
        ? error.toLowerCase()
        : '';

  return (
    message.includes('p2021') || // table does not exist
    message.includes('p2022') || // column does not exist
    message.includes('does not exist') ||
    message.includes('unknown field')
  );
}

/**
 * Create or update trace start (selector + provider execution).
 */
export async function upsertTraceStart(data: TraceStartData): Promise<void> {
  const buildTokenPayload = (): Prisma.InputJsonValue => {
    const payload: Record<string, unknown> = {};
    if (data.tokenJson && typeof data.tokenJson === 'object' && !Array.isArray(data.tokenJson)) {
      Object.assign(payload, data.tokenJson as Record<string, unknown>);
    } else if (data.tokenJson !== undefined) {
      payload.runtime = data.tokenJson;
    }

    if (data.agentGraphJson !== undefined) {
      payload.agentGraph = data.agentGraphJson;
    }
    if (data.agentEventsJson !== undefined) {
      payload.agentEvents = data.agentEventsJson;
    }
    if (data.qualityJson !== undefined) {
      payload.quality = data.qualityJson;
    }
    if (data.budgetJson !== undefined) {
      payload.budget = data.budgetJson;
    }

    return payload as Prisma.InputJsonValue;
  };

  const jsonMap = (val: unknown) =>
    val === undefined ? Prisma.JsonNull : (val as Prisma.InputJsonValue);

  const tokenPayload = buildTokenPayload();

  const createData: Prisma.AgentTraceCreateInput = {
    id: data.id,
    guildId: data.guildId,
    channelId: data.channelId,
    userId: data.userId,
    routeKind: data.routeKind,
    routerJson: jsonMap(data.routerJson),
    expertsJson: jsonMap(data.expertsJson),
    tokenJson: jsonMap(tokenPayload),
    reasoningText: data.reasoningText ?? null,
    replyText: '', // Placeholder until trace end
  };

  const updateData: Prisma.AgentTraceUpdateInput = {
    routeKind: data.routeKind,
    routerJson: jsonMap(data.routerJson),
    expertsJson: jsonMap(data.expertsJson),
    tokenJson: jsonMap(tokenPayload),
    reasoningText: data.reasoningText ?? null,
  };

  if (data.agentGraphJson !== undefined) {
    createData.agentGraphJson = jsonMap(data.agentGraphJson);
    updateData.agentGraphJson = jsonMap(data.agentGraphJson);
  }

  if (data.agentEventsJson !== undefined) {
    createData.agentEventsJson = jsonMap(data.agentEventsJson);
    updateData.agentEventsJson = jsonMap(data.agentEventsJson);
  }

  if (data.qualityJson !== undefined) {
    createData.qualityJson = jsonMap(data.qualityJson);
    updateData.qualityJson = jsonMap(data.qualityJson);
  }

  if (data.budgetJson !== undefined) {
    createData.budgetJson = jsonMap(data.budgetJson);
    updateData.budgetJson = jsonMap(data.budgetJson);
  }

  try {
    await prisma.agentTrace.upsert({
      where: { id: data.id },
      create: createData,
      update: updateData,
    });
  } catch (error) {
    if (!isSchemaMismatchError(error)) {
      throw error;
    }

    logger.warn({ error, traceId: data.id }, 'AgentTrace schema not yet migrated; using legacy trace write');

    await prisma.agentTrace.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        guildId: data.guildId,
        channelId: data.channelId,
        userId: data.userId,
        routeKind: data.routeKind,
        routerJson: jsonMap(data.routerJson),
        expertsJson: jsonMap(data.expertsJson),
        tokenJson: jsonMap(tokenPayload),
        reasoningText: data.reasoningText ?? null,
        replyText: '',
      },
      update: {
        routeKind: data.routeKind,
        routerJson: jsonMap(data.routerJson),
        expertsJson: jsonMap(data.expertsJson),
        tokenJson: jsonMap(tokenPayload),
        reasoningText: data.reasoningText ?? null,
      },
    });
  }
}

/**
 * Update trace end (governor + tool calls + final reply).
 */
export async function updateTraceEnd(data: TraceEndData): Promise<void> {
  const jsonMap = (val: unknown) =>
    val === undefined ? Prisma.JsonNull : (val as Prisma.InputJsonValue);

  const updateData: Prisma.AgentTraceUpdateInput = {
    toolJson: jsonMap(data.toolJson ?? Prisma.JsonNull),
    replyText: data.replyText,
  };

  if (data.qualityJson !== undefined) {
    updateData.qualityJson = jsonMap(data.qualityJson);
  }
  if (data.budgetJson !== undefined) {
    updateData.budgetJson = jsonMap(data.budgetJson);
  }
  if (data.agentEventsJson !== undefined) {
    updateData.agentEventsJson = jsonMap(data.agentEventsJson);
  }

  try {
    await prisma.agentTrace.update({
      where: { id: data.id },
      data: updateData,
    });
  } catch (error) {
    if (!isSchemaMismatchError(error)) {
      throw error;
    }

    logger.warn({ error, traceId: data.id }, 'AgentTrace schema not yet migrated; using legacy trace end write');

    await prisma.agentTrace.update({
      where: { id: data.id },
      data: {
        toolJson: jsonMap(data.toolJson ?? Prisma.JsonNull),
        replyText: data.replyText,
      },
    });
  }
}

function normalizeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Replace per-node execution rows for a trace.
 * Best effort: if AgentRun client is unavailable or schema not migrated, logs and returns.
 */
export async function replaceAgentRuns(traceId: string, rows: AgentRunWriteRow[]): Promise<void> {
  if (rows.length === 0) return;

  const data: Prisma.AgentRunCreateManyInput[] = rows.map((row) => ({
    traceId,
    nodeId: row.nodeId,
    agent: row.agent,
    status: row.status,
    attempts: row.attempts,
    startedAt: normalizeDate(row.startedAt) ?? new Date(),
    finishedAt: normalizeDate(row.finishedAt ?? null),
    latencyMs: row.latencyMs ?? null,
    errorText: row.errorText ?? null,
    metadataJson:
      row.metadataJson === undefined ? Prisma.JsonNull : (row.metadataJson as Prisma.InputJsonValue),
  }));

  try {
    await prisma.agentRun.deleteMany({ where: { traceId } });
    await prisma.agentRun.createMany({ data });
  } catch (error) {
    logger.warn({ error, traceId }, 'Failed to persist AgentRun rows (non-fatal)');
  }
}

/**
 * Get a trace by ID.
 */
export async function getTraceById(id: string) {
  return prisma.agentTrace.findUnique({
    where: { id },
  });
}

/**
 * List recent traces for a guild or channel.
 */
export async function listRecentTraces(params: {
  guildId?: string;
  channelId?: string;
  limit: number;
}) {
  const { guildId, channelId, limit } = params;

  const where: Prisma.AgentTraceWhereInput = {};
  if (guildId) where.guildId = guildId;
  if (channelId) where.channelId = channelId;

  return prisma.agentTrace.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

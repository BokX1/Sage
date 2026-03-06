import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db/prisma-client';

export interface TraceStartData {
  id: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  routeKind?: string;
  tokenJson?: unknown;
  reasoningText?: string;
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

/**
 * Create or update trace start (selector + provider execution).
 */
export async function upsertTraceStart(data: TraceStartData): Promise<void> {
  const routeKind = data.routeKind?.trim() || 'single';
  const buildTokenPayload = (): Prisma.InputJsonValue => {
    const payload: Record<string, unknown> = {};
    if (data.tokenJson && typeof data.tokenJson === 'object' && !Array.isArray(data.tokenJson)) {
      Object.assign(payload, data.tokenJson as Record<string, unknown>);
    } else if (data.tokenJson !== undefined) {
      payload.runtime = data.tokenJson;
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
    routeKind,
    tokenJson: jsonMap(tokenPayload),
    reasoningText: data.reasoningText ?? null,
    replyText: '',
  };

  const updateData: Prisma.AgentTraceUpdateInput = {
    routeKind,
    tokenJson: jsonMap(tokenPayload),
    reasoningText: data.reasoningText ?? null,
  };

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

  await prisma.agentTrace.upsert({
    where: { id: data.id },
    create: createData,
    update: updateData,
  });
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

  await prisma.agentTrace.update({
    where: { id: data.id },
    data: updateData,
  });
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

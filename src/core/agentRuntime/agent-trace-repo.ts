import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma-client';

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
}

export interface TraceEndData {
  id: string;
  toolJson?: unknown;
  replyText: string;
}

/**
 * Create or update trace start (router + experts execution).
 */
export async function upsertTraceStart(data: TraceStartData): Promise<void> {
  const jsonMap = (val: unknown) =>
    val === undefined ? Prisma.JsonNull : (val as Prisma.InputJsonValue);

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
      tokenJson: jsonMap(data.tokenJson ?? {}),
      reasoningText: data.reasoningText ?? null,
      replyText: '', // Placeholder until trace end
    },
    update: {
      routeKind: data.routeKind,
      routerJson: jsonMap(data.routerJson),
      expertsJson: jsonMap(data.expertsJson),
      tokenJson: jsonMap(data.tokenJson ?? {}),
      reasoningText: data.reasoningText ?? null,
    },
  });
}

/**
 * Update trace end (governor + tool calls + final reply).
 */
export async function updateTraceEnd(data: TraceEndData): Promise<void> {
  const jsonMap = (val: unknown) =>
    val === undefined ? Prisma.JsonNull : (val as Prisma.InputJsonValue);

  await prisma.agentTrace.update({
    where: { id: data.id },
    data: {
      // governorJson removed
      toolJson: jsonMap(data.toolJson ?? Prisma.JsonNull),
      replyText: data.replyText,
    },
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

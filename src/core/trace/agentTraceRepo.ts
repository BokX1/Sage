import { prisma } from '../../db/client';

export interface TraceStartData {
  id: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  routeKind: string;
  routerJson: unknown;
  expertsJson: unknown;
  tokenJson?: unknown;
}

export interface TraceEndData {
  id: string;
  governorJson: unknown;
  toolJson?: unknown;
  replyText: string;
}

/**
 * Create or update trace start (router + experts execution).
 */
export async function upsertTraceStart(data: TraceStartData): Promise<void> {
  await prisma.agentTrace.upsert({
    where: { id: data.id },
    create: {
      id: data.id,
      guildId: data.guildId,
      channelId: data.channelId,
      userId: data.userId,
      routeKind: data.routeKind,
      routerJson: data.routerJson as any,
      expertsJson: data.expertsJson as any,
      governorJson: {}, // Placeholder until trace end
      tokenJson: data.tokenJson as any,
      replyText: '', // Placeholder until trace end
    },
    update: {
      routeKind: data.routeKind,
      routerJson: data.routerJson as any,
      expertsJson: data.expertsJson as any,
      tokenJson: data.tokenJson as any,
    },
  });
}

/**
 * Update trace end (governor + tool calls + final reply).
 */
export async function updateTraceEnd(data: TraceEndData): Promise<void> {
  await prisma.agentTrace.update({
    where: { id: data.id },
    data: {
      governorJson: data.governorJson as any,
      toolJson: data.toolJson as any,
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

  const where: any = {};
  if (guildId) where.guildId = guildId;
  if (channelId) where.channelId = channelId;

  return prisma.agentTrace.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

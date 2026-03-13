import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db/prisma-client';

function toJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export interface TraceStartData {
  id: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  routeKind?: string;
  threadId?: string | null;
  parentTraceId?: string | null;
  graphStatus?: string | null;
  approvalRequestId?: string | null;
  langSmithRunId?: string | null;
  langSmithTraceId?: string | null;
  tokenJson?: unknown;
  budgetJson?: unknown;
}

export interface TraceEndData {
  id: string;
  threadId?: string | null;
  parentTraceId?: string | null;
  graphStatus?: string | null;
  approvalRequestId?: string | null;
  terminationReason?: string | null;
  langSmithRunId?: string | null;
  langSmithTraceId?: string | null;
  toolJson?: unknown;
  budgetJson?: unknown;
  tokenJson?: unknown;
  replyText: string;
}

export async function upsertTraceStart(data: TraceStartData): Promise<void> {
  const routeKind = data.routeKind?.trim() || 'single';

  const createData: Prisma.AgentTraceCreateInput = {
    id: data.id,
    guildId: data.guildId,
    channelId: data.channelId,
    userId: data.userId,
    routeKind,
    threadId: data.threadId?.trim() || null,
    parentTraceId: data.parentTraceId?.trim() || null,
    graphStatus: data.graphStatus?.trim() || null,
    approvalRequestId: data.approvalRequestId?.trim() || null,
    langSmithRunId: data.langSmithRunId?.trim() || null,
    langSmithTraceId: data.langSmithTraceId?.trim() || null,
    tokenJson: toJsonValue(data.tokenJson),
    budgetJson: toJsonValue(data.budgetJson),
    replyText: '',
  };

  const updateData: Prisma.AgentTraceUpdateInput = {
    routeKind,
    threadId: data.threadId?.trim() || null,
    parentTraceId: data.parentTraceId?.trim() || null,
    graphStatus: data.graphStatus?.trim() || null,
    approvalRequestId: data.approvalRequestId?.trim() || null,
    langSmithRunId: data.langSmithRunId?.trim() || null,
    langSmithTraceId: data.langSmithTraceId?.trim() || null,
    tokenJson: toJsonValue(data.tokenJson),
    budgetJson: toJsonValue(data.budgetJson),
  };

  await prisma.agentTrace.upsert({
    where: { id: data.id },
    create: createData,
    update: updateData,
  });
}

export async function updateTraceEnd(data: TraceEndData): Promise<void> {
  await prisma.agentTrace.update({
    where: { id: data.id },
    data: {
      threadId: data.threadId?.trim() || null,
      parentTraceId: data.parentTraceId?.trim() || null,
      graphStatus: data.graphStatus?.trim() || null,
      approvalRequestId: data.approvalRequestId?.trim() || null,
      terminationReason: data.terminationReason?.trim() || null,
      langSmithRunId: data.langSmithRunId?.trim() || null,
      langSmithTraceId: data.langSmithTraceId?.trim() || null,
      toolJson: toJsonValue(data.toolJson),
      budgetJson: toJsonValue(data.budgetJson),
      tokenJson: toJsonValue(data.tokenJson),
      replyText: data.replyText,
    },
  });
}

export async function getTraceById(id: string) {
  return prisma.agentTrace.findUnique({
    where: { id },
  });
}

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

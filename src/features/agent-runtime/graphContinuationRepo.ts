import { prisma } from '../../platform/db/prisma-client';

export const GRAPH_CONTINUATION_TTL_MS = 24 * 60 * 60_000;
export const GRAPH_CONTINUATION_MAX_WINDOWS = 4;

export interface AgentContinuationSessionRecord {
  id: string;
  threadId: string;
  originTraceId: string;
  latestTraceId: string;
  guildId: string | null;
  channelId: string;
  requestedByUserId: string;
  status: string;
  pauseKind: string;
  completedWindows: number;
  maxWindows: number;
  summaryText: string;
  resumeNode: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(value: {
  id: string;
  threadId: string;
  originTraceId: string;
  latestTraceId: string;
  guildId: string | null;
  channelId: string;
  requestedByUserId: string;
  status: string;
  pauseKind: string;
  completedWindows: number;
  maxWindows: number;
  summaryText: string;
  resumeNode: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): AgentContinuationSessionRecord {
  return {
    id: value.id,
    threadId: value.threadId,
    originTraceId: value.originTraceId,
    latestTraceId: value.latestTraceId,
    guildId: value.guildId,
    channelId: value.channelId,
    requestedByUserId: value.requestedByUserId,
    status: value.status,
    pauseKind: value.pauseKind,
    completedWindows: value.completedWindows,
    maxWindows: value.maxWindows,
    summaryText: value.summaryText,
    resumeNode: value.resumeNode,
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function createGraphContinuationSession(params: {
  threadId: string;
  originTraceId: string;
  latestTraceId: string;
  guildId: string | null;
  channelId: string;
  requestedByUserId: string;
  pauseKind: string;
  completedWindows: number;
  maxWindows?: number;
  summaryText: string;
  resumeNode: 'llm_call' | 'route_tool_phase';
  expiresAt?: Date;
}): Promise<AgentContinuationSessionRecord> {
  const created = await prisma.agentContinuationSession.create({
    data: {
      threadId: params.threadId,
      originTraceId: params.originTraceId,
      latestTraceId: params.latestTraceId,
      guildId: params.guildId,
      channelId: params.channelId,
      requestedByUserId: params.requestedByUserId,
      status: 'pending',
      pauseKind: params.pauseKind,
      completedWindows: params.completedWindows,
      maxWindows: params.maxWindows ?? GRAPH_CONTINUATION_MAX_WINDOWS,
      summaryText: params.summaryText,
      resumeNode: params.resumeNode,
      expiresAt: params.expiresAt ?? new Date(Date.now() + GRAPH_CONTINUATION_TTL_MS),
    },
  });

  return toRecord(created);
}

export async function getGraphContinuationSessionById(
  id: string,
): Promise<AgentContinuationSessionRecord | null> {
  const row = await prisma.agentContinuationSession.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function markGraphContinuationSessionExpired(id: string): Promise<void> {
  await prisma.agentContinuationSession.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'expired' },
  });
}

export async function consumeGraphContinuationSession(params: {
  id: string;
  latestTraceId: string;
}): Promise<AgentContinuationSessionRecord | null> {
  const updated = await prisma.agentContinuationSession.updateMany({
    where: {
      id: params.id,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
    data: {
      status: 'resumed',
      latestTraceId: params.latestTraceId,
    },
  });

  if (updated.count === 0) {
    return null;
  }

  return getGraphContinuationSessionById(params.id);
}

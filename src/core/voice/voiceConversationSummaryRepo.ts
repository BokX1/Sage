/**
 * @module src/core/voice/voiceConversationSummaryRepo
 * @description Defines the voice conversation summary repo module.
 */
import { prisma } from '../../core/db/prisma-client';

/**
 * Represents the VoiceConversationSummaryRow type.
 */
export type VoiceConversationSummaryRow = {
  id: string;
  guildId: string;
  voiceChannelId: string;
  voiceChannelName?: string | null;
  initiatedByUserId: string;
  startedAt: Date;
  endedAt: Date;
  speakerStatsJson: unknown;
  summaryText: string;
  topicsJson?: unknown | null;
  threadsJson?: unknown | null;
  decisionsJson?: unknown | null;
  actionItemsJson?: unknown | null;
  unresolvedJson?: unknown | null;
  sentiment?: string | null;
  glossaryJson?: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaVoiceConversationSummaryClient = {
  create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    take?: number;
  }) => Promise<Record<string, unknown>[]>;
};

function getClient(): PrismaVoiceConversationSummaryClient {
  return (prisma as unknown as { voiceConversationSummary: PrismaVoiceConversationSummaryClient })
    .voiceConversationSummary;
}

function mapRow(row: Record<string, unknown>): VoiceConversationSummaryRow {
  return {
    id: row.id as string,
    guildId: row.guildId as string,
    voiceChannelId: row.voiceChannelId as string,
    voiceChannelName: row.voiceChannelName as string | null,
    initiatedByUserId: row.initiatedByUserId as string,
    startedAt: row.startedAt as Date,
    endedAt: row.endedAt as Date,
    speakerStatsJson: row.speakerStatsJson,
    summaryText: row.summaryText as string,
    topicsJson: row.topicsJson ?? null,
    threadsJson: row.threadsJson ?? null,
    decisionsJson: row.decisionsJson ?? null,
    actionItemsJson: row.actionItemsJson ?? null,
    unresolvedJson: row.unresolvedJson ?? null,
    sentiment: row.sentiment as string | null,
    glossaryJson: row.glossaryJson ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

/**
 * Runs createVoiceConversationSummary.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
export async function createVoiceConversationSummary(params: {
  guildId: string;
  voiceChannelId: string;
  voiceChannelName?: string;
  initiatedByUserId: string;
  startedAt: Date;
  endedAt: Date;
  speakerStats: Array<{ userId: string; displayName?: string; utteranceCount: number }>;
  summaryText: string;
  topics?: string[];
  threads?: string[];
  decisions?: string[];
  actionItems?: string[];
  unresolved?: string[];
  sentiment?: string;
  glossary?: Record<string, string>;
}): Promise<void> {
  const client = getClient();
  await client.create({
    data: {
      guildId: params.guildId,
      voiceChannelId: params.voiceChannelId,
      voiceChannelName: params.voiceChannelName ?? null,
      initiatedByUserId: params.initiatedByUserId,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
      speakerStatsJson: params.speakerStats,
      summaryText: params.summaryText,
      topicsJson: params.topics ?? null,
      threadsJson: params.threads ?? null,
      decisionsJson: params.decisions ?? null,
      actionItemsJson: params.actionItems ?? null,
      unresolvedJson: params.unresolved ?? null,
      sentiment: params.sentiment ?? null,
      glossaryJson: params.glossary ?? null,
    },
  });
}

/**
 * Runs listVoiceConversationSummaries.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
export async function listVoiceConversationSummaries(params: {
  guildId: string;
  voiceChannelId?: string;
  since: Date;
  limit: number;
}): Promise<VoiceConversationSummaryRow[]> {
  const client = getClient();
  const where: Record<string, unknown> = {
    guildId: params.guildId,
    endedAt: { gte: params.since },
  };
  if (params.voiceChannelId) {
    where.voiceChannelId = params.voiceChannelId;
  }

  const rows = await client.findMany({
    where,
    orderBy: { endedAt: 'desc' },
    take: Math.max(1, Math.min(50, Math.floor(params.limit))),
  });
  return rows.map(mapRow);
}


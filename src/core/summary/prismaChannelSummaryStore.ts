import { prisma } from '../../core/db/prisma-client';
import { ChannelSummary, ChannelSummaryStore } from './channelSummaryStore';

type PrismaChannelSummaryClient = {
  upsert: (args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  findUnique: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
};

function getChannelSummaryClient(): PrismaChannelSummaryClient {
  return (prisma as unknown as { channelSummary: PrismaChannelSummaryClient }).channelSummary;
}

export class PrismaChannelSummaryStore implements ChannelSummaryStore {
  async upsertSummary(params: {
    guildId: string;
    channelId: string;
    kind: 'rolling' | 'profile';
    windowStart: Date;
    windowEnd: Date;
    summaryText: string;
    topics?: string[];
    threads?: string[];
    unresolved?: string[];
    decisions?: string[];
    actionItems?: string[];
    sentiment?: string;
    glossary?: Record<string, string>;
  }): Promise<void> {
    const channelSummary = getChannelSummaryClient();
    await channelSummary.upsert({
      where: {
        guildId_channelId_kind: {
          guildId: params.guildId,
          channelId: params.channelId,
          kind: params.kind,
        },
      },
      create: {
        guildId: params.guildId,
        channelId: params.channelId,
        kind: params.kind,
        windowStart: params.windowStart,
        windowEnd: params.windowEnd,
        summaryText: params.summaryText,
        topicsJson: params.topics ?? null,
        threadsJson: params.threads ?? null,
        unresolvedJson: params.unresolved ?? null,
        glossaryJson: params.glossary ?? null,
        decisionsJson: params.decisions ?? null,
        actionItemsJson: params.actionItems ?? null,
        sentiment: params.sentiment ?? null,
      },
      update: {
        windowStart: params.windowStart,
        windowEnd: params.windowEnd,
        summaryText: params.summaryText,
        topicsJson: params.topics ?? null,
        threadsJson: params.threads ?? null,
        unresolvedJson: params.unresolved ?? null,
        glossaryJson: params.glossary ?? null,
        decisionsJson: params.decisions ?? null,
        actionItemsJson: params.actionItems ?? null,
        sentiment: params.sentiment ?? null,
      },
    });
  }

  async getLatestSummary(params: {
    guildId: string;
    channelId: string;
    kind: 'rolling' | 'profile';
  }): Promise<ChannelSummary | null> {
    const channelSummary = getChannelSummaryClient();
    const row = await channelSummary.findUnique({
      where: {
        guildId_channelId_kind: {
          guildId: params.guildId,
          channelId: params.channelId,
          kind: params.kind,
        },
      },
    });

    if (!row) return null;

    return {
      id: row.id as string,
      guildId: row.guildId as string,
      channelId: row.channelId as string,
      kind: row.kind as 'rolling' | 'profile',
      windowStart: row.windowStart as Date,
      windowEnd: row.windowEnd as Date,
      summaryText: row.summaryText as string,
      topics: (row.topicsJson as string[] | null) ?? undefined,
      threads: (row.threadsJson as string[] | null) ?? undefined,
      unresolved: (row.unresolvedJson as string[] | null) ?? undefined,
      decisions: (row.decisionsJson as string[] | null) ?? undefined,
      actionItems: (row.actionItemsJson as string[] | null) ?? undefined,
      sentiment: (row.sentiment as string | null) ?? undefined,
      glossary: (row.glossaryJson as Record<string, string> | null) ?? undefined,
      updatedAt: row.updatedAt as Date,
    };
  }
}

import { ChannelSummary, ChannelSummaryKind, ChannelSummaryStore } from './channelSummaryStore';

type SummaryKey = string;

function makeKey(guildId: string, channelId: string, kind: string): SummaryKey {
  return `${guildId}:${channelId}:${kind}`;
}

/**
 * Defines the InMemoryChannelSummaryStore class.
 */
export class InMemoryChannelSummaryStore implements ChannelSummaryStore {
  private summaries = new Map<SummaryKey, ChannelSummary>();

  async upsertSummary(params: {
    guildId: string;
    channelId: string;
    kind: ChannelSummaryKind;
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
    const now = new Date();
    const summary: ChannelSummary = {
      guildId: params.guildId,
      channelId: params.channelId,
      kind: params.kind,
      windowStart: params.windowStart,
      windowEnd: params.windowEnd,
      summaryText: params.summaryText,
      topics: params.topics,
      threads: params.threads,
      unresolved: params.unresolved,
      decisions: params.decisions,
      actionItems: params.actionItems,
      sentiment: params.sentiment,
      glossary: params.glossary,
      updatedAt: now,
    };
    this.summaries.set(makeKey(params.guildId, params.channelId, params.kind), summary);
  }

  async getLatestSummary(params: {
    guildId: string;
    channelId: string;
    kind: ChannelSummaryKind;
  }): Promise<ChannelSummary | null> {
    return this.summaries.get(makeKey(params.guildId, params.channelId, params.kind)) ?? null;
  }

  async listArchiveSummaries(params: {
    guildId: string;
    channelId: string;
    limit?: number;
  }): Promise<ChannelSummary[]> {
    const take = Math.max(1, Math.min(260, Math.floor(params.limit ?? 52)));
    const filtered = Array.from(this.summaries.values())
      .filter(
        (summary) =>
          summary.guildId === params.guildId &&
          summary.channelId === params.channelId &&
          summary.kind.startsWith('archive:'),
      )
      .sort((a, b) => {
        const aTime = a.updatedAt?.getTime() ?? a.windowEnd.getTime();
        const bTime = b.updatedAt?.getTime() ?? b.windowEnd.getTime();
        return bTime - aTime;
      })
      .slice(0, take);
    return filtered;
  }

  async listActiveProfiles(): Promise<Array<{ guildId: string; channelId: string }>> {
    const active = new Set<string>();
    const results: Array<{ guildId: string; channelId: string }> = [];

    for (const summary of this.summaries.values()) {
      if (summary.kind === 'profile') {
        const key = `${summary.guildId}:${summary.channelId}`;
        if (!active.has(key)) {
          active.add(key);
          results.push({ guildId: summary.guildId, channelId: summary.channelId });
        }
      }
    }
    return results;
  }
}

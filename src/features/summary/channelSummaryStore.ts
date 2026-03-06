export type ChannelSummaryKind = 'rolling' | 'profile' | `archive:${string}`;

export interface ChannelSummary {
  id?: string;
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
  updatedAt?: Date;
}

export interface ChannelSummaryStore {
  upsertSummary(params: {
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
  }): Promise<void>;
  getLatestSummary(params: {
    guildId: string;
    channelId: string;
    kind: ChannelSummaryKind;
  }): Promise<ChannelSummary | null>;
  listArchiveSummaries(params: {
    guildId: string;
    channelId: string;
    limit?: number;
  }): Promise<ChannelSummary[]>;
  listActiveProfiles(): Promise<Array<{ guildId: string; channelId: string }>>;
}

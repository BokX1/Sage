export type ChannelSummaryKind = 'rolling' | 'profile';

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
        glossary?: Record<string, string>;
    }): Promise<void>;
    getLatestSummary(params: {
        guildId: string;
        channelId: string;
        kind: ChannelSummaryKind;
    }): Promise<ChannelSummary | null>;
}

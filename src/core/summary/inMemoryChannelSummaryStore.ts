import { ChannelSummary, ChannelSummaryStore } from './channelSummaryStore';

type SummaryKey = string;

function makeKey(guildId: string, channelId: string, kind: string): SummaryKey {
    return `${guildId}:${channelId}:${kind}`;
}

export class InMemoryChannelSummaryStore implements ChannelSummaryStore {
    private summaries = new Map<SummaryKey, ChannelSummary>();

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
            glossary: params.glossary,
            updatedAt: now,
        };
        this.summaries.set(makeKey(params.guildId, params.channelId, params.kind), summary);
    }

    async getLatestSummary(params: {
        guildId: string;
        channelId: string;
        kind: 'rolling' | 'profile';
    }): Promise<ChannelSummary | null> {
        return this.summaries.get(makeKey(params.guildId, params.channelId, params.kind)) ?? null;
    }
}

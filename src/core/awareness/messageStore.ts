import { appendMessage, deleteOlderThan, getRecentMessages } from './channelRingBuffer';
import { ChannelMessage } from './types';

export interface MessageStore {
    append(message: ChannelMessage): Promise<void>;
    fetchRecent(params: {
        guildId: string | null;
        channelId: string;
        limit: number;
        sinceMs?: number;
    }): Promise<ChannelMessage[]>;
    deleteOlderThan(cutoffMs: number): Promise<number>;
}

export class InMemoryMessageStore implements MessageStore {
    async append(message: ChannelMessage): Promise<void> {
        appendMessage(message);
    }

    async fetchRecent(params: {
        guildId: string | null;
        channelId: string;
        limit: number;
        sinceMs?: number;
    }): Promise<ChannelMessage[]> {
        return getRecentMessages(params);
    }

    async deleteOlderThan(cutoffMs: number): Promise<number> {
        return deleteOlderThan(cutoffMs);
    }
}

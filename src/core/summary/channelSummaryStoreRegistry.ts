import { config } from '../../config';
import { ChannelSummaryStore } from './channelSummaryStore';
import { InMemoryChannelSummaryStore } from './inMemoryChannelSummaryStore';
import { PrismaChannelSummaryStore } from './prismaChannelSummaryStore';

let store: ChannelSummaryStore | null = null;

export function getChannelSummaryStore(): ChannelSummaryStore {
    if (store) return store;

    if (config.NODE_ENV === 'test') {
        store = new InMemoryChannelSummaryStore();
        return store;
    }

    store = new PrismaChannelSummaryStore();
    return store;
}

export function setChannelSummaryStore(nextStore: ChannelSummaryStore | null): void {
    store = nextStore;
}

/**
 * @module src/core/summary/channelSummaryStoreRegistry
 * @description Defines the channel summary store registry module.
 */
import { config } from '../../config';
import { ChannelSummaryStore } from './channelSummaryStore';
import { InMemoryChannelSummaryStore } from './inMemoryChannelSummaryStore';
import { PrismaChannelSummaryStore } from './prismaChannelSummaryStore';

let store: ChannelSummaryStore | null = null;

/**
 * Runs getChannelSummaryStore.
 *
 * @returns Returns the function result.
 */
export function getChannelSummaryStore(): ChannelSummaryStore {
  if (store) return store;

  if (config.NODE_ENV === 'test') {
    store = new InMemoryChannelSummaryStore();
    return store;
  }

  store = new PrismaChannelSummaryStore();
  return store;
}

/**
 * Runs setChannelSummaryStore.
 *
 * @param nextStore - Describes the nextStore input.
 * @returns Returns the function result.
 */
export function setChannelSummaryStore(nextStore: ChannelSummaryStore | null): void {
  store = nextStore;
}

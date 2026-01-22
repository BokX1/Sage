import { appendMessage, deleteOlderThan, getRecentMessages } from './channelRingBuffer';
import { ChannelMessage } from './types';

/**
 * Persist and retrieve channel messages for awareness features.
 *
 * Details: abstracts over in-memory or database-backed storage.
 *
 * Side effects: depends on implementation (memory or database).
 * Error behavior: depends on implementation.
 */
export interface MessageStore {
  /**
   * Append a message to the store.
   *
   * Details: implementations may deduplicate by message ID.
   *
   * Side effects: writes to memory or persistent storage.
   * Error behavior: rejects on storage failure.
   *
   * @param message - Message to persist.
   */
  append(message: ChannelMessage): Promise<void>;
  /**
   * Fetch recent messages from the store.
   *
   * Details: returns messages ordered from oldest to newest.
   *
   * Side effects: reads from memory or persistent storage.
   * Error behavior: rejects on storage failure.
   *
   * @param params - Channel selector and retrieval limits.
   * @returns Recent messages in chronological order.
   */
  fetchRecent(params: {
    guildId: string | null;
    channelId: string;
    limit: number;
    sinceMs?: number;
  }): Promise<ChannelMessage[]>;
  /**
   * Delete messages older than the cutoff timestamp.
   *
   * Details: bulk deletion for retention enforcement.
   *
   * Side effects: deletes from memory or persistent storage.
   * Error behavior: rejects on storage failure.
   *
   * @param cutoffMs - Unix epoch cutoff in milliseconds.
   * @returns Count of deleted messages.
   */
  deleteOlderThan(cutoffMs: number): Promise<number>;
}

/**
 * Store awareness messages in memory using the shared ring buffer.
 *
 * Details: intended for lightweight runtime usage without persistence.
 *
 * Side effects: mutates in-memory buffers.
 * Error behavior: none.
 */
export class InMemoryMessageStore implements MessageStore {
  async append(message: ChannelMessage): Promise<void> {
    appendMessage(message);
  }

  /**
   * Fetch recent messages from the in-memory buffers.
   *
   * Details: returns messages ordered from oldest to newest.
   *
   * Side effects: prunes expired messages from memory.
   * Error behavior: none.
   *
   * @param params - Channel selector and retrieval limits.
   * @returns Recent messages in chronological order.
   */
  async fetchRecent(params: {
    guildId: string | null;
    channelId: string;
    limit: number;
    sinceMs?: number;
  }): Promise<ChannelMessage[]> {
    return getRecentMessages(params);
  }

  /**
   * Delete messages older than the cutoff timestamp.
   *
   * Details: applies retention to in-memory buffers.
   *
   * Side effects: mutates in-memory buffers.
   * Error behavior: none.
   *
   * @param cutoffMs - Unix epoch cutoff in milliseconds.
   * @returns Count of deleted messages.
   */
  async deleteOlderThan(cutoffMs: number): Promise<number> {
    return deleteOlderThan(cutoffMs);
  }
}

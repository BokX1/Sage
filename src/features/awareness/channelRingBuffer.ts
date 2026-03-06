import { config } from '../../platform/config/env';
import { ChannelMessage } from './awareness-types';

type ChannelKey = string;

const channelBuffers = new Map<ChannelKey, ChannelMessage[]>();

function makeChannelKey(guildId: string | null, channelId: string): ChannelKey {
  return `${guildId ?? 'dm'}:${channelId}`;
}

function pruneByTtl(messages: ChannelMessage[], cutoffMs: number): number {
  let firstRetainedIndex = 0;
  while (
    firstRetainedIndex < messages.length &&
    messages[firstRetainedIndex].timestamp.getTime() < cutoffMs
  ) {
    firstRetainedIndex += 1;
  }
  if (firstRetainedIndex > 0) {
    messages.splice(0, firstRetainedIndex);
  }
  return firstRetainedIndex;
}

function enforceMax(messages: ChannelMessage[], maxMessages: number): number {
  const normalizedMax = Number.isFinite(maxMessages) ? Math.max(0, Math.floor(maxMessages)) : 0;
  const removed = messages.length - normalizedMax;
  if (removed <= 0) return 0;
  messages.splice(0, removed);
  return removed;
}

/**
 * Append a message to the in-memory channel buffer.
 *
 * Details: enforces the configured TTL and per-channel message cap after
 * insertion.
 *
 * Side effects: mutates the in-memory ring buffer.
 * Error behavior: none.
 *
 * @param message - Message to add to the buffer.
 */
export function appendMessage(message: ChannelMessage): void {
  const key = makeChannelKey(message.guildId, message.channelId);
  const buffer = channelBuffers.get(key) ?? [];
  // Buffers are expected to receive messages in chronological order so TTL pruning can
  // discard from the front.
  buffer.push(message);

  const cutoffMs = Date.now() - config.RAW_MESSAGE_TTL_DAYS * 24 * 60 * 60 * 1000;
  pruneByTtl(buffer, cutoffMs);
  enforceMax(buffer, config.RING_BUFFER_MAX_MESSAGES_PER_CHANNEL);

  // Clean up empty buffers to prevent memory leak
  if (buffer.length === 0) {
    channelBuffers.delete(key);
  } else {
    channelBuffers.set(key, buffer);
  }
}

/**
 * Fetch recent messages from the in-memory channel buffer.
 *
 * Details: applies TTL pruning and returns messages in chronological order.
 *
 * Side effects: mutates the in-memory buffer when pruning expired entries.
 * Error behavior: none.
 *
 * @param params - Channel selector and retrieval limits.
 * @returns Messages ordered from oldest to newest.
 */
export function getRecentMessages(params: {
  guildId: string | null;
  channelId: string;
  limit: number;
  sinceMs?: number;
}): ChannelMessage[] {
  const { guildId, channelId, limit, sinceMs } = params;
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (normalizedLimit === 0) return [];

  const key = makeChannelKey(guildId, channelId);
  const buffer = channelBuffers.get(key) ?? [];

  const cutoffMs = Date.now() - config.RAW_MESSAGE_TTL_DAYS * 24 * 60 * 60 * 1000;
  pruneByTtl(buffer, cutoffMs);
  if (buffer.length === 0) {
    channelBuffers.delete(key);
    return [];
  }

  const hasSinceMs = Number.isFinite(sinceMs);
  const minimumTimestampMs = hasSinceMs ? Math.floor(sinceMs as number) : null;
  const filtered = hasSinceMs
    ? buffer.filter((message) => message.timestamp.getTime() >= (minimumTimestampMs as number))
    : buffer;

  if (filtered.length <= normalizedLimit) {
    return [...filtered];
  }

  return filtered.slice(filtered.length - normalizedLimit);
}

/**
 * Remove all buffered messages for a channel.
 *
 * Details: deletes the in-memory buffer entry for the channel key.
 *
 * Side effects: mutates the in-memory ring buffer.
 * Error behavior: none.
 *
 * @param params - Channel selector to clear.
 */
export function clearChannel(params: { guildId: string | null; channelId: string }): void {
  const key = makeChannelKey(params.guildId, params.channelId);
  channelBuffers.delete(key);
}

/**
 * Trim a channel buffer to the provided size.
 *
 * Details: removes the oldest messages when the buffer exceeds the limit.
 *
 * Side effects: mutates the in-memory ring buffer.
 * Error behavior: none.
 *
 * @param params - Channel selector and maximum buffer size.
 * @returns Number of messages removed.
 */
export function trimChannelMessages(params: {
  guildId: string | null;
  channelId: string;
  maxMessages: number;
}): number {
  const key = makeChannelKey(params.guildId, params.channelId);
  const buffer = channelBuffers.get(key);
  if (!buffer) {
    return 0;
  }

  const removed = enforceMax(buffer, params.maxMessages);
  if (buffer.length === 0) {
    channelBuffers.delete(key);
  } else {
    channelBuffers.set(key, buffer);
  }
  return removed;
}

/**
 * Delete buffered messages older than the cutoff timestamp.
 *
 * Details: removes expired messages across all channel buffers.
 *
 * Side effects: mutates the in-memory ring buffer.
 * Error behavior: none.
 *
 * @param cutoffMs - Unix epoch cutoff in milliseconds.
 * @returns Number of messages removed.
 */
export function deleteOlderThan(cutoffMs: number): number {
  let deleted = 0;
  for (const [key, buffer] of channelBuffers.entries()) {
    deleted += pruneByTtl(buffer, cutoffMs);
    if (buffer.length === 0) {
      channelBuffers.delete(key);
    }
  }
  return deleted;
}

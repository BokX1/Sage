import { config } from '../../config';
import { ChannelMessage } from './types';

type ChannelKey = string;

const channelBuffers = new Map<ChannelKey, ChannelMessage[]>();

function makeChannelKey(guildId: string | null, channelId: string): ChannelKey {
  return `${guildId ?? 'dm'}:${channelId}`;
}

function pruneByTtl(messages: ChannelMessage[], cutoffMs: number): number {
  let removed = 0;
  while (messages.length > 0 && messages[0].timestamp.getTime() < cutoffMs) {
    messages.shift();
    removed += 1;
  }
  return removed;
}

function enforceMax(messages: ChannelMessage[], maxMessages: number): number {
  let removed = 0;
  while (messages.length > maxMessages) {
    messages.shift();
    removed += 1;
  }
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

  channelBuffers.set(key, buffer);
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
  const key = makeChannelKey(guildId, channelId);
  const buffer = channelBuffers.get(key) ?? [];

  const cutoffMs = Date.now() - config.RAW_MESSAGE_TTL_DAYS * 24 * 60 * 60 * 1000;
  pruneByTtl(buffer, cutoffMs);

  const filtered = sinceMs
    ? buffer.filter((message) => message.timestamp.getTime() >= sinceMs)
    : buffer;

  if (filtered.length <= limit) {
    return [...filtered];
  }

  return filtered.slice(filtered.length - limit);
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
    } else {
      channelBuffers.set(key, buffer);
    }
  }
  return deleted;
}

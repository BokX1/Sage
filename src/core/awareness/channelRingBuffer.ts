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

export function appendMessage(message: ChannelMessage): void {
    const key = makeChannelKey(message.guildId, message.channelId);
    const buffer = channelBuffers.get(key) ?? [];
    buffer.push(message);

    const cutoffMs = Date.now() - config.RAW_MESSAGE_TTL_DAYS * 24 * 60 * 60 * 1000;
    pruneByTtl(buffer, cutoffMs);
    enforceMax(buffer, config.RING_BUFFER_MAX_MESSAGES_PER_CHANNEL);

    channelBuffers.set(key, buffer);
}

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

export function clearChannel(params: { guildId: string | null; channelId: string }): void {
    const key = makeChannelKey(params.guildId, params.channelId);
    channelBuffers.delete(key);
}

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

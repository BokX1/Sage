import { logger } from '../../utils/logger';
import { config } from '../../config';
import { appendMessage } from '../awareness/channelRingBuffer';
import { PrismaMessageStore } from '../awareness/prismaMessageStore';
import { ChannelMessage } from '../awareness/types';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { getChannelSummaryScheduler } from '../summary/channelSummaryScheduler';

/**
 * Message event captured from Discord.
 */
export interface MessageEvent {
    type: 'message';
    guildId: string | null;
    channelId: string;
    messageId: string;
    authorId: string;
    authorDisplayName: string;
    content: string;
    timestamp: Date;
    replyToMessageId?: string;
    mentionsBot?: boolean;
    mentionsUserIds: string[];
}

/**
 * Voice state event captured from Discord.
 */
export interface VoiceEvent {
    type: 'voice';
    guildId: string | null;
    channelId: string;
    userId: string;
    action: 'join' | 'leave' | 'move';
    timestamp: Date;
}

/**
 * Union of all event types that can be ingested.
 */
export type Event = MessageEvent | VoiceEvent;

const prismaMessageStore = new PrismaMessageStore();

/**
 * Ingest an event from Discord.
 *
 * This is the central entrypoint for all event logging.
 * Called BEFORE reply gating to ensure all events are captured.
 *
 * CRITICAL: This function must NEVER throw.
 * Any errors must be caught and logged as non-fatal.
 *
 * Flow:
 * 1. Check if logging is enabled for this guild/channel
 * 2. Log the event
 * 3. TODO (D2): Store in transcript ledger
 */
export async function ingestEvent(event: Event): Promise<void> {
    try {
        // Skip if no guildId (DMs) or logging disabled
        if (event.guildId && !isLoggingEnabled(event.guildId, event.channelId)) {
            return;
        }

        // Log event for debugging
        logger.debug({ event }, 'Event ingested');

        if (event.type === 'message') {
            const message: ChannelMessage = {
                messageId: event.messageId,
                guildId: event.guildId,
                channelId: event.channelId,
                authorId: event.authorId,
                authorDisplayName: event.authorDisplayName,
                timestamp: event.timestamp,
                content: event.content,
                replyToMessageId: event.replyToMessageId,
                mentionsUserIds: event.mentionsUserIds,
                mentionsBot: event.mentionsBot ?? false,
            };

            appendMessage(message);

            if (config.MESSAGE_DB_STORAGE_ENABLED) {
                await prismaMessageStore.append(message);
            }

            // Update relationship graph (D7)
            // Best-effort: don't throw if this fails
            if (message.guildId) {
                try {
                    const { updateFromMessage } = await import('../relationships/relationshipGraph');
                    await updateFromMessage({
                        guildId: message.guildId,
                        authorId: message.authorId,
                        mentionedUserIds: message.mentionsUserIds,
                        replyToAuthorId: null, // TODO: resolve from replyToMessageId if needed
                        now: message.timestamp,
                    });
                } catch (err) {
                    logger.warn({ error: err, messageId: message.messageId }, 'Relationship graph update failed (non-fatal)');
                }
            }

            const scheduler = getChannelSummaryScheduler();
            if (scheduler) {
                scheduler.markDirty({
                    guildId: message.guildId,
                    channelId: message.channelId,
                    lastMessageAt: message.timestamp,
                    messageCountIncrement: 1,
                });
            }
        }
    } catch (err) {
        // CRITICAL: Never let ingestion errors break the handler
        logger.error({ error: err, event }, 'Event ingestion failed (non-fatal)');
    }
}

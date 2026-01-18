import { logger } from '../../utils/logger';
import { isLoggingEnabled } from '../settings/guildChannelSettings';

/**
 * Message event captured from Discord.
 */
export interface MessageEvent {
    type: 'message';
    guildId: string | null;
    channelId: string;
    messageId: string;
    authorId: string;
    content: string;
    timestamp: Date;
    replyToMessageId?: string;
    mentionsBot?: boolean;
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

        // TODO (D2): Store in persistent transcript ledger
        // await transcriptRepo.insertEvent(event);
    } catch (err) {
        // CRITICAL: Never let ingestion errors break the handler
        logger.error({ error: err, event }, 'Event ingestion failed (non-fatal)');
    }
}

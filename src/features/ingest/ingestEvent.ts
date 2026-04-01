import { logger } from '../../platform/logging/logger';
import { config } from '../../platform/config/env';
import { appendMessage } from '../awareness/channelRingBuffer';
import { PrismaMessageStore } from '../awareness/prismaMessageStore';
import { ChannelMessage } from '../awareness/awareness-types';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { getChannelSummaryScheduler } from '../summary/channelSummaryScheduler';
import { queueChannelMessageEmbedding } from '../embeddings';
import { normalizePositiveInt } from '../../shared/utils/numbers';

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
  authorIsBot?: boolean;
  content: string;
  timestamp: Date;
  replyToMessageId?: string;
  replyToAuthorId?: string | null;
  mentionsBot?: boolean;
  mentionsUserIds: string[];
}

export type Event = MessageEvent;

const prismaMessageStore = new PrismaMessageStore();

/** Resolve persisted message retention cap with transcript-limit fallback. */
function resolveDbRetentionLimit(): number {
  const fallbackLimit = normalizePositiveInt(config.CONTEXT_TRANSCRIPT_MAX_MESSAGES, 1);
  return normalizePositiveInt(config.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL as number | undefined, fallbackLimit);
}

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
 * 3. Store in transcript ledger (Future)
 */
export async function ingestEvent(event: Event): Promise<void> {
  try {
    // Skip if no guildId (DMs) or logging disabled
    if (!event.guildId || !isLoggingEnabled(event.guildId, event.channelId)) {
      return;
    }

    // Log event for debugging
    logger.debug({ event }, 'Event ingested');

    if (event.type === 'message') {
      const isBotMessage = event.authorIsBot === true;
      const message: ChannelMessage = {
        messageId: event.messageId,
        guildId: event.guildId,
        channelId: event.channelId,
        authorId: event.authorId,
        authorDisplayName: event.authorDisplayName,
        authorIsBot: isBotMessage,
        timestamp: event.timestamp,
        content: event.content,
        replyToMessageId: event.replyToMessageId,
        mentionsUserIds: event.mentionsUserIds,
        mentionsBot: event.mentionsBot ?? false,
      };

      // Keep live awareness faithful to the room, including external bot activity,
      // while invocation and downstream side effects remain human-gated elsewhere.
      appendMessage(message);

      if (config.MESSAGE_DB_STORAGE_ENABLED) {
        const dbRetentionLimit = resolveDbRetentionLimit();
        await prismaMessageStore.append(message);
        queueChannelMessageEmbedding({
          messageId: message.messageId,
          guildId: message.guildId,
          channelId: message.channelId,
          content: message.content,
        });
        await prismaMessageStore.pruneChannelToLimit({
          guildId: message.guildId,
          channelId: message.channelId,
          limit: dbRetentionLimit,
        });
      }

      const scheduler = getChannelSummaryScheduler();
      if (scheduler) {
        scheduler.markDirty({
          guildId: message.guildId,
          channelId: message.channelId,
          lastMessageAt: message.timestamp,
          messageCountIncrement: 1,
          humanMessageCountIncrement: isBotMessage ? 0 : 1,
        });
      }
    }
  } catch (err) {
    // CRITICAL: Never let ingestion errors break the handler
    logger.error({ error: err, event }, 'Event ingestion failed (non-fatal)');
  }
}

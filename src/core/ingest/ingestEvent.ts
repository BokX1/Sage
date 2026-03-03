import { logger } from '../../core/utils/logger';
import { config } from '../../config';
import { appendMessage } from '../awareness/channelRingBuffer';
import { PrismaMessageStore } from '../awareness/prismaMessageStore';
import { ChannelMessage } from '../awareness/awareness-types';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { getChannelSummaryScheduler } from '../summary/channelSummaryScheduler';
import { publishInteraction } from '../../social-graph/kafkaProducer';
import { queueChannelMessageEmbedding } from '../embeddings';

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

/**
 * Voice state event captured from Discord.
 */
export interface VoiceEvent {
  type: 'voice';
  guildId: string | null;
  channelId: string;
  channelName: string;
  userId: string;
  userDisplayName: string;
  action: 'join' | 'leave' | 'move';
  timestamp: Date;
}

/**
 * Union of all event types that can be ingested.
 */
export type Event = MessageEvent | VoiceEvent;

const prismaMessageStore = new PrismaMessageStore();

/** Normalize numeric limits to a positive integer with a safe fallback. */
function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value as number));
}

/** Resolve persisted message retention cap with transcript-limit fallback. */
function resolveDbRetentionLimit(): number {
  const fallbackLimit = toPositiveInt(config.CONTEXT_TRANSCRIPT_MAX_MESSAGES, 1);
  return toPositiveInt(config.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL as number | undefined, fallbackLimit);
}

export interface IngestEventOptions {
  publishSocialGraph?: boolean;
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
export async function ingestEvent(event: Event, options: IngestEventOptions = {}): Promise<void> {
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

      // Keep ring-buffer awareness focused on human chat turns.
      if (!isBotMessage) {
        appendMessage(message);
      }

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

      // Publish social interactions to Kafka/Memgraph (best-effort).
      // Respect existing logging gates by publishing only from within ingestEvent
      // after isLoggingEnabled checks have passed.
      if (options.publishSocialGraph !== false && !isBotMessage) {
        const interactionTimestamp = message.timestamp.toISOString();
        const guildId = event.guildId;
        for (const mentionedUserId of message.mentionsUserIds) {
          if (!mentionedUserId) continue;
          if (mentionedUserId === message.authorId) continue;

          void publishInteraction({
            type: 'MENTION',
            guildId,
            sourceUserId: message.authorId,
            targetUserId: mentionedUserId,
            channelId: message.channelId,
            timestamp: interactionTimestamp,
          });
        }

        if (event.replyToAuthorId && event.replyToAuthorId !== message.authorId) {
          void publishInteraction({
            type: 'REPLY',
            guildId,
            sourceUserId: message.authorId,
            targetUserId: event.replyToAuthorId,
            channelId: message.channelId,
            timestamp: interactionTimestamp,
          });
        }
      }

      if (!isBotMessage) {
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
    } else if (event.type === 'voice') {
      // SYNTHETIC SYSTEM MESSAGE FOR TRANSCRIPT
      // This allows the LLM to "see" voice activity in the short-term context.
      const content = `[Voice] ${event.userDisplayName} ${event.action} voice channel "${event.channelName}"`;

      const syntheticMessage: ChannelMessage = {
        messageId: `voice-${event.timestamp.getTime()}-${event.userId}`,
        guildId: event.guildId,
        // Keep voice activity scoped to the originating voice channel transcript.
        channelId: event.channelId,
        authorId: 'SYSTEM',
        authorDisplayName: 'System',
        authorIsBot: false,
        timestamp: event.timestamp,
        content,
        mentionsUserIds: [event.userId],
        mentionsBot: false,
      };

      appendMessage(syntheticMessage);

      // Keep synthetic voice activity ephemeral in memory; only user-authored messages are persisted.
    }
  } catch (err) {
    // CRITICAL: Never let ingestion errors break the handler
    logger.error({ error: err, event }, 'Event ingestion failed (non-fatal)');
  }
}

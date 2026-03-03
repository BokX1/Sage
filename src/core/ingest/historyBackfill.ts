/**
 * @module src/core/ingest/historyBackfill
 * @description Defines the history backfill module.
 */
import { TextChannel, Message } from 'discord.js';
import { client } from '../../bot/client';
import { logger } from '../utils/logger';
import { ingestEvent } from '../ingest/ingestEvent';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { config as appConfig } from '../../config';
import { PrismaMessageStore } from '../awareness/prismaMessageStore';
import { trimChannelMessages } from '../awareness/channelRingBuffer';

const prismaMessageStore = new PrismaMessageStore();

/** Normalize numeric limits to a positive integer with a safe fallback. */
function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value as number));
}

/** Resolve persisted message retention cap from config with startup-limit fallback. */
function resolveDbRetentionLimit(fallbackLimit: number): number {
  const normalizedFallback = toPositiveInt(fallbackLimit, 1);
  return toPositiveInt(appConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL as number | undefined, normalizedFallback);
}

/**
 * Backfill historical messages for a channel.
 * This is useful on startup or when joining a new channel to establish context immediately.
 */
export async function backfillChannelHistory(
  channelId: string,
  limit = appConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      return;
    }

    if (!isLoggingEnabled(channel.guildId, channel.id)) {
      return;
    }

    logger.info({ channelId, guildId: channel.guildId }, 'Starting history backfill');

    const messages = await channel.messages.fetch({ limit });

    // Process in chronological order (oldest to newest)
    const sorted = Array.from(messages.values()).sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp,
    );

    for (const message of sorted) {
      await processBackfillMessage(message);
    }

    const trimmedInMemory = trimChannelMessages({
      guildId: channel.guildId,
      channelId: channel.id,
      maxMessages: limit,
    });
    if (trimmedInMemory > 0) {
      logger.info(
        { channelId, removed: trimmedInMemory, limit },
        'Trimmed in-memory transcript after backfill',
      );
    }

    if (appConfig.MESSAGE_DB_STORAGE_ENABLED) {
      const dbRetentionLimit = resolveDbRetentionLimit(limit);
      const prunedDb = await prismaMessageStore.pruneChannelToLimit({
        guildId: channel.guildId,
        channelId: channel.id,
        limit: dbRetentionLimit,
      });
      if (prunedDb > 0) {
        logger.info(
          { channelId, removed: prunedDb, limit: dbRetentionLimit },
          'Pruned stored transcript history after backfill',
        );
      }
    }

    logger.info({ channelId, count: sorted.length }, 'History backfill complete');
  } catch (error) {
    logger.error({ error, channelId }, 'Failed to backfill channel history');
  }
}

async function processBackfillMessage(message: Message): Promise<void> {
  const mentionsUserIds = Array.from(message.mentions.users?.keys?.() ?? []).filter(
    (id) => id !== client.user?.id,
  );
  const authorDisplayName =
    message.member?.displayName ?? message.author.username ?? message.author.id;
  const isMentioned = !!(client.user && message.mentions.has(client.user));

  await ingestEvent({
    type: 'message',
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    authorDisplayName,
    authorIsBot: message.author.bot,
    content: message.content,
    timestamp: message.createdAt,
    replyToMessageId: message.reference?.messageId,
    mentionsBot: isMentioned,
    mentionsUserIds,
  }, { publishSocialGraph: false });
}

import { TextChannel, Message } from 'discord.js';
import { client } from '../../platform/discord/client';
import { logger } from '../../platform/logging/logger';
import { ingestEvent } from '../../features/ingest/ingestEvent';
import { isLoggingEnabled } from '../../features/settings/guildChannelSettings';
import { config as appConfig } from '../../platform/config/env';
import { PrismaMessageStore } from '../../features/awareness/prismaMessageStore';
import { trimChannelMessages } from '../../features/awareness/channelRingBuffer';
import { normalizePositiveInt } from '../../shared/utils/numbers';
import { extractVisibleMessageText } from './handlers/attachment-parser';

const prismaMessageStore = new PrismaMessageStore();

/** Resolve persisted message retention cap from config with startup-limit fallback. */
function resolveDbRetentionLimit(fallbackLimit: number): number {
  const normalizedFallback = normalizePositiveInt(fallbackLimit, 1);
  return normalizePositiveInt(appConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL as number | undefined, normalizedFallback);
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
    content: extractVisibleMessageText(message, { allowEmpty: true }) ?? '',
    timestamp: message.createdAt,
    replyToMessageId: message.reference?.messageId,
    mentionsBot: isMentioned,
    mentionsUserIds,
  }, { publishSocialGraph: false });
}

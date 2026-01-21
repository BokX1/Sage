import { TextChannel, Message } from 'discord.js';
import { client } from '../../bot/client';
import { logger } from '../utils/logger';
import { ingestEvent } from '../ingest/ingestEvent';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { config as appConfig } from '../../config';

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

    logger.info({ channelId, count: sorted.length }, 'History backfill complete');
  } catch (error) {
    logger.error({ error, channelId }, 'Failed to backfill channel history');
  }
}

async function processBackfillMessage(message: Message): Promise<void> {
  if (message.author.bot) return;

  const mentionsUserIds = Array.from(message.mentions.users?.keys?.() ?? []);
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
    content: message.content,
    timestamp: message.createdAt,
    replyToMessageId: message.reference?.messageId,
    mentionsBot: isMentioned,
    mentionsUserIds,
  });
}

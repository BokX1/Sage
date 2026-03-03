/**
 * @module src/bot/handlers/messageReactionAdd
 * @description Defines the message reaction add module.
 */
import { Events, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { client } from '../client';
import { logger } from '../../core/utils/logger';
import { isLoggingEnabled } from '../../core/settings/guildChannelSettings';
import { publishInteraction } from '../../social-graph/kafkaProducer';
import { getEmojiSentiment } from '../../social-graph/emojiSentiment';

const registrationKey = Symbol.for('sage.handlers.messageReactionAdd.registered');

/**
 * Runs handleMessageReactionAdd.
 *
 * @param reaction - Describes the reaction input.
 * @param user - Describes the user input.
 * @returns Returns the function result.
 */
export async function handleMessageReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  try {
    let resolvedUser: User | PartialUser = user;
    if (resolvedUser.partial) {
      try {
        resolvedUser = await resolvedUser.fetch();
      } catch (error) {
        logger.debug({ error }, 'Reaction user fetch failed; skipping');
        return;
      }
    }

    if ('bot' in resolvedUser && resolvedUser.bot) return;

    let resolvedReaction = reaction;
    if (resolvedReaction.partial) {
      try {
        resolvedReaction = await resolvedReaction.fetch();
      } catch (error) {
        logger.debug({ error }, 'Reaction fetch failed; skipping');
        return;
      }
    }

    let message = resolvedReaction.message;
    if (message.partial) {
      try {
        message = await message.fetch();
      } catch (error) {
        logger.debug({ error }, 'Reaction message fetch failed; skipping');
        return;
      }
    }

    const guildId = message.guildId ?? null;
    if (!guildId) return;

    const channelId = message.channelId;
    if (!isLoggingEnabled(guildId, channelId)) return;

    const targetAuthor = message.author;
    if (!targetAuthor || targetAuthor.bot) return;
    if (targetAuthor.id === resolvedUser.id) return;

    // Score the emoji for sentiment analysis
    const emojiKey = resolvedReaction.emoji.name ?? resolvedReaction.emoji.toString();
    const sentimentScore = getEmojiSentiment(emojiKey);

    await publishInteraction({
      type: 'REACT',
      guildId,
      sourceUserId: resolvedUser.id,
      targetUserId: targetAuthor.id,
      channelId,
      timestamp: new Date().toISOString(),
      sentimentScore,
    });
  } catch (error) {
    logger.warn({ error }, 'MessageReactionAdd handler failed (non-fatal)');
  }
}

/**
 * Runs registerMessageReactionAddHandler.
 *
 * @returns Returns the function result.
 */
export function registerMessageReactionAddHandler(): void {
  const g = globalThis as unknown as { [key: symbol]: boolean };
  if (g[registrationKey]) return;
  g[registrationKey] = true;

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void handleMessageReactionAdd(reaction, user).catch((error) => {
      logger.warn({ error }, 'MessageReactionAdd handler rejected (non-fatal)');
    });
  });

  logger.info(
    { count: client.listenerCount(Events.MessageReactionAdd) },
    'MessageReactionAdd handler registered',
  );
}

import { Events, Message, type PartialMessage } from 'discord.js';
import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import { ingestEvent } from '../../../features/ingest/ingestEvent';
import { isLoggingEnabled } from '../../../features/settings/guildChannelSettings';
import { extractVisibleMessageText } from './attachment-parser';

const registrationKey = Symbol.for('sage.handlers.messageUpdate.registered');

type GlobalScope = typeof globalThis & {
  [registrationKey]?: boolean;
};

async function resolveUpdatedMessage(message: Message | PartialMessage): Promise<Message | null> {
  if (!message.partial) {
    return message as Message;
  }

  try {
    return await message.fetch();
  } catch (error) {
    logger.debug(
      {
        msgId: message.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Edited message fetch failed',
    );
    return null;
  }
}

function getMentionedUserIds(message: Message): string[] {
  const botUserId = client.user?.id;
  return Array.from(message.mentions.users?.keys?.() ?? []).filter((id) => id !== botUserId);
}

export async function handleMessageUpdate(
  _oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> {
  try {
    const message = await resolveUpdatedMessage(newMessage);
    if (!message || !message.guildId || !message.author?.bot) {
      return;
    }

    if (!isLoggingEnabled(message.guildId, message.channelId)) {
      return;
    }

    const authorDisplayName =
      message.member?.displayName ?? message.author.username ?? message.author.id;
    const mentionedUserIds = getMentionedUserIds(message);
    const isMentioned = !!(client.user && message.mentions.has(client.user));

    await ingestEvent(
      {
        type: 'message',
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        authorId: message.author.id,
        authorDisplayName,
        authorIsBot: true,
        content: extractVisibleMessageText(message, { allowEmpty: true }) ?? '',
        timestamp: message.createdAt,
        replyToMessageId: message.reference?.messageId,
        mentionsBot: isMentioned,
        mentionsUserIds: mentionedUserIds,
      },
      { publishSocialGraph: false },
    );
  } catch (err) {
    logger.error({ err, msgId: newMessage.id }, 'MessageUpdate handler failed');
  }
}

export function __resetMessageUpdateHandlerStateForTests(): void {
  delete (globalThis as GlobalScope)[registrationKey];
}

export function registerMessageUpdateHandler(): void {
  const globalScope = globalThis as GlobalScope;
  if (globalScope[registrationKey]) {
    logger.warn('MessageUpdate handler ALREADY registered (Skip)');
    return;
  }
  globalScope[registrationKey] = true;

  client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
    void handleMessageUpdate(oldMessage, newMessage).catch((err) => {
      logger.error({ err, msgId: newMessage.id }, 'MessageUpdate handler rejected');
    });
  });

  logger.info(
    { count: client.listenerCount(Events.MessageUpdate) },
    'MessageUpdate handler registered',
  );
}

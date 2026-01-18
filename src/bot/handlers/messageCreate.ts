import { Message, Events, TextChannel } from 'discord.js';
import { client } from '../client';
import { logger } from '../../utils/logger';
import { generateTraceId } from '../../utils/trace';
import { isRateLimited, isSeriousMode } from '../../core/safety';
import { generateChatReply } from '../../core/chat/chatEngine';
import { ingestEvent } from '../../core/ingest/ingestEvent';
import { config as appConfig } from '../../config';
import { detectInvocation } from '../../core/invoke/wakeWord';
import { shouldAllowInvocation } from '../../core/invoke/cooldown';

const processedMessagesKey = Symbol.for('sage.handlers.messageCreate.processed');
const registrationKey = Symbol.for('sage.handlers.messageCreate.registered');

// Access global scope safely
const globalScope = globalThis as any;

// Initialize or retrieve the global deduplication map
const processedMessages: Map<string, number> = (globalScope[processedMessagesKey] ??= new Map());
const DEDUP_TTL = 60_000;

export async function handleMessageCreate(message: Message) {
  if (message.author.bot) return;

  // Deduplicate messages (prevent double processing)
  const now = Date.now();
  if (processedMessages.has(message.id)) {
    logger.debug({ msgId: message.id }, 'Ignoring duplicate message event');
    return;
  }
  processedMessages.set(message.id, now);

  // Periodic cleanup (simple)
  if (processedMessages.size > 100) {
    for (const [id, timestamp] of processedMessages) {
      if (now - timestamp > DEDUP_TTL) processedMessages.delete(id);
    }
  }

  const isMentioned = !!(client.user && message.mentions.has(client.user));
  const mentionsUserIds = Array.from(message.mentions.users?.keys?.() ?? []);
  const mentionedUserIdsForQueries = mentionsUserIds.filter((id) => id !== client.user?.id);
  const authorDisplayName = message.member?.displayName ?? message.author.username ?? message.author.id;

  let isReplyToBot = false;
  if (message.reference) {
    try {
      const refMessage = await message.fetchReference();
      isReplyToBot = refMessage.author.id === client.user?.id;
    } catch {
      // Message might be deleted
    }
  }

  // ================================================================
  // D1: Ingest event BEFORE reply gating
  // ================================================================
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

  // Mention-first: only respond to mentions or replies
  const wakeWords = appConfig.WAKE_WORDS.split(',').map((word) => word.trim()).filter(Boolean);
  const wakeWordPrefixes = appConfig.WAKE_WORD_PREFIXES.split(',')
    .map((prefix) => prefix.trim())
    .filter(Boolean);

  const invocation = detectInvocation({
    rawContent: message.content,
    isMentioned,
    isReplyToBot,
    botUserId: client.user?.id,
    wakeWords,
    prefixes: wakeWordPrefixes,
  });

  if (!invocation) return;

  if (
    !shouldAllowInvocation({
      channelId: message.channelId,
      userId: message.author.id,
      kind: invocation.kind,
    })
  ) {
    return;
  }

  const traceId = generateTraceId();
  const loggerWithTrace = logger.child({ traceId });

  // Rate limit gate
  if (isRateLimited(message.channelId)) {
    loggerWithTrace.warn('Rate limit hit');
    return;
  }

  // Serious mode gate
  if (isSeriousMode()) {
    loggerWithTrace.info('Serious mode: ignoring message');
    return;
  }

  try {
    loggerWithTrace.info({ msg: 'Message received', text: invocation.cleanedText });

    // Generate Chat Reply
    const result = await generateChatReply({
      traceId,
      userId: message.author.id,
      channelId: message.channelId,
      guildId: message.guildId,
      messageId: message.id,
      userText: invocation.cleanedText,
      replyToBotText:
        invocation.kind === 'reply' && message.reference
          ? (await message.fetchReference()).content
          : null,
      intent: invocation.intent,
      mentionedUserIds: mentionedUserIdsForQueries,
    });

    // Send messages to Discord
    const channel = message.channel as TextChannel;
    if (result.replyText) {
      // Simple split if too long (Discord limit 2000), but prompt says "treat as one reply"
      // We'll let Discord.js handle split if we pass dispatch or just helper.
      // But simple send works for < 2000.
      // If > 2000, we might need to chunk.
      // ChatEngine returned a single string.

      if (result.replyText.length > 2000) {
        // simple chunking
        const chunks = result.replyText.match(/.{1,2000}/g) || [];
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      } else {
        await channel.send(result.replyText);
      }
    }

    loggerWithTrace.info('Response sent');
  } catch (err) {
    loggerWithTrace.error(err, 'Error handling message');

    // Send error message to user
    try {
      const errorChannel = message.channel as TextChannel;
      await errorChannel.send('Sorry, something went wrong processing your request.');
    } catch {
      // Ignore send errors
    }
  }
}

export function registerMessageCreateHandler() {
  const g = globalThis as any;
  if (g[registrationKey]) {
    return;
  }
  g[registrationKey] = true;

  client.on(Events.MessageCreate, handleMessageCreate);
  logger.info(
    { count: client.listenerCount(Events.MessageCreate) },
    'MessageCreate handler registered',
  );
}

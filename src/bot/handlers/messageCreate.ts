import { Message, Events, TextChannel } from 'discord.js';
import { client } from '../client';
import { logger } from '../../utils/logger';
import { generateTraceId } from '../../utils/trace';
import { isRateLimited } from '../../core/safety';
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
  // Debug log for every message
  logger.debug({ msgId: message.id, author: message.author.username }, 'Processing message event');

  if (processedMessages.has(message.id)) {
    logger.debug({ msgId: message.id }, 'Ignoring duplicate message event (Dedupe hit)');
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
  const authorDisplayName =
    message.member?.displayName ?? message.author.username ?? message.author.id;

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
  const wakeWords = appConfig.WAKE_WORDS.split(',')
    .map((word) => word.trim())
    .filter(Boolean);
  const wakeWordPrefixes = appConfig.WAKE_WORD_PREFIXES.split(',')
    .map((prefix) => prefix.trim())
    .filter(Boolean);

  let invocation = detectInvocation({
    rawContent: message.content,
    isMentioned,
    isReplyToBot,
    botUserId: client.user?.id,
    wakeWords,
    prefixes: wakeWordPrefixes,
  });

  if (
    invocation &&
    !shouldAllowInvocation({
      channelId: message.channelId,
      userId: message.author.id,
      kind: invocation.kind,
    })
  ) {
    return;
  }

  // Autopilot Gateway
  // If not explicitly invoked, check if we should engage via Autopilot
  if (!invocation) {
    if (appConfig.AUTOPILOT_MODE === 'reserved' || appConfig.AUTOPILOT_MODE === 'talkative') {
      // Create a virtual invocation for autopilot
      invocation = {
        kind: 'autopilot',
        cleanedText: message.content,
        intent: 'autopilot',
      };
    } else {
      // No manual invocation AND no autopilot -> Ignore
      return;
    }
  }

  // Double-check: If we have an invocation now (manual or autopilot), print it
  if (invocation) {
    logger.debug({ type: invocation.kind, intent: invocation.intent }, 'Invocation decided');
  }

  const traceId = generateTraceId();
  const loggerWithTrace = logger.child({ traceId });

  // Rate limit gate (apply to everything including autopilot)
  if (isRateLimited(message.channelId)) {
    loggerWithTrace.warn('Rate limit hit');
    return;
  }

  let typingInterval: NodeJS.Timeout | null = null;
  const discordChannel = message.channel as TextChannel;

  try {
    loggerWithTrace.info({ msg: 'Message received', text: invocation.cleanedText });

    // Send typing indicator
    await discordChannel.sendTyping();
    typingInterval = setInterval(() => {
      void discordChannel.sendTyping().catch(() => {
        // Ignore typing errors (e.g., missing perms, channel deleted)
      });
    }, 8000);

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
      invokedBy: invocation.kind,
    });

    // Send messages to Discord
    if (result.replyText) {
      if (result.replyText.length > 2000) {
        // simple chunking
        const chunks = result.replyText.match(/.{1,2000}/g) || [];
        const [firstChunk, ...restChunks] = chunks;
        if (firstChunk) {
          await message.reply({
            content: firstChunk,
            allowedMentions: { repliedUser: false },
          });
        }
        for (const chunk of restChunks) {
          await discordChannel.send(chunk);
        }
      } else {
        await message.reply({
          content: result.replyText,
          allowedMentions: { repliedUser: false },
        });
      }
    }

    loggerWithTrace.info('Response sent');
  } catch (err) {
    loggerWithTrace.error(err, 'Error handling message');

    // Send error message to user
    try {
      await message.reply({
        content: 'Sorry, something went wrong processing your request.',
        allowedMentions: { repliedUser: false },
      });
    } catch {
      // Ignore send errors
    }
  } finally {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

export function registerMessageCreateHandler() {
  const g = globalThis as any;
  if (g[registrationKey]) {
    logger.warn('MessageCreate handler ALREADY registered (Skip)');
    return;
  }
  g[registrationKey] = true;

  client.on(Events.MessageCreate, (msg) => {
    handleMessageCreate(msg);
  });
  logger.info(
    { count: client.listenerCount(Events.MessageCreate) },
    'MessageCreate handler registered',
  );
}

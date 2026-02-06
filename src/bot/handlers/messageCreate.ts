import { Message, Events, TextChannel } from 'discord.js';
import { client } from '../client';
import { logger } from '../../core/utils/logger';
import { generateTraceId } from '../../core/utils/trace-id-generator';
import { isRateLimited } from '../../core/rate-limiter';
import { generateChatReply } from '../../core/chat-engine';
import { ingestEvent } from '../../core/ingest/ingestEvent';
import { config as appConfig } from '../../config';
import { detectInvocation } from '../../core/invocation/wake-word-detector';
import { shouldAllowInvocation } from '../../core/invocation/invocation-rate-limiter';
import { fetchAttachmentText, type FetchAttachmentResult } from '../../core/utils/file-handler';
import { smartSplit } from '../../core/utils/message-splitter';
import { VoiceManager } from '../../core/voice/voiceManager';
import {
  appendAttachmentToText,
  buildAttachmentBlockFromResult,
  buildMessageContent,
  deriveAttachmentLimits,
  getNonImageAttachment,
  isImageAttachment,
} from './attachment-parser';

const processedMessagesKey = Symbol.for('sage.handlers.messageCreate.processed');
const registrationKey = Symbol.for('sage.handlers.messageCreate.registered');

type GlobalScope = typeof globalThis & {
  [processedMessagesKey]?: Map<string, number>;
  [registrationKey]?: boolean;
};

// Access global scope safely
const globalScope = globalThis as GlobalScope;

// Initialize or retrieve the global deduplication map
const processedMessages: Map<string, number> = (globalScope[processedMessagesKey] ??= new Map());
const DEDUP_TTL = 60_000;


export async function handleMessageCreate(message: Message) {
  if (message.author.bot) return;

  let typingInterval: NodeJS.Timeout | null = null;
  try {
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

    let referencedMessage: Message | null = null;
    if (message.reference) {
      const cachedReference =
        'referencedMessage' in message ? (message.referencedMessage as Message | null) : null;
      if (cachedReference && !cachedReference.partial) {
        referencedMessage = cachedReference;
      } else {
        try {
          referencedMessage = await message.fetchReference();
        } catch (error) {
          logger.debug(
            { msgId: message.id, error: error instanceof Error ? error.message : String(error) },
            'Reply reference fetch failed',
          );
        }
      }
    }

    let isReplyToBot = false;
    let replyToBotText: string | null = null;
    if (referencedMessage) {
      isReplyToBot = referencedMessage.author.id === client.user?.id;
      if (isReplyToBot) {
        replyToBotText = referencedMessage.content;
      }
    }

    const replyReferenceContent = referencedMessage
      ? buildMessageContent(referencedMessage, { prefix: '[In reply to]: ' })
      : null;

    const attachment = getNonImageAttachment(message);
    const attachmentName = attachment?.name ?? '';
    const attachmentContentType = attachment?.contentType ?? null;
    const hasImageAttachment = isImageAttachment(attachment);
    let attachmentBlock: string | null = null;

    if (attachment && !hasImageAttachment && attachmentName.trim().length > 0) {
      const { maxChars, maxBytes, headChars, tailChars } = deriveAttachmentLimits({
        baseText: message.content ?? '',
        filename: attachmentName,
        authorDisplayName,
        authorId: message.author.id,
        timestamp: message.createdAt,
      });

      let attachmentResult: FetchAttachmentResult;
      if (maxChars <= 0 || maxBytes <= 0) {
        attachmentResult = {
          kind: 'too_large',
          message: `[System: File '${attachmentName}' omitted due to context limits.]`,
        };
      } else {
        attachmentResult = await fetchAttachmentText(attachment.url ?? '', attachmentName, {
          timeoutMs: 30_000,
          maxBytes,
          maxChars,
          truncateStrategy: 'head_tail',
          headChars,
          tailChars,
        });
      }

      attachmentBlock = buildAttachmentBlockFromResult(
        attachmentName,
        attachmentResult,
        attachmentContentType,
      );
    }

    const ingestContent = appendAttachmentToText(message.content ?? '', attachmentBlock);

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
      content: ingestContent,
      timestamp: message.createdAt,
      replyToMessageId: message.reference?.messageId,
      mentionsBot: isMentioned,
      mentionsUserIds,
    });

    // Mention-first: only respond to mentions or replies
    const wakeWords = appConfig.WAKE_WORDS_CSV.split(',')
      .map((word: string) => word.trim())
      .filter(Boolean);
    const wakeWordPrefixes = appConfig.WAKE_WORD_PREFIXES_CSV.split(',')
      .map((prefix: string) => prefix.trim())
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

    const discordChannel = message.channel as TextChannel;

    try {
      loggerWithTrace.info(
        { msg: 'Message received', textLength: invocation.cleanedText?.length ?? 0 },
      );

      // Send typing indicator
      await discordChannel.sendTyping();
      typingInterval = setInterval(() => {
        void discordChannel.sendTyping().catch(() => {
          // Ignore typing errors (e.g., missing perms, channel deleted)
        });
      }, 8000);

      // Generate Chat Reply
      const userTextWithAttachments = appendAttachmentToText(
        invocation.cleanedText,
        attachmentBlock,
      );
      const userContent = buildMessageContent(message, {
        allowEmpty: true,
        textOverride: userTextWithAttachments,
      });

      // Check for voice overlap (User + Bot in same VC)
      let isVoiceActive = false;
      if (message.guildId && message.member?.voice?.channelId) {
        const voiceManager = VoiceManager.getInstance();
        const connection = voiceManager.getConnection(message.guildId);
        if (connection && connection.joinConfig.channelId === message.member.voice.channelId) {
          isVoiceActive = true;
        }
      }

      const result = await generateChatReply({
        traceId,
        userId: message.author.id,
        channelId: message.channelId,
        guildId: message.guildId,
        messageId: message.id,
        userText: userTextWithAttachments,
        userContent: userContent ?? userTextWithAttachments,
        replyToBotText: invocation.kind === 'reply' ? replyToBotText : null,
        replyReferenceContent,
        intent: invocation.intent,
        mentionedUserIds: mentionedUserIdsForQueries,
        invokedBy: invocation.kind,
        isVoiceActive,
      });

      // --- Voice TTS Trigger ---
      if (result.replyText && isVoiceActive && message.guildId) {
        try {
          const voiceManager = VoiceManager.getInstance();
          loggerWithTrace.info({ guildId: message.guildId, voice: result.voice }, 'Generating TTS (syncing)...');

          // Await speech generation + start of playback BEFORE sending text
          // Pass the dynamically selected voice (e.g. 'onyx', 'nova') from the agent runtime
          await voiceManager.speak(message.guildId, result.replyText, result.styleHint);

          loggerWithTrace.info('TTS started, sending text reply.');
        } catch (voiceErr) {
          loggerWithTrace.error({ voiceErr }, 'Voice TTS failed (sending text anyway)');
        }
      }
      // -------------------------

      // Send messages to Discord
      if (result.replyText || (result.files && result.files.length > 0)) {
        const chunks = smartSplit(result.replyText || '', 2000);
        const [firstChunk, ...restChunks] = chunks;
        if (firstChunk || (result.files && result.files.length > 0)) {
          await message.reply({
            content: firstChunk,
            allowedMentions: { repliedUser: false },
            files: result.files,
          });
        }
        for (const chunk of restChunks) {
          await discordChannel.send(chunk);
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
    }
  } catch (err) {
    logger.error({ err, msgId: message.id }, 'MessageCreate handler failed');
  } finally {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

export function registerMessageCreateHandler() {
  const g = globalThis as GlobalScope;
  if (g[registrationKey]) {
    logger.warn('MessageCreate handler ALREADY registered (Skip)');
    return;
  }
  g[registrationKey] = true;

  client.on(Events.MessageCreate, (msg) => {
    void handleMessageCreate(msg).catch((err) => {
      logger.error({ err, msgId: msg.id }, 'MessageCreate handler rejected');
    });
  });
  logger.info(
    { count: client.listenerCount(Events.MessageCreate) },
    'MessageCreate handler registered',
  );
}

import { Message, Events, TextChannel } from 'discord.js';
import { client } from '../client';
import { logger } from '../../core/utils/logger';
import { generateTraceId } from '../../core/utils/trace-id-generator';
import { isRateLimited } from '../../core/rate-limiter';
import { generateChatReply } from '../../core/chat-engine';
import { ingestEvent } from '../../core/ingest/ingestEvent';
import { config as appConfig } from '../../config';
import { isLoggingEnabled } from '../../core/settings/guildChannelSettings';
import { detectInvocation } from '../../core/invocation/wake-word-detector';
import { shouldAllowInvocation } from '../../core/invocation/invocation-rate-limiter';
import { fetchAttachmentText, type FetchAttachmentResult } from '../../core/utils/file-handler';
import { smartSplit } from '../../core/utils/message-splitter';
import { VoiceManager } from '../../core/voice/voiceManager';
import { upsertIngestedAttachment } from '../../core/attachments/ingestedAttachmentRepo';
import {
  appendAttachmentBlocksToText,
  buildAttachmentBlockFromResult,
  buildMessageContent,
  deriveAttachmentBudget,
  getNonImageAttachments,
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
const CLEANUP_INTERVAL = 30_000; // Run cleanup every 30s
let lastCleanupTime = Date.now();

// Cache parsed wake words at module level to avoid reparsing on every message
let cachedWakeWords: string[] | null = null;
let cachedWakeWordPrefixes: string[] | null = null;
const ATTACHMENT_INTENT_PATTERN =
  /\b(attachment|attached|file|files|document|doc|pdf|read|review|analy[sz]e|summari[sz]e|inspect|parse|look at)\b/i;

function getWakeWords(): string[] {
  if (!cachedWakeWords) {
    cachedWakeWords = appConfig.WAKE_WORDS_CSV.split(',')
      .map((word: string) => word.trim())
      .filter(Boolean);
  }
  return cachedWakeWords;
}

function getWakeWordPrefixes(): string[] {
  if (!cachedWakeWordPrefixes) {
    cachedWakeWordPrefixes = appConfig.WAKE_WORD_PREFIXES_CSV.split(',')
      .map((prefix: string) => prefix.trim())
      .filter(Boolean);
  }
  return cachedWakeWordPrefixes;
}

function shouldInlineAttachmentBlocks(params: {
  invokedBy: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
  cleanedText: string;
  hasAttachmentBlocks: boolean;
}): boolean {
  if (!params.hasAttachmentBlocks) return false;
  if (params.invokedBy !== 'autopilot') return true;
  return ATTACHMENT_INTENT_PATTERN.test(params.cleanedText);
}


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

    // Periodic cleanup (time-based, not just size-based)
    if (now - lastCleanupTime > CLEANUP_INTERVAL) {
      lastCleanupTime = now;
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

    const nonImageAttachments = getNonImageAttachments(message);
    const maxAttachmentsPerMessage = Math.max(1, appConfig.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE);
    const selectedAttachments = nonImageAttachments.slice(0, maxAttachmentsPerMessage);
    const skippedByLimitCount = Math.max(0, nonImageAttachments.length - selectedAttachments.length);
    const attachmentBlocks: string[] = [];
    const ingestAttachmentNotes: string[] = [];
    const cachedAttachmentNames: string[] = [];
    let cachedExtractableCount = 0;
    const shouldPersistAttachmentCache =
      !!message.guildId && isLoggingEnabled(message.guildId, message.channelId);

    const attachmentBudget = deriveAttachmentBudget({
      baseText: message.content ?? '',
    });
    let remainingAttachmentChars = attachmentBudget.maxChars;
    let remainingAttachmentBytes = appConfig.FILE_INGEST_MAX_TOTAL_BYTES_PER_MESSAGE;

    for (let index = 0; index < selectedAttachments.length; index += 1) {
      const attachment = selectedAttachments[index];
      const attachmentName = attachment?.name ?? '';
      if (attachmentName.trim().length === 0) {
        continue;
      }

      const attachmentsRemaining = Math.max(1, selectedAttachments.length - index);
      const maxChars = Math.floor(remainingAttachmentChars / attachmentsRemaining);
      const maxBytesFromChars = Math.max(0, Math.floor(maxChars * 4));
      const maxBytes = Math.max(
        0,
        Math.min(appConfig.FILE_INGEST_MAX_BYTES_PER_FILE, remainingAttachmentBytes, maxBytesFromChars),
      );
      const headChars = Math.floor(maxChars * 0.7);
      const tailChars = Math.max(0, maxChars - headChars);

      let attachmentResult: FetchAttachmentResult;
      if (maxChars <= 0 || maxBytes <= 0) {
        attachmentResult = {
          kind: 'too_large',
          message: `[System: File '${attachmentName}' omitted due to context limits.]`,
          extractor: 'none',
        };
      } else {
        attachmentResult = await fetchAttachmentText(attachment.url ?? '', attachmentName, {
          timeoutMs: appConfig.FILE_INGEST_TIMEOUT_MS,
          maxBytes,
          maxChars,
          truncateStrategy: 'head_tail',
          headChars,
          tailChars,
          contentType: attachment.contentType ?? null,
          declaredSizeBytes: attachment.size ?? null,
          tikaBaseUrl: appConfig.FILE_INGEST_TIKA_BASE_URL,
          ocrEnabled: appConfig.FILE_INGEST_OCR_ENABLED,
        });
      }

      const attachmentBlock = buildAttachmentBlockFromResult(
        attachmentName,
        attachmentResult,
        attachment.contentType ?? null,
        { sizeBytes: attachment.size ?? null, includeSkipped: false },
      );

      if (attachmentBlock) {
        attachmentBlocks.push(attachmentBlock);
        remainingAttachmentChars = Math.max(0, remainingAttachmentChars - attachmentBlock.length);
      }

      const attachmentStatus = attachmentResult.kind;
      const extractedText =
        attachmentStatus === 'ok' || attachmentStatus === 'truncated' ? attachmentResult.text : null;
      const errorText =
        attachmentStatus === 'skip'
          ? attachmentResult.reason
          : attachmentStatus === 'too_large' || attachmentStatus === 'error'
            ? attachmentResult.message
            : null;
      if (extractedText) {
        cachedExtractableCount += 1;
        cachedAttachmentNames.push(attachmentName);
      }

      if (shouldPersistAttachmentCache) {
        try {
          await upsertIngestedAttachment({
            guildId: message.guildId ?? null,
            channelId: message.channelId,
            messageId: message.id,
            attachmentIndex: index,
            filename: attachmentName,
            sourceUrl: attachment.url ?? '',
            contentType: attachmentResult.mimeType ?? attachment.contentType ?? null,
            declaredSizeBytes: attachment.size ?? null,
            readSizeBytes: attachmentResult.byteLength ?? null,
            extractor: attachmentResult.extractor,
            status: attachmentStatus,
            errorText,
            extractedText,
          });
        } catch (error) {
          logger.warn(
            { error, msgId: message.id, channelId: message.channelId, attachment: attachmentName },
            'Attachment cache persist failed (non-fatal)',
          );
        }
      }

      const consumedBytes =
        typeof attachmentResult.byteLength === 'number' && Number.isFinite(attachmentResult.byteLength)
          ? attachmentResult.byteLength
          : typeof attachment.size === 'number' && Number.isFinite(attachment.size)
            ? attachment.size
            : 0;
      remainingAttachmentBytes = Math.max(0, remainingAttachmentBytes - consumedBytes);
    }

    if (selectedAttachments.length > 0) {
      if (shouldPersistAttachmentCache) {
        ingestAttachmentNotes.push(
          `[System: Attachment cache processed ${selectedAttachments.length} non-image attachment(s); extractable cached files: ${cachedExtractableCount}.]`,
        );
        if (cachedAttachmentNames.length > 0) {
          const preview = cachedAttachmentNames.slice(0, 3).join(', ');
          const overflow = cachedAttachmentNames.length - 3;
          ingestAttachmentNotes.push(
            `[System: Cached file references: ${preview}${overflow > 0 ? ` (+${overflow} more)` : ''}. Full file content is retrievable on demand.]`,
          );
        }
      } else {
        ingestAttachmentNotes.push(
          `[System: Processed ${selectedAttachments.length} non-image attachment(s) for this turn. Persistent attachment cache is unavailable in this channel.]`,
        );
      }
    }

    if (skippedByLimitCount > 0) {
      ingestAttachmentNotes.push(
        `[System: Skipped ${skippedByLimitCount} attachment(s) due to per-message limit (${maxAttachmentsPerMessage}).]`,
      );
    }

    const ingestContent = appendAttachmentBlocksToText(message.content ?? '', ingestAttachmentNotes);

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

    // Mention-first: only respond to mentions or replies (use cached wake words)
    let invocation = detectInvocation({
      rawContent: message.content,
      isMentioned,
      isReplyToBot,
      botUserId: client.user?.id,
      wakeWords: getWakeWords(),
      prefixes: getWakeWordPrefixes(),
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
      const includeAttachmentBlocks = shouldInlineAttachmentBlocks({
        invokedBy: invocation.kind,
        cleanedText: invocation.cleanedText,
        hasAttachmentBlocks: attachmentBlocks.length > 0,
      });
      const runtimeAttachmentBlocks = includeAttachmentBlocks
        ? attachmentBlocks
        : attachmentBlocks.length > 0
          ? [
              shouldPersistAttachmentCache
                ? '[System: Non-image attachments were cached. If needed, retrieve file content from the channel attachment cache.]'
                : '[System: Non-image attachments were processed for this turn only. Persistent cache is unavailable in this channel.]',
            ]
          : [];
      const userTextWithAttachments = appendAttachmentBlocksToText(
        invocation.cleanedText,
        runtimeAttachmentBlocks,
      );
      const userContent = buildMessageContent(message, {
        allowEmpty: true,
        textOverride: userTextWithAttachments,
      });

      // Check for voice overlap (User + Bot in same VC)
      let isVoiceActive = false;
      let voiceManager: VoiceManager | null = null;
      if (message.guildId && message.member?.voice?.channelId) {
        voiceManager = VoiceManager.getInstance();
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
      if (result.replyText && isVoiceActive && message.guildId && voiceManager) {
        try {
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
        loggerWithTrace.info('Response sent');
      } else {
        loggerWithTrace.info(
          {
            intent: invocation.intent,
            hasFiles: false,
            replyLength: 0,
          },
          'No response sent (empty reply)',
        );
      }
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

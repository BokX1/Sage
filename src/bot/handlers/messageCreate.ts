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
import { LLMMessageContent } from '../../core/llm/types';
import { estimateTokens } from '../../core/agentRuntime/tokenEstimate';
import { fetchAttachmentText, FetchAttachmentResult } from '../../utils/fileHandler';
import { smartSplit } from '../../utils/messageSplitter';

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

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'svg',
]);

const ATTACHMENT_CONTEXT_NOTE =
  '(System Note: The user attached the file above. Analyze it based on their request.)';
const TRANSCRIPT_HEADER = 'Recent channel transcript (most recent last):';

function isImageAttachment(attachment?: {
  contentType?: string | null;
  name?: string | null;
  url?: string | null;
}): boolean {
  if (!attachment) return false;
  const contentType = attachment.contentType?.toLowerCase();
  if (contentType?.startsWith('image/')) {
    return true;
  }

  const name = attachment.name ?? attachment.url ?? '';
  const extension = name.split('?')[0]?.split('.').pop()?.toLowerCase();
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
}

function getMessageAttachments(message: Message) {
  const attachments = message.attachments;
  if (!attachments) {
    return [];
  }
  if (typeof attachments.values === 'function') {
    return Array.from(attachments.values());
  }
  if (typeof attachments.first === 'function') {
    const first = attachments.first();
    return first ? [first] : [];
  }
  return [];
}

function getImageAttachment(message: Message) {
  return getMessageAttachments(message).find((attachment) => isImageAttachment(attachment));
}

function getNonImageAttachment(message: Message) {
  return getMessageAttachments(message).find((attachment) => !isImageAttachment(attachment));
}

function buildMessageContent(
  message: Message,
  options?: { prefix?: string; allowEmpty?: boolean; textOverride?: string },
): LLMMessageContent | null {
  const prefix = options?.prefix ?? '';
  const text = options?.textOverride ?? message.content ?? '';
  const combinedText = `${prefix}${text}`;
  const attachment = getImageAttachment(message);
  const hasImage = isImageAttachment(attachment);

  if (!hasImage || !attachment?.url) {
    if (!options?.allowEmpty && combinedText.trim().length === 0) {
      return null;
    }
    return combinedText;
  }

  const textPart = combinedText.trim().length > 0 ? combinedText : ' ';
  return [
    { type: 'text', text: textPart },
    { type: 'image_url', image_url: { url: attachment.url } },
  ];
}

function appendAttachmentToText(baseText: string, attachmentBlock: string | null): string {
  if (!attachmentBlock) {
    return baseText;
  }
  const separator = baseText.trim().length > 0 ? '\n\n' : '';
  return `${baseText}${separator}${attachmentBlock}`;
}

function formatAttachmentBlock(
  filename: string,
  body: string,
  extraNotes: string[] = [],
): string {
  const lines = [
    `--- BEGIN FILE ATTACHMENT: ${filename} ---`,
    body,
    '--- END FILE ATTACHMENT ---',
    ...extraNotes,
    ATTACHMENT_CONTEXT_NOTE,
  ];
  return lines.filter((line) => line !== undefined && line !== null).join('\n');
}

function deriveAttachmentLimits(params: {
  baseText: string;
  filename: string;
  authorDisplayName: string;
  authorId: string;
  timestamp: Date;
}): { maxChars: number; maxBytes: number; headChars: number; tailChars: number } {
  const linePrefix = `- @${params.authorDisplayName} (id:${params.authorId}) [${params.timestamp.toISOString()}]: `;
  const transcriptMaxContent = Math.max(
    0,
    appConfig.CONTEXT_TRANSCRIPT_MAX_CHARS - TRANSCRIPT_HEADER.length - 1 - linePrefix.length,
  );
  const attachmentOverhead = formatAttachmentBlock(params.filename, '').length;
  const remainingTranscriptChars = Math.max(
    0,
    transcriptMaxContent - params.baseText.length - attachmentOverhead,
  );
  const overheadTokens = estimateTokens(formatAttachmentBlock(params.filename, ''));
  const availableTokens = Math.max(
    0,
    appConfig.CONTEXT_USER_MAX_TOKENS - estimateTokens(params.baseText) - overheadTokens,
  );
  const remainingBudgetChars = Math.floor(
    availableTokens * appConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN,
  );
  const maxChars = Math.max(0, Math.min(remainingBudgetChars, remainingTranscriptChars));
  const maxBytes = Math.max(0, Math.floor(maxChars * 4));
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.max(0, maxChars - headChars);
  return { maxChars, maxBytes, headChars, tailChars };
}

function buildAttachmentBlockFromResult(
  filename: string,
  result: FetchAttachmentResult,
  contentType?: string | null,
): string | null {
  if (result.kind === 'skip') {
    return null;
  }

  const notes: string[] = [];
  if (result.kind === 'truncated') {
    notes.push(result.message);
  }

  if (contentType?.toLowerCase().startsWith('application/octet-stream')) {
    notes.push(
      '(System Note: Attachment content-type was application/octet-stream; treated as text based on file extension.)',
    );
  }

  if (result.kind === 'too_large' || result.kind === 'error') {
    return formatAttachmentBlock(filename, result.message, notes);
  }

  return formatAttachmentBlock(filename, result.text, notes);
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
      const userTextWithAttachments = appendAttachmentToText(
        invocation.cleanedText,
        attachmentBlock,
      );
      const userContent = buildMessageContent(message, {
        allowEmpty: true,
        textOverride: userTextWithAttachments,
      });

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
      });

      // Send messages to Discord
      if (result.replyText) {
        const chunks = smartSplit(result.replyText, 2000);
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

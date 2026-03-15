import { Message, Events } from 'discord.js';
import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import { generateTraceId } from '../../../shared/observability/trace-id-generator';
import { isRateLimited } from '../../../features/chat/rate-limiter';
import { generateChatReply } from '../../../features/chat/chat-engine';
import { ingestEvent } from '../../../features/ingest/ingestEvent';
import { config as appConfig } from '../../../platform/config/env';
import { isLoggingEnabled } from '../../../features/settings/guildChannelSettings';
import { detectInvocation } from '../../../features/invocation/wake-word-detector';
import { shouldAllowInvocation } from '../../../features/invocation/invocation-rate-limiter';
import { fetchAttachmentText, type FetchAttachmentResult } from '../../../platform/files/file-handler';
import { smartSplit } from '../../../shared/text/message-splitter';
import { VoiceManager } from '../../../features/voice/voiceManager';
import { transcribeDiscordVoiceMessageAttachment } from '../../../features/voice/voiceMessageTranscriber';
import { upsertIngestedAttachment } from '../../../features/attachments/ingestedAttachmentRepo';
import { deleteAttachmentChunks, ingestAttachmentText } from '../../../features/embeddings';
import { queueImageAttachmentRecall } from '../../../features/attachments/imageAttachmentRecallWorker';
import { normalizeNonNegativeInt, normalizePositiveInt } from '../../../shared/utils/numbers';
import {
  appendAttachmentBlocksToText,
  buildAttachmentBlockFromResult,
  buildMessageContent,
  extractVisibleMessageText,
  getMessageAttachments,
  isImageAttachment,
  getVisionImageUrl,
} from './attachment-parser';
import { isAdminFromMember, isModeratorFromMember } from '../../../platform/discord/admin-permissions';
import { buildGuildApiKeyMissingResponse } from '../../../features/discord/byopBootstrap';
import { ReplyTargetContext } from '../../../features/agent-runtime/continuityContext';
import {
  createInteractiveButtonSession,
} from '../../../features/discord/interactiveComponentService';
import {
  buildContinuationButtonLabel,
  buildMessageFailureText,
  buildRetryButtonLabel,
} from '../../../features/discord/userFacingCopy';
import { buildRuntimeResponseCardPayload } from '../../../features/discord/runtimeResponseCards';

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

const DEFAULT_IMAGE_ONLY_PROMPT = 'Describe the image and answer any implied question.';
const DEFAULT_DIRECT_INVOCATION_PROMPT =
  'The user is calling for your attention without a specific request. Briefly acknowledge them and ask what they need help with.';
const DEFAULT_REPLY_ONLY_PROMPT =
  'Respond to the replied-to message using its content and nearby context. If the user intent is still unclear, ask one brief clarifying question.';

function getWakeWords(): string[] {
  if (!cachedWakeWords) {
    cachedWakeWords = appConfig.WAKE_WORDS_CSV.split(',')
      .map((word: string) => word.trim())
      .filter(Boolean);
  }
  return cachedWakeWords ?? [];
}

function getWakeWordPrefixes(): string[] {
  if (!cachedWakeWordPrefixes) {
    cachedWakeWordPrefixes = appConfig.WAKE_WORD_PREFIXES_CSV.split(',')
      .map((prefix: string) => prefix.trim())
      .filter(Boolean);
  }
  return cachedWakeWordPrefixes ?? [];
}

function shouldInlineAttachmentBlocks(params: {
  invokedBy: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  cleanedText: string;
  hasAttachmentBlocks: boolean;
}): boolean {
  if (!params.hasAttachmentBlocks) return false;
  if (params.invokedBy !== 'autopilot') return true;
  return ATTACHMENT_INTENT_PATTERN.test(params.cleanedText);
}

function resolveEmptyInvocationPrompt(params: {
  invocationKind: 'mention' | 'reply' | 'wakeword' | 'autopilot';
  hasImageContext: boolean;
  hasReplyTarget: boolean;
}): string {
  if (params.hasImageContext) {
    return DEFAULT_IMAGE_ONLY_PROMPT;
  }
  if (params.invocationKind === 'reply' && params.hasReplyTarget) {
    return DEFAULT_REPLY_ONLY_PROMPT;
  }
  return DEFAULT_DIRECT_INVOCATION_PROMPT;
}

function buildAttachmentIngestNotes(params: {
  selectedAttachmentCount: number;
  shouldPersistAttachmentCache: boolean;
  cachedAttachmentCount: number;
  cachedAttachmentRefs: Array<{ filename: string; attachmentId: string }>;
  skippedByLimitCount: number;
  maxAttachmentsPerMessage: number;
}): string[] {
  const notes: string[] = [];

  if (params.selectedAttachmentCount > 0) {
    if (params.shouldPersistAttachmentCache) {
      notes.push(
        `[System: Attachment cache processed ${params.selectedAttachmentCount} attachment(s); cached attachments: ${params.cachedAttachmentCount}.]`,
      );
      if (params.cachedAttachmentRefs.length > 0) {
        const preview = params.cachedAttachmentRefs
          .slice(0, 3)
          .map((ref) => `${ref.filename} (attachment:${ref.attachmentId})`)
          .join(', ');
        const overflow = params.cachedAttachmentRefs.length - 3;
        notes.push(
          `[System: Cached attachment references: ${preview}${overflow > 0 ? ` (+${overflow} more)` : ''}. Read content via discord_files action read_attachment or resend via discord_files action send_attachment using attachmentId.]`,
        );
      }
    } else {
      notes.push(
        `[System: Processed ${params.selectedAttachmentCount} attachment(s) for this turn. Persistent attachment cache is unavailable in this channel.]`,
      );
    }
  }

  if (params.skippedByLimitCount > 0) {
    notes.push(
      `[System: Skipped ${params.skippedByLimitCount} attachment(s) due to per-message limit (${params.maxAttachmentsPerMessage}).]`,
    );
  }

  return notes;
}

function buildRuntimeAttachmentBlocks(params: {
  includeAttachmentBlocks: boolean;
  attachmentBlocks: string[];
  shouldPersistAttachmentCache: boolean;
  cachedAttachmentRefs: Array<{ filename: string; attachmentId: string }>;
}): string[] {
  if (params.includeAttachmentBlocks && params.attachmentBlocks.length > 0) {
    return params.attachmentBlocks;
  }

  if (params.attachmentBlocks.length === 0 && params.cachedAttachmentRefs.length === 0) {
    return [];
  }

  const blocks: string[] = [
    params.shouldPersistAttachmentCache
      ? '[System: Attachments were cached. If needed, retrieve stored content from the channel attachment cache or resend the original attachment.]'
      : '[System: Attachments were processed for this turn only. Persistent cache is unavailable in this channel.]',
  ];

  if (params.shouldPersistAttachmentCache && params.cachedAttachmentRefs.length > 0) {
    const preview = params.cachedAttachmentRefs
      .slice(0, 3)
      .map((ref) => `${ref.filename} (attachment:${ref.attachmentId})`)
      .join(', ');
    const overflow = params.cachedAttachmentRefs.length - 3;
    blocks.push(
      `[System: Cached attachment references: ${preview}${overflow > 0 ? ` (+${overflow} more)` : ''}. Read via discord_files action read_attachment or resend via discord_files action send_attachment using attachmentId.]`,
    );
  }

  if (params.attachmentBlocks.length > 0) {
    blocks.unshift(...params.attachmentBlocks);
  }

  return blocks;
}

function queueAttachmentChunkIngestion(params: {
  attachmentId: string;
  extractedText: string;
  messageId: string;
  channelId: string;
}): void {
  void (async () => {
    try {
      await deleteAttachmentChunks(params.attachmentId);
      await ingestAttachmentText(params.attachmentId, params.extractedText);
    } catch (error) {
      logger.warn(
        {
          error,
          attachmentId: params.attachmentId,
          msgId: params.messageId,
          channelId: params.channelId,
        },
        'Attachment chunk embedding/indexing failed (non-fatal)',
      );
    }
  })();
}

async function persistAttachmentCache(params: {
  message: Message;
  index: number;
  attachmentName: string;
  attachmentUrl: string;
  contentType: string | null;
  declaredSizeBytes: number | null;
  attachmentResult: FetchAttachmentResult;
  extractedText: string | null;
  errorText: string | null;
}): Promise<string | null> {
  try {
    const ingestedRecord = await upsertIngestedAttachment({
      guildId: params.message.guildId ?? null,
      channelId: params.message.channelId,
      messageId: params.message.id,
      attachmentIndex: params.index,
      filename: params.attachmentName,
      sourceUrl: params.attachmentUrl,
      contentType: params.attachmentResult.mimeType ?? params.contentType ?? null,
      declaredSizeBytes: params.declaredSizeBytes,
      readSizeBytes: params.attachmentResult.byteLength ?? null,
      extractor: params.attachmentResult.extractor,
      status: params.attachmentResult.kind,
      errorText: params.errorText,
      extractedText: params.extractedText,
    });

    if (params.extractedText && ingestedRecord?.id) {
      queueAttachmentChunkIngestion({
        attachmentId: ingestedRecord.id,
        extractedText: params.extractedText,
        messageId: params.message.id,
        channelId: params.message.channelId,
      });
    }
    return ingestedRecord?.id ?? null;
  } catch (error) {
    logger.warn(
      {
        error,
        msgId: params.message.id,
        channelId: params.message.channelId,
        attachment: params.attachmentName,
      },
      'Attachment cache persist failed (non-fatal)',
    );
    return null;
  }
}

async function persistQueuedImageAttachment(params: {
  message: Message;
  index: number;
  attachmentName: string;
  attachmentUrl: string;
  contentType: string | null;
  declaredSizeBytes: number | null;
  status: 'queued' | 'skip';
  errorText: string | null;
}): Promise<string | null> {
  try {
    const ingestedRecord = await upsertIngestedAttachment({
      guildId: params.message.guildId ?? null,
      channelId: params.message.channelId,
      messageId: params.message.id,
      attachmentIndex: params.index,
      filename: params.attachmentName,
      sourceUrl: params.attachmentUrl,
      contentType: params.contentType,
      declaredSizeBytes: params.declaredSizeBytes,
      readSizeBytes: null,
      extractor: 'vision',
      status: params.status,
      errorText: params.errorText,
      extractedText: null,
    });
    return ingestedRecord?.id ?? null;
  } catch (error) {
    logger.warn(
      {
        error,
        msgId: params.message.id,
        channelId: params.message.channelId,
        attachment: params.attachmentName,
      },
      'Image attachment cache persist failed (non-fatal)',
    );
    return null;
  }
}

type SendableTypingChannel = {
  sendTyping: () => Promise<unknown>;
  // Minimal subset of the Discord.js send API used by this handler.
  send: (
    options: string | { content: string; allowedMentions?: { parse?: string[] } },
  ) => Promise<Message>;
};

function isSendableTypingChannel(
  channel: Message['channel'],
): channel is Message['channel'] & SendableTypingChannel {
  const candidate = channel as unknown as { sendTyping?: unknown; send?: unknown };
  return typeof candidate.sendTyping === 'function' && typeof candidate.send === 'function';
}

function getMentionedUserIds(message: Message): string[] {
  const botUserId = client.user?.id;
  return Array.from(message.mentions.users?.keys?.() ?? []).filter((id) => id !== botUserId);
}

async function resolveReferencedMessage(message: Message): Promise<Message | null> {
  if (!message.reference) {
    return null;
  }

  const cachedReference =
    'referencedMessage' in message ? (message.referencedMessage as Message | null) : null;
  if (cachedReference && !cachedReference.partial) {
    return cachedReference;
  }

  try {
    return await message.fetchReference();
  } catch (error) {
    logger.debug(
      { msgId: message.id, error: error instanceof Error ? error.message : String(error) },
      'Reply reference fetch failed',
    );
    return null;
  }
}

export async function handleMessageCreate(message: Message) {
  let typingInterval: NodeJS.Timeout | null = null;
  try {
    const now = Date.now();
    logger.debug({ msgId: message.id, author: message.author.username }, 'Processing message event');

    if (processedMessages.has(message.id)) {
      logger.debug({ msgId: message.id }, 'Ignoring duplicate message event (Dedupe hit)');
      return;
    }
    processedMessages.set(message.id, now);

    if (now - lastCleanupTime > CLEANUP_INTERVAL) {
      lastCleanupTime = now;
      for (const [id, timestamp] of processedMessages) {
        if (now - timestamp > DEDUP_TTL) processedMessages.delete(id);
      }
    }

    const isMentioned = !!(client.user && message.mentions.has(client.user));
    const mentionedUserIds = getMentionedUserIds(message);
    const authorDisplayName =
      message.member?.displayName ?? message.author.username ?? message.author.id;

    const referencedMessage = await resolveReferencedMessage(message);
    const replyToAuthorId =
      referencedMessage && !referencedMessage.author.bot ? referencedMessage.author.id : null;

    if (message.author.bot) {
      await ingestEvent({
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
        replyToAuthorId,
        mentionsBot: isMentioned,
        mentionsUserIds: mentionedUserIds,
      });
      return;
    }

    let isReplyToBot = false;
    let replyTarget: ReplyTargetContext | null = null;
    if (referencedMessage) {
      isReplyToBot = referencedMessage.author.id === client.user?.id;
      const replyTargetDisplayName =
        referencedMessage.member?.displayName ??
        referencedMessage.author.globalName ??
        referencedMessage.author.username ??
        referencedMessage.author.id;
      replyTarget = {
        messageId: referencedMessage.id,
        guildId: referencedMessage.guildId,
        channelId: referencedMessage.channelId,
        authorId: referencedMessage.author.id,
        authorDisplayName: replyTargetDisplayName,
        authorIsBot: referencedMessage.author.bot,
        replyToMessageId: referencedMessage.reference?.messageId ?? null,
        mentionedUserIds: getMentionedUserIds(referencedMessage),
        content: buildMessageContent(referencedMessage, { allowEmpty: true }) ?? '',
      };
    }

    const messageVisionImageUrl = getVisionImageUrl(message);
    const referencedVisionImageUrl = referencedMessage ? getVisionImageUrl(referencedMessage) : null;
    const hasImageInvocationContext = !!messageVisionImageUrl || !!referencedVisionImageUrl;

    const allAttachments = getMessageAttachments(message);
    const maxAttachmentsPerMessage = normalizePositiveInt(
      appConfig.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE,
      1,
    );
    const perFileMaxBytes = normalizeNonNegativeInt(appConfig.FILE_INGEST_MAX_BYTES_PER_FILE, 0);
    const perMessageMaxBytes = normalizeNonNegativeInt(
      appConfig.FILE_INGEST_MAX_TOTAL_BYTES_PER_MESSAGE,
      0,
    );
    const ingestTimeoutMs = normalizePositiveInt(appConfig.FILE_INGEST_TIMEOUT_MS, 45_000);
    const voiceSttMaxBytes = normalizeNonNegativeInt(appConfig.VOICE_MESSAGE_STT_MAX_BYTES, perFileMaxBytes);
    const voiceSttMaxSeconds = normalizePositiveInt(appConfig.VOICE_MESSAGE_STT_MAX_SECONDS, 120);
    const shouldPersistAttachmentCache =
      !!message.guildId && isLoggingEnabled(message.guildId, message.channelId);
    const attachmentsForIngest = shouldPersistAttachmentCache
      ? allAttachments
      : allAttachments.filter((attachment) => !isImageAttachment(attachment));
    const selectedAttachments = attachmentsForIngest.slice(0, maxAttachmentsPerMessage);
    const skippedByLimitCount = Math.max(0, attachmentsForIngest.length - selectedAttachments.length);
    const attachmentBlocks: string[] = [];
    const ingestAttachmentNotes: string[] = [];
    const cachedAttachmentRefs: Array<{ filename: string; attachmentId: string }> = [];
    const shouldTranscribeVoiceMessages =
      shouldPersistAttachmentCache &&
      appConfig.VOICE_MESSAGE_STT_ENABLED &&
      message.flags?.has?.('IsVoiceMessage');

    let remainingAttachmentBytes = perMessageMaxBytes;
    let queuedImageRecallWork = false;

    for (let index = 0; index < selectedAttachments.length; index += 1) {
      const attachment = selectedAttachments[index];
      const attachmentName = attachment?.name ?? '';
      if (attachmentName.trim().length === 0) {
        continue;
      }

      if (isImageAttachment(attachment)) {
        if (shouldPersistAttachmentCache) {
          const imageRecallEnabled = !!appConfig.FILE_INGEST_IMAGE_ENABLED;
          const persistedAttachmentId = await persistQueuedImageAttachment({
            message,
            index,
            attachmentName,
            attachmentUrl: attachment.url ?? '',
            contentType: attachment.contentType ?? null,
            declaredSizeBytes: attachment.size ?? null,
            status: imageRecallEnabled ? 'queued' : 'skip',
            errorText: imageRecallEnabled
              ? '[System: Image recall queued for background processing.]'
              : '[System: Local image recall ingest is disabled.]',
          });
          if (persistedAttachmentId) {
            cachedAttachmentRefs.push({ filename: attachmentName, attachmentId: persistedAttachmentId });
            if (imageRecallEnabled) {
              queuedImageRecallWork = true;
            }
          }
        }
        continue;
      }

      let attachmentResult: FetchAttachmentResult;
      if (shouldTranscribeVoiceMessages) {
        const voiceMaxBytes = Math.max(
          0,
          Math.min(voiceSttMaxBytes, remainingAttachmentBytes, perFileMaxBytes),
        );
        if (voiceMaxBytes <= 0) {
          attachmentResult = {
            kind: 'too_large',
            message: `[System: Voice message '${attachmentName}' omitted due to size limits.]`,
            extractor: 'voice_stt',
            mimeType: attachment.contentType ?? null,
          };
        } else {
          attachmentResult = await transcribeDiscordVoiceMessageAttachment({
            url: attachment.url ?? '',
            filename: attachmentName,
            contentType: attachment.contentType ?? null,
            declaredSizeBytes: attachment.size ?? null,
            durationSeconds: attachment.duration ?? null,
            timeoutMs: ingestTimeoutMs,
            maxBytes: voiceMaxBytes,
            maxSeconds: voiceSttMaxSeconds,
          });
        }
      } else {
        const maxBytes = Math.max(0, Math.min(perFileMaxBytes, remainingAttachmentBytes));
        if (maxBytes <= 0) {
          attachmentResult = {
            kind: 'too_large',
            message: `[System: File '${attachmentName}' omitted due to size limits.]`,
            extractor: 'none',
          };
        } else {
          attachmentResult = await fetchAttachmentText(attachment.url ?? '', attachmentName, {
            timeoutMs: ingestTimeoutMs,
            maxBytes,
            contentType: attachment.contentType ?? null,
            declaredSizeBytes: attachment.size ?? null,
            tikaBaseUrl: appConfig.FILE_INGEST_TIKA_BASE_URL,
            ocrEnabled: appConfig.FILE_INGEST_OCR_ENABLED,
          });
        }
      }

      const attachmentBlock = buildAttachmentBlockFromResult(
        attachmentName,
        attachmentResult,
        attachment.contentType ?? null,
        { sizeBytes: attachment.size ?? null, includeSkipped: false },
      );

      if (attachmentBlock) {
        attachmentBlocks.push(attachmentBlock);
      }

      const attachmentStatus = attachmentResult.kind;
      const extractedText = attachmentStatus === 'ok' ? attachmentResult.text : null;
      const errorText =
        attachmentStatus === 'skip'
          ? attachmentResult.reason
          : attachmentStatus === 'too_large' || attachmentStatus === 'error'
            ? attachmentResult.message
            : null;
      if (shouldPersistAttachmentCache) {
        const persistedAttachmentId = await persistAttachmentCache({
          message,
          index,
          attachmentName,
          attachmentUrl: attachment.url ?? '',
          contentType: attachment.contentType ?? null,
          declaredSizeBytes: attachment.size ?? null,
          attachmentResult,
          extractedText,
          errorText,
        });
        if (persistedAttachmentId) {
          cachedAttachmentRefs.push({ filename: attachmentName, attachmentId: persistedAttachmentId });
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

    if (queuedImageRecallWork) {
      queueImageAttachmentRecall();
    }

    const cachedAttachmentCount = cachedAttachmentRefs.length;
    ingestAttachmentNotes.push(
      ...buildAttachmentIngestNotes({
        selectedAttachmentCount: selectedAttachments.length,
        shouldPersistAttachmentCache,
        cachedAttachmentCount,
        cachedAttachmentRefs,
        skippedByLimitCount,
        maxAttachmentsPerMessage,
      }),
    );

    const ingestContent = appendAttachmentBlocksToText(message.content ?? '', ingestAttachmentNotes);

    await ingestEvent({
      type: 'message',
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
      authorDisplayName,
      authorIsBot: false,
      content: ingestContent,
      timestamp: message.createdAt,
      replyToMessageId: message.reference?.messageId,
      replyToAuthorId,
      mentionsBot: isMentioned,
      mentionsUserIds: mentionedUserIds,
    });

    let invocation = detectInvocation({
      rawContent: message.content,
      isMentioned,
      isReplyToBot,
      botUserId: client.user?.id,
      wakeWords: getWakeWords(),
      prefixes: getWakeWordPrefixes(),
      allowEmpty: true,
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

    if (!invocation) {
      if (appConfig.AUTOPILOT_MODE === 'reserved' || appConfig.AUTOPILOT_MODE === 'talkative') {
        invocation = {
          kind: 'autopilot',
          cleanedText: message.content,
        };
      } else {
        return;
      }
    }

    if (invocation.cleanedText.trim().length === 0) {
      invocation = {
        ...invocation,
        cleanedText: resolveEmptyInvocationPrompt({
          invocationKind: invocation.kind,
          hasImageContext: hasImageInvocationContext,
          hasReplyTarget: !!replyTarget,
        }),
      };
    }

    logger.debug({ type: invocation.kind }, 'Invocation decided');

    const traceId = generateTraceId();
    const loggerWithTrace = logger.child({ traceId });

    if (isRateLimited(message.channelId)) {
      loggerWithTrace.warn('Rate limit hit');
      return;
    }

    if (!isSendableTypingChannel(message.channel)) {
      loggerWithTrace.warn({ channelId: message.channelId }, 'Channel does not support send/sendTyping');
      return;
    }
    const discordChannel = message.channel;

    try {
      loggerWithTrace.info(
        { msg: 'Message received', textLength: invocation.cleanedText?.length ?? 0 },
      );

      await discordChannel.sendTyping();
      typingInterval = setInterval(() => {
        void discordChannel.sendTyping().catch(() => {
          // Ignore typing errors (for example, missing permissions or deleted channels).
        });
      }, 8000);
      typingInterval.unref?.();

      const includeAttachmentBlocks = shouldInlineAttachmentBlocks({
        invokedBy: invocation.kind,
        cleanedText: invocation.cleanedText,
        hasAttachmentBlocks: attachmentBlocks.length > 0,
      });
      const runtimeAttachmentBlocks = buildRuntimeAttachmentBlocks({
        includeAttachmentBlocks,
        attachmentBlocks,
        shouldPersistAttachmentCache,
        cachedAttachmentRefs,
      });
      const userTextWithAttachments = appendAttachmentBlocksToText(
        invocation.cleanedText,
        runtimeAttachmentBlocks,
      );
      const userContent = buildMessageContent(message, {
        allowEmpty: true,
        textOverride: userTextWithAttachments,
      });

      let isVoiceActive = false;
      let activeVoiceChannelId: string | null = null;
      if (message.guildId && message.member?.voice?.channelId) {
        const voiceManager = VoiceManager.getInstance();
        const connection = voiceManager.getConnection(message.guildId);
        if (connection && connection.joinConfig.channelId === message.member.voice.channelId) {
          isVoiceActive = true;
          activeVoiceChannelId = message.member.voice.channelId;
        }
      }

      const currentTurn = {
        invokerUserId: message.author.id,
        invokerDisplayName: authorDisplayName,
        messageId: message.id,
        guildId: message.guildId,
        channelId: message.channelId,
        invokedBy: invocation.kind,
        mentionedUserIds,
        isDirectReply: referencedMessage !== null,
        replyTargetMessageId: replyTarget?.messageId ?? null,
        replyTargetAuthorId: replyTarget?.authorId ?? null,
        botUserId: client.user?.id ?? null,
      };

      const invokerIsAdmin = isAdminFromMember(message.member);
      const invokerCanModerate = isModeratorFromMember(message.member);
      const result = await generateChatReply({
        traceId,
        userId: message.author.id,
        channelId: message.channelId,
        guildId: message.guildId,
        messageId: message.id,
        userText: userTextWithAttachments,
        userContent: userContent ?? userTextWithAttachments,
        currentTurn,
        replyTarget,
        mentionedUserIds,
        invokedBy: invocation.kind,
        isVoiceActive,
        voiceChannelId: activeVoiceChannelId,
        isAdmin: invokerIsAdmin,
        canModerate: invokerCanModerate,
      });

      const replyText = result.replyText || '';
      const files = result.files ?? [];
      const continuation = result.meta?.continuation;
      const retry = result.meta?.retry;

      let didSendAnything = false;
      const approvalQueued = result.delivery === 'approval_governance_only';
      let actionButtonId: string | null = null;
      let actionButtonLabel: string | null = null;
      if (result.delivery === 'chat_reply_with_continue' && continuation && message.guildId) {
        try {
          actionButtonId = await createInteractiveButtonSession({
            guildId: message.guildId,
            channelId: message.channelId,
            createdByUserId: message.author.id,
            action: {
              type: 'graph_continue',
              continuationId: continuation.id,
              visibility: 'public',
            },
          });
          actionButtonLabel = buildContinuationButtonLabel(result.meta?.continuation);
        } catch (err) {
          loggerWithTrace.warn(
            { err, continuationId: continuation.id, channelId: message.channelId },
            'Failed to create continuation button session; sending summary without button',
          );
        }
      } else if (retry && message.guildId) {
        try {
          actionButtonId = await createInteractiveButtonSession({
            guildId: message.guildId,
            channelId: message.channelId,
            createdByUserId: message.author.id,
            action: {
              type: 'graph_retry',
              threadId: retry.threadId,
              retryKind: retry.retryKind,
              visibility: 'public',
            },
          });
          actionButtonLabel = buildRetryButtonLabel();
        } catch (err) {
          loggerWithTrace.warn(
            { err, retryThreadId: retry.threadId, channelId: message.channelId },
            'Failed to create retry button session; sending retry text without button',
          );
        }
      }

      if (
        result.meta?.kind === 'missing_api_key' &&
        message.guildId &&
        result.meta.missingApiKey?.recovery === 'server_key_activation'
      ) {
        const missing = buildGuildApiKeyMissingResponse({
          isAdmin: invokerIsAdmin,
        });
        await message.reply({
          flags: missing.flags,
          components: missing.components,
          allowedMentions: { repliedUser: false },
        });
        didSendAnything = true;
      }

      if (!didSendAnything && ((!approvalQueued && replyText) || files.length > 0)) {
        const chunks = approvalQueued ? [] : smartSplit(replyText, 2000);
        const [firstChunk, ...restChunks] = chunks;
        const firstReplyContent = approvalQueued ? undefined : firstChunk;
        const actionButton =
          actionButtonId
            ? {
                customId: actionButtonId,
                label: actionButtonLabel ?? buildRetryButtonLabel(),
                style: 'primary' as const,
              }
            : null;
        const shouldUseRuntimeCard = !!actionButton;

        if ((shouldUseRuntimeCard && (firstReplyContent || files.length > 0)) || firstReplyContent || files.length > 0) {
          await message.reply(
            shouldUseRuntimeCard
              ? buildRuntimeResponseCardPayload({
                  text: firstReplyContent || '\u200b',
                  tone: continuation ? 'continue' : retry ? 'retry' : 'notice',
                  button: actionButton,
                  files,
                  allowedMentions: { repliedUser: false },
                })
              : {
                  content: firstReplyContent,
                  allowedMentions: { repliedUser: false },
                  files,
                },
          );
          didSendAnything = true;
        }

        for (const chunk of restChunks) {
          await discordChannel.send(chunk);
          didSendAnything = true;
        }
      }

      if (didSendAnything) {
        if (approvalQueued && result.meta?.approvalReview) {
          loggerWithTrace.info(
            { requestId: result.meta.approvalReview.requestId },
            'Approval interrupt returned files only; governance surfaces own visible review state',
          );
        } else {
          loggerWithTrace.info('Response sent');
        }
      } else if (approvalQueued && result.meta?.approvalReview) {
        loggerWithTrace.info(
          { requestId: result.meta.approvalReview.requestId },
          'Approval interrupt handled via governance surfaces without chat reply',
        );
      } else if (approvalQueued) {
        loggerWithTrace.info('Approval interrupt handled via governance surface; skipped chat reply');
      } else {
        loggerWithTrace.info(
          {
            hasFiles: files.length > 0,
            replyLength: 0,
          },
          'No response sent (empty reply)',
        );
      }
    } catch (err) {
      loggerWithTrace.error(err, 'Error handling message');

      try {
        await message.reply(
          buildRuntimeResponseCardPayload({
            text: buildMessageFailureText(),
            tone: 'error',
            allowedMentions: { repliedUser: false },
          }),
        );
      } catch {
        // Ignore send errors.
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

export function __resetMessageCreateHandlerStateForTests(): void {
  processedMessages.clear();
  delete globalScope[registrationKey];
  lastCleanupTime = Date.now();
  cachedWakeWords = null;
  cachedWakeWordPrefixes = null;
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

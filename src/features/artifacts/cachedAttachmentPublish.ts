import { PermissionsBitField, type Client, type Message, type TextBasedChannel } from 'discord.js';
import { normalizeBoundedInt } from '../../shared/utils/numbers';
import { client } from '../../platform/discord/client';
import { logger } from '../../platform/logging/logger';
import { filterChannelIdsByMemberAccess, type ChannelPermissionRequirement } from '../../platform/discord/channel-access';
import { requestDiscordInteractionForTool } from '../admin/adminActionService';
import {
  listIngestedAttachmentsByIds,
  type IngestedAttachmentRecord,
} from '../attachments/ingestedAttachmentRepo';

const CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY: ChannelPermissionRequirement[] = [
  { flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' },
  { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' },
];

function toInt(value: number | undefined, fallback: number, min: number, max: number): number {
  return normalizeBoundedInt(value, fallback, min, max);
}

function sanitizeUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function inferAttachmentType(record: IngestedAttachmentRecord): 'image' | 'file' {
  const contentType = record.contentType?.toLowerCase() ?? '';
  if (contentType.startsWith('image/')) {
    return 'image';
  }
  return record.extractor === 'vision' ? 'image' : 'file';
}

function hasStoredAttachmentText(record: IngestedAttachmentRecord): boolean {
  return typeof record.extractedText === 'string' && record.extractedText.length > 0;
}

function getAttachmentContentUnavailableGuidance(record: IngestedAttachmentRecord): string {
  const noun = inferAttachmentType(record) === 'image' ? 'image recall text' : 'attachment text';

  switch (record.status) {
    case 'queued':
      return `Stored ${noun} is queued for background processing.`;
    case 'processing':
      return `Stored ${noun} is still being generated.`;
    case 'error':
      return `Stored ${noun} is unavailable because extraction failed.`;
    case 'skip':
      return `Stored ${noun} is unavailable for this attachment.`;
    default:
      return `No stored ${noun} is available for this attachment.`;
  }
}

function buildStoredAttachmentPage(params: {
  record: IngestedAttachmentRecord;
  startChar: number;
  maxChars: number;
}) {
  if (!hasStoredAttachmentText(params.record)) {
    return {
      readable: false,
      content: null,
      startChar: 0,
      maxChars: params.maxChars,
      returnedChars: 0,
      totalChars: params.record.extractedTextChars,
      hasMore: false,
      nextStartChar: null,
      guidance: getAttachmentContentUnavailableGuidance(params.record),
    };
  }

  const extractedText = params.record.extractedText ?? '';
  const totalChars = extractedText.length;
  const boundedStart = Math.max(0, Math.min(params.startChar, totalChars));
  const endChar = Math.min(totalChars, boundedStart + params.maxChars);
  const content = extractedText.slice(boundedStart, endChar);
  const nextStartChar = endChar < totalChars ? endChar : null;

  return {
    readable: true,
    content,
    startChar: boundedStart,
    maxChars: params.maxChars,
    returnedChars: content.length,
    totalChars,
    hasMore: nextStartChar !== null,
    nextStartChar,
    guidance:
      nextStartChar !== null
        ? 'Call again with nextStartChar to continue paging stored attachment text.'
        : 'End of stored attachment text.',
  };
}

type MessageAttachmentLike = {
  url?: string | null;
  name?: string | null;
};

function normalizeAttachmentName(name: string | null | undefined): string {
  return typeof name === 'string' ? name.trim() : '';
}

function getAttachmentUrl(attachment: MessageAttachmentLike | undefined): string | null {
  return typeof attachment?.url === 'string' ? sanitizeUrl(attachment.url) : null;
}

async function resolveFreshAttachmentUrl(discordClient: Client, record: IngestedAttachmentRecord): Promise<string> {
  try {
    const channel = await discordClient.channels.fetch(record.channelId).catch(() => null);
    if (!channel || channel.isDMBased?.()) {
      return record.sourceUrl;
    }
    if ('guildId' in channel && channel.guildId !== record.guildId) {
      return record.sourceUrl;
    }
    if (!channel.isTextBased?.()) {
      return record.sourceUrl;
    }

    const message = await (channel as TextBasedChannel).messages.fetch(record.messageId).catch(() => null as Message | null);
    const attachmentList = Array.from(message?.attachments.values?.() ?? []);
    const recordSourceUrl = sanitizeUrl(record.sourceUrl);
    const recordFilename = normalizeAttachmentName(record.filename);

    const indexedAttachment = attachmentList[record.attachmentIndex];
    const indexedUrl = getAttachmentUrl(indexedAttachment);
    if (
      indexedUrl &&
      ((recordSourceUrl && indexedUrl === recordSourceUrl) ||
        (recordFilename && normalizeAttachmentName(indexedAttachment?.name) === recordFilename))
    ) {
      return indexedUrl;
    }

    if (recordSourceUrl) {
      const sourceMatch = attachmentList.find((attachment) => getAttachmentUrl(attachment) === recordSourceUrl);
      const sourceMatchUrl = getAttachmentUrl(sourceMatch);
      if (sourceMatchUrl) {
        return sourceMatchUrl;
      }
    }

    if (recordFilename) {
      const filenameMatches = attachmentList.filter(
        (attachment) => normalizeAttachmentName(attachment.name) === recordFilename,
      );
      if (filenameMatches.length === 1) {
        const filenameMatchUrl = getAttachmentUrl(filenameMatches[0]);
        if (filenameMatchUrl) {
          return filenameMatchUrl;
        }
      }
    }

    return record.sourceUrl;
  } catch (error) {
    logger.debug(
      { error, attachmentId: record.id, messageId: record.messageId },
      'Falling back to stored attachment source URL',
    );
    return record.sourceUrl;
  }
}

export async function sendCachedAttachment(params: {
  guildId: string | null | undefined;
  requesterUserId: string;
  requesterChannelId: string;
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  attachmentId: string;
  channelId?: string;
  content?: string;
  reason?: string;
  startChar?: number;
  maxChars?: number;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      attachmentId: params.attachmentId,
      content: 'Attachment resend is unavailable in DM context.',
      scope: 'guild_cached_files',
    };
  }

  const attachmentId = params.attachmentId.trim();
  if (!attachmentId) {
    throw new Error('attachmentId must not be empty');
  }

  const record = (await listIngestedAttachmentsByIds([attachmentId]))[0] ?? null;
  if (!record) {
    return {
      found: false,
      attachmentId,
      content: 'Attachment not found in cached file store.',
      scope: 'guild_cached_files',
    };
  }

  if (record.guildId !== params.guildId) {
    return {
      found: false,
      attachmentId,
      content: 'Attachment was found but does not belong to the current server context.',
      scope: 'guild_cached_files',
    };
  }

  const allowedSourceChannelIds = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: [record.channelId],
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  }).catch((error) => {
    logger.warn({ error, guildId: params.guildId, attachmentId }, 'Attachment source access checks failed (non-fatal)');
    return new Set<string>();
  });

  if (!allowedSourceChannelIds.has(record.channelId)) {
    return {
      found: false,
      attachmentId,
      content: 'Permission denied: you and the bot must have ViewChannel + ReadMessageHistory access to the source channel to resend this attachment.',
      scope: 'guild_cached_files',
    };
  }

  const targetChannelId = params.channelId?.trim() || params.requesterChannelId;
  const resolvedUrl = await resolveFreshAttachmentUrl(client, record);
  if (!resolvedUrl.trim()) {
    return {
      found: false,
      attachmentId,
      content: 'The cached attachment is missing a usable source URL, so it cannot be resent.',
      scope: 'guild_cached_files',
    };
  }

  const sendResult = await requestDiscordInteractionForTool({
    guildId: params.guildId,
    channelId: params.requesterChannelId,
    requestedBy: params.requesterUserId,
    invokedBy: params.invokedBy,
    request: {
      action: 'send_message',
      channelId: targetChannelId,
      content: params.content?.trim() || undefined,
      reason: params.reason?.trim() || undefined,
      files: [
        {
          filename: record.filename,
          contentType: record.contentType ?? undefined,
          source: {
            type: 'url',
            url: resolvedUrl,
          },
        },
      ],
    },
  });

  const page = buildStoredAttachmentPage({
    record,
    startChar: toInt(params.startChar, 0, 0, 50_000_000),
    maxChars: toInt(params.maxChars, 4_000, 200, 20_000),
  });

  return {
    found: true,
    attachmentId: record.id,
    attachmentRef: `attachment:${record.id}`,
    attachmentType: inferAttachmentType(record),
    sourceChannelId: record.channelId,
    targetChannelId,
    messageId: record.messageId,
    filename: record.filename,
    contentType: record.contentType,
    status: record.status,
    extractor: record.extractor,
    resendAvailable: true,
    sendResult,
    storedContentReadable: page.readable,
    storedContent: page.content,
    storedContentStartChar: page.startChar,
    storedContentReturnedChars: page.returnedChars,
    storedContentTotalChars: page.totalChars,
    storedContentHasMore: page.hasMore,
    storedContentNextStartChar: page.nextStartChar,
    storedContentGuidance: page.guidance,
    ...(record.errorText ? { errorText: record.errorText } : {}),
  };
}

import { Message } from 'discord.js';
import { LLMMessageContent } from '../../../platform/llm/llm-types';
import { estimateTokens } from '../../../features/agent-runtime/tokenEstimate';
import { config as appConfig } from '../../../platform/config/env';
import { FetchAttachmentResult } from '../../../platform/files/file-handler';
import { isPrivateOrLocalHostname } from '../../../platform/config/env';

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

const URL_PATTERN = /https?:\/\/[^\s<>()[\]{}"']+/gi;
const TRAILING_URL_PUNCTUATION_PATTERN = /[.,!?;:]+$/u;

function sanitizePublicHttpUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (isPrivateOrLocalHostname(parsed.hostname)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function getUrlExtension(url: string): string | null {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').pop() ?? '';
    const parts = lastSegment.split('.');
    if (parts.length < 2) {
      return null;
    }
    return parts.pop()?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function isLikelyImageUrl(url: string): boolean {
  const extension = getUrlExtension(url);
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
}

function trimTrailingUrlPunctuation(value: string): string {
  return value.replace(TRAILING_URL_PUNCTUATION_PATTERN, '');
}

export function isImageAttachment(attachment?: {
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

export function getMessageAttachments(message: Message) {
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

export function getImageAttachment(message: Message) {
  return getMessageAttachments(message).find((attachment) => isImageAttachment(attachment));
}

export function getNonImageAttachments(message: Message) {
  return getMessageAttachments(message).filter((attachment) => !isImageAttachment(attachment));
}

export function getVisionImageUrl(message: Message): string | null {
  const attachment = getImageAttachment(message);
  if (attachment?.url) {
    const sanitized = sanitizePublicHttpUrl(attachment.url);
    if (sanitized) {
      return sanitized;
    }
  }

  const stickers = (message as unknown as { stickers?: unknown }).stickers;
  if (stickers && typeof (stickers as { values?: unknown }).values === 'function') {
    try {
      for (const sticker of (stickers as { values: () => Iterable<unknown> }).values()) {
        const urlCandidate = (sticker as { url?: unknown }).url;
        if (typeof urlCandidate !== 'string') continue;
        const sanitized = sanitizePublicHttpUrl(urlCandidate);
        if (!sanitized) continue;
        if (isLikelyImageUrl(sanitized)) {
          return sanitized;
        }
      }
    } catch {
      // Ignore sticker iteration errors.
    }
  }

  const embeds = (message as unknown as { embeds?: unknown[] }).embeds;
  if (Array.isArray(embeds)) {
    for (const embed of embeds) {
      const urlCandidate =
        (embed as { image?: { url?: unknown } }).image?.url ??
        (embed as { thumbnail?: { url?: unknown } }).thumbnail?.url;
      if (typeof urlCandidate !== 'string') continue;
      const sanitized = sanitizePublicHttpUrl(urlCandidate);
      if (sanitized) {
        return sanitized;
      }
    }
  }

  const content = message.content ?? '';
  const matches = content.match(URL_PATTERN) ?? [];
  for (const match of matches) {
    const sanitized = sanitizePublicHttpUrl(trimTrailingUrlPunctuation(match));
    if (!sanitized) continue;
    if (isLikelyImageUrl(sanitized)) {
      return sanitized;
    }
  }

  return null;
}

export function buildMessageContent(
  message: Message,
  options?: { prefix?: string; allowEmpty?: boolean; textOverride?: string },
): LLMMessageContent | null {
  const prefix = options?.prefix ?? '';
  const text = options?.textOverride ?? message.content ?? '';
  const combinedText = `${prefix}${text}`;
  const imageUrl = getVisionImageUrl(message);
  const hasImage = typeof imageUrl === 'string' && imageUrl.length > 0;

  if (!hasImage) {
    if (!options?.allowEmpty && combinedText.trim().length === 0) {
      return null;
    }
    return combinedText;
  }

  const textPart = combinedText.trim().length > 0 ? combinedText : ' ';
  return [
    { type: 'text', text: textPart },
    { type: 'image_url', image_url: { url: imageUrl } },
  ];
}

export function appendAttachmentToText(baseText: string, attachmentBlock: string | null): string {
  if (!attachmentBlock) {
    return baseText;
  }
  const separator = baseText.trim().length > 0 ? '\n\n' : '';
  return `${baseText}${separator}${attachmentBlock}`;
}

export function appendAttachmentBlocksToText(baseText: string, attachmentBlocks: string[]): string {
  if (attachmentBlocks.length === 0) {
    return baseText;
  }
  return appendAttachmentToText(baseText, attachmentBlocks.join('\n\n'));
}

export function formatAttachmentBlock(
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

export function deriveAttachmentBudget(params: {
  baseText: string;
}): { maxChars: number; maxBytes: number } {
  const contextUserMaxTokens = Number.isFinite(appConfig.CONTEXT_USER_MAX_TOKENS)
    ? Math.max(0, appConfig.CONTEXT_USER_MAX_TOKENS)
    : 0;
  const charsPerToken = Number.isFinite(appConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN)
    ? Math.max(1, appConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN)
    : 4;
  const availableTokens = Math.max(
    0,
    contextUserMaxTokens - estimateTokens(params.baseText),
  );
  const maxChars = Math.max(
    0,
    Math.floor(availableTokens * charsPerToken),
  );
  const maxBytes = Math.max(0, Math.floor(maxChars * 4));
  return { maxChars, maxBytes };
}

function formatBytes(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function buildAttachmentBlockFromResult(
  filename: string,
  result: FetchAttachmentResult,
  contentType?: string | null,
  options?: { sizeBytes?: number | null; includeSkipped?: boolean },
): string | null {
  if (result.kind === 'skip' && !options?.includeSkipped) {
    return null;
  }

  const notes: string[] = [];
  const resolvedMimeType = result.mimeType ?? contentType ?? null;
  const extractor = result.extractor !== 'none' ? result.extractor : null;
  const declaredSize = formatBytes(options?.sizeBytes);
  const readSize = formatBytes(result.byteLength);

  const metadataBits: string[] = [];
  if (resolvedMimeType) metadataBits.push(`mime=${resolvedMimeType}`);
  if (extractor) metadataBits.push(`extractor=${extractor}`);
  if (declaredSize) metadataBits.push(`declared_size=${declaredSize}`);
  if (readSize) metadataBits.push(`read_size=${readSize}`);
  if (metadataBits.length > 0) {
    notes.push(`[System: Attachment metadata: ${metadataBits.join(', ')}.]`);
  }

  if (result.kind === 'truncated') {
    notes.push(result.message);
  }

  if (resolvedMimeType?.toLowerCase().startsWith('application/octet-stream')) {
    notes.push(
      '(System Note: Attachment content-type was application/octet-stream; treated as text based on file extension.)',
    );
  }

  if (result.kind === 'skip') {
    return formatAttachmentBlock(filename, result.reason, notes);
  }

  if (result.kind === 'too_large' || result.kind === 'error') {
    return formatAttachmentBlock(filename, result.message, notes);
  }

  return formatAttachmentBlock(filename, result.text, notes);
}

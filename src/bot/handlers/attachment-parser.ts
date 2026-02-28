import { Message } from 'discord.js';
import { LLMMessageContent } from '../../core/llm/llm-types';
import { estimateTokens } from '../../core/agentRuntime/tokenEstimate';
import { config as appConfig } from '../../config';
import { FetchAttachmentResult } from '../../core/utils/file-handler';

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

export function buildMessageContent(
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
  const availableTokens = Math.max(
    0,
    appConfig.CONTEXT_USER_MAX_TOKENS - estimateTokens(params.baseText),
  );
  const maxChars = Math.max(
    0,
    Math.floor(availableTokens * appConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN),
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

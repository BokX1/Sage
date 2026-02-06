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
const TRANSCRIPT_HEADER = 'Recent channel transcript (most recent last):';

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

export function getNonImageAttachment(message: Message) {
  return getMessageAttachments(message).find((attachment) => !isImageAttachment(attachment));
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

export function deriveAttachmentLimits(params: {
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

export function buildAttachmentBlockFromResult(
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

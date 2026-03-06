import { ChannelMessage } from './awareness-types';

/**
 * Build a transcript block from recent channel messages.
 *
 * Details: formats messages from oldest to newest and respects the character
 * budget, returning null if nothing fits.
 *
 * Side effects: none.
 * Error behavior: none.
 *
 * @param messages - Recent messages in chronological order.
 * @param maxChars - Maximum length of the returned block.
 * @returns Transcript block or null when it would be empty.
 */
export function buildTranscriptBlock(messages: ChannelMessage[], maxChars: number): string | null {
  if (messages.length === 0) return null;

  const header =
    'Recent channel transcript (most recent last). Reference lines by [#] or msg:<id>:';
  if (header.length >= maxChars) return null;

  const selected: Array<{ message: ChannelMessage; normalizedContent: string }> = [];
  let totalChars = header.length;

  const placeholderIndexLabel = '#000000';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const normalizedContent = message.content.replace(/\s+/g, ' ').trim();
    const placeholderLine =
      `- [${placeholderIndexLabel} msg:${message.messageId}] ` +
      `@${message.authorDisplayName} (user:${message.authorId}) ` +
      `[${message.timestamp.toISOString()}]: ${normalizedContent}`;
    const nextTotal = totalChars + 1 + placeholderLine.length;
    if (nextTotal > maxChars) {
      break;
    }
    selected.push({ message, normalizedContent });
    totalChars = nextTotal;
  }

  if (selected.length === 0) return null;

  selected.reverse();
  const lines = selected.map(({ message, normalizedContent }, index) => {
    return (
      `- [#${index + 1} msg:${message.messageId}] ` +
      `@${message.authorDisplayName} (user:${message.authorId}) ` +
      `[${message.timestamp.toISOString()}]: ${normalizedContent}`
    );
  });

  return `${header}\n${lines.join('\n')}`;
}

import { ChannelMessage } from './types';

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

  const header = 'Recent channel transcript (most recent last):';
  if (header.length >= maxChars) return null;

  const lines: string[] = [];
  let totalChars = header.length;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const line = `- @${message.authorDisplayName} (id:${message.authorId}) [${message.timestamp.toISOString()}]: ${message.content}`;
    const nextTotal = totalChars + 1 + line.length;
    if (nextTotal > maxChars) {
      break;
    }
    lines.push(line);
    totalChars = nextTotal;
  }

  if (lines.length === 0) return null;

  return `${header}\n${lines.reverse().join('\n')}`;
}

import { ChannelMessage } from './types';

export function buildTranscriptBlock(
    messages: ChannelMessage[],
    maxChars: number,
): string | null {
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

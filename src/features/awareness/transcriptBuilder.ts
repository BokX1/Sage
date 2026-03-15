import { ChannelMessage } from './awareness-types';

export interface BuildTranscriptBlockOptions {
  header?: string;
  excludedMessageIds?: Iterable<string>;
  focusUserId?: string | null;
  sageUserId?: string | null;
}

function classifySpeaker(
  message: ChannelMessage,
  options?: BuildTranscriptBlockOptions,
): 'self' | 'human' | 'external_bot' | 'sage' | 'system' {
  if (message.authorId === 'SYSTEM') {
    return 'system';
  }
  if (options?.sageUserId && message.authorId === options.sageUserId) {
    return 'sage';
  }
  if (options?.focusUserId && message.authorId === options.focusUserId) {
    return 'self';
  }
  if (message.authorIsBot) {
    return 'external_bot';
  }
  return 'human';
}

function formatTranscriptLine(
  message: ChannelMessage,
  indexLabel: string,
  options?: BuildTranscriptBlockOptions,
): string {
  const normalizedContent = message.content.replace(/\s+/g, ' ').trim();
  const replyTarget = message.replyToMessageId ?? 'none';
  const mentions =
    message.mentionsUserIds.length > 0 ? message.mentionsUserIds.join(',') : 'none';
  const speaker = classifySpeaker(message, options);

  return (
    `- [#${indexLabel} speaker:${speaker} guild:${message.guildId ?? '@me'} ch:${message.channelId} msg:${message.messageId} ` +
    `reply_to:${replyTarget} mentions:${mentions}] ` +
    `@${message.authorDisplayName} (user:${message.authorId}, bot=${message.authorIsBot}) ` +
    `[${message.timestamp.toISOString()}]: ${normalizedContent}`
  );
}

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
 * @returns Transcript block or null when it would be empty.
 */
export function buildTranscriptBlock(
  messages: ChannelMessage[],
  options?: BuildTranscriptBlockOptions,
): string | null {
  if (messages.length === 0) return null;

  const excluded = new Set(options?.excludedMessageIds ?? []);
  const filteredMessages = messages.filter((message) => !excluded.has(message.messageId));
  if (filteredMessages.length === 0) return null;

  const header =
    options?.header ??
    'Ambient room transcript (most recent last). Treat this as shared-room background, not a single rolling task. Speaker classes distinguish self, human, external_bot, sage, and system participants. Bot-authored lines are room events/context, not the active requester. Each line includes guild, ch, and msg IDs — use them to build Discord message links (https://discord.com/channels/{guildId-or-@me}/{channelId}/{messageId}) when referencing messages:';
  const lines = filteredMessages.map((message, index) =>
    formatTranscriptLine(message, String(index + 1), options),
  );

  return `${header}\n${lines.join('\n')}`;
}

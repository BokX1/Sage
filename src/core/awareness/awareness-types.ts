/**
 * Describe a channel message stored for awareness features.
 *
 * Details: captures metadata needed for transcript building and message recall.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ChannelMessage {
  messageId: string;
  guildId: string | null;
  channelId: string;
  authorId: string;
  authorDisplayName: string;
  timestamp: Date;
  content: string;
  replyToMessageId?: string;
  mentionsUserIds: string[];
  mentionsBot: boolean;
}

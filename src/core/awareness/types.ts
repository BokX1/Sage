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

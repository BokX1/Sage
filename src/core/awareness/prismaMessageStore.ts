import { prisma } from '../../db/client';
import { MessageStore } from './messageStore';
import { ChannelMessage } from './types';

type PrismaChannelMessageClient = {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    findMany: (args: {
        where: Record<string, unknown>;
        orderBy: { timestamp: 'asc' | 'desc' };
        take: number;
    }) => Promise<Record<string, unknown>[]>;
    deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
};

function getChannelMessageClient(): PrismaChannelMessageClient {
    return (prisma as unknown as { channelMessage: PrismaChannelMessageClient }).channelMessage;
}

export class PrismaMessageStore implements MessageStore {
    async append(message: ChannelMessage): Promise<void> {
        const channelMessage = getChannelMessageClient();
        await channelMessage.create({
            data: {
                messageId: message.messageId,
                guildId: message.guildId,
                channelId: message.channelId,
                authorId: message.authorId,
                authorDisplayName: message.authorDisplayName,
                timestamp: message.timestamp,
                content: message.content,
                replyToMessageId: message.replyToMessageId ?? null,
                mentionsUserIds: message.mentionsUserIds,
                mentionsBot: message.mentionsBot,
            },
        });
    }

    async fetchRecent(params: {
        guildId: string | null;
        channelId: string;
        limit: number;
        sinceMs?: number;
    }): Promise<ChannelMessage[]> {
        const channelMessage = getChannelMessageClient();
        const where: Record<string, unknown> = {
            guildId: params.guildId,
            channelId: params.channelId,
        };
        if (params.sinceMs) {
            where.timestamp = { gte: new Date(params.sinceMs) };
        }

        const rows = await channelMessage.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: params.limit,
        });

        return rows
            .reverse()
            .map((row) => ({
            messageId: row.messageId as string,
            guildId: row.guildId as string | null,
            channelId: row.channelId as string,
            authorId: row.authorId as string,
            authorDisplayName: row.authorDisplayName as string,
            timestamp: row.timestamp as Date,
            content: row.content as string,
            replyToMessageId: (row.replyToMessageId as string | null) ?? undefined,
            mentionsUserIds: (row.mentionsUserIds as string[]) ?? [],
            mentionsBot: row.mentionsBot as boolean,
        }));
    }

    async deleteOlderThan(cutoffMs: number): Promise<number> {
        const channelMessage = getChannelMessageClient();
        const result = await channelMessage.deleteMany({
            where: { timestamp: { lt: new Date(cutoffMs) } },
        });
        return result.count;
    }
}

import { prisma } from '../../db/client';
import { MessageStore } from './messageStore';
import { ChannelMessage } from './types';

type PrismaChannelMessageClient = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  upsert: (args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<unknown>;
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy: { timestamp: 'asc' | 'desc' };
    take: number;
    skip?: number;
    select?: Record<string, boolean>;
  }) => Promise<Record<string, unknown>[]>;
  deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
};

function getChannelMessageClient(): PrismaChannelMessageClient {
  return (prisma as unknown as { channelMessage: PrismaChannelMessageClient }).channelMessage;
}

/**
 * Persist awareness messages in Prisma-backed storage.
 *
 * Details: reads and writes channel messages using the Prisma client.
 *
 * Side effects: performs database reads and writes.
 * Error behavior: propagates Prisma errors.
 */
export class PrismaMessageStore implements MessageStore {
  private static readonly PRUNE_BATCH_SIZE = 1000;

  /**
   * Upsert a channel message in the database.
   *
   * Details: overwrites existing records with the same message ID.
   *
   * Side effects: writes to the database.
   * Error behavior: propagates Prisma errors.
   *
   * @param message - Message to persist.
   */
  async append(message: ChannelMessage): Promise<void> {
    const channelMessage = getChannelMessageClient();
    const data = {
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
    };

    await channelMessage.upsert({
      where: { messageId: message.messageId },
      create: data,
      update: data,
    });
  }

  /**
   * Fetch recent channel messages from the database.
   *
   * Details: returns messages ordered from oldest to newest.
   *
   * Side effects: reads from the database.
   * Error behavior: propagates Prisma errors.
   *
   * @param params - Channel selector and retrieval limits.
   * @returns Recent messages in chronological order.
   */
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

    return rows.reverse().map((row) => ({
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

  /**
   * Delete messages older than the cutoff timestamp.
   *
   * Details: removes all records with timestamps earlier than the cutoff.
   *
   * Side effects: deletes from the database.
   * Error behavior: propagates Prisma errors.
   *
   * @param cutoffMs - Unix epoch cutoff in milliseconds.
   * @returns Count of deleted messages.
   */
  async deleteOlderThan(cutoffMs: number): Promise<number> {
    const channelMessage = getChannelMessageClient();
    const result = await channelMessage.deleteMany({
      where: { timestamp: { lt: new Date(cutoffMs) } },
    });
    return result.count;
  }

  /**
   * Prune a channel history down to a maximum number of messages.
   *
   * Details: deletes the oldest messages in batches until the limit is met.
   *
   * Side effects: deletes from the database.
   * Error behavior: propagates Prisma errors.
   *
   * @param params - Channel selector and retention limit.
   * @returns Count of deleted messages.
   */
  async pruneChannelToLimit(params: {
    guildId: string | null;
    channelId: string;
    limit: number;
  }): Promise<number> {
    if (params.limit <= 0) {
      return 0;
    }

    const channelMessage = getChannelMessageClient();
    const where = {
      guildId: params.guildId,
      channelId: params.channelId,
    };
    let removedTotal = 0;

    while (true) {
      const rows = await channelMessage.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: params.limit,
        select: { messageId: true },
        take: PrismaMessageStore.PRUNE_BATCH_SIZE,
      });

      if (rows.length === 0) {
        break;
      }

      const result = await channelMessage.deleteMany({
        where: {
          guildId: params.guildId,
          channelId: params.channelId,
          messageId: {
            in: rows.map((row) => row.messageId as string),
          },
        },
      });
      removedTotal += result.count;

      if (rows.length < PrismaMessageStore.PRUNE_BATCH_SIZE) {
        break;
      }
    }

    return removedTotal;
  }
}

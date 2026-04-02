import { z } from 'zod';
import { prisma } from '../../../platform/db/prisma-client';
import { assertReadableChannelAccess, defineBridgeMethod } from './common';

function formatMessageRow(row: {
  messageId: string;
  guildId: string | null;
  channelId: string;
  authorId: string;
  authorDisplayName: string;
  authorIsBot: boolean;
  timestamp: Date;
  content: string;
  replyToMessageId: string | null;
}) {
  return {
    messageId: row.messageId,
    guildId: row.guildId,
    channelId: row.channelId,
    authorId: row.authorId,
    authorDisplayName: row.authorDisplayName,
    authorIsBot: row.authorIsBot,
    timestamp: row.timestamp.toISOString(),
    content: row.content,
    replyToMessageId: row.replyToMessageId,
  };
}

export const historyDomainMethods = [
  defineBridgeMethod({
    namespace: 'history',
    method: 'get',
    input: z.object({
      messageId: z.string().trim().min(1),
      channelId: z.string().trim().min(1),
    }),
    mutability: 'read',
    async execute(args, context) {
      await assertReadableChannelAccess({
        toolContext: context.toolContext,
        channelIds: [args.channelId],
      });
      const row = await prisma.channelMessage.findUnique({
        where: { messageId: args.messageId },
      });
      if (!row || row.channelId !== args.channelId) {
        return null;
      }
      return formatMessageRow(row);
    },
  }),
  defineBridgeMethod({
    namespace: 'history',
    method: 'recent',
    input: z.object({
      channelId: z.string().trim().min(1),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    mutability: 'read',
    async execute(args, context) {
      await assertReadableChannelAccess({
        toolContext: context.toolContext,
        channelIds: [args.channelId],
      });
      const rows = await prisma.channelMessage.findMany({
        where: {
          channelId: args.channelId,
          guildId: context.toolContext.guildId ?? undefined,
        },
        orderBy: { timestamp: 'desc' },
        take: args.limit ?? 25,
      });
      return {
        channelId: args.channelId,
        items: rows.reverse().map(formatMessageRow),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'history',
    method: 'search',
    input: z.object({
      query: z.string().trim().min(1).max(500),
      channelId: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    mutability: 'read',
    async execute(args, context) {
      const rows = await prisma.channelMessage.findMany({
        where: {
          guildId: context.toolContext.guildId ?? undefined,
          ...(args.channelId ? { channelId: args.channelId } : {}),
          content: {
            contains: args.query,
            mode: 'insensitive',
          },
        },
        orderBy: { timestamp: 'desc' },
        take: args.limit ?? 25,
      });
      const channelIds = Array.from(new Set(rows.map((row) => row.channelId)));
      if (channelIds.length > 0) {
        await assertReadableChannelAccess({
          toolContext: context.toolContext,
          channelIds,
        });
      }
      return {
        query: args.query,
        items: rows.map(formatMessageRow),
      };
    },
  }),
];

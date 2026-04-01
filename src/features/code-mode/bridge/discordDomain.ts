import { z } from 'zod';
import { client } from '../../../platform/discord/client';
import { prisma } from '../../../platform/db/prisma-client';
import {
  assertBridgeAccess,
  assertReadableChannelAccess,
  buildBridgeMethod,
  fetchGuildChannel,
  fetchGuildFromContext,
  fetchWritableTextChannel,
  requireGuildId,
} from './common';

function formatStoredMessage(row: {
  messageId: string;
  guildId: string | null;
  channelId: string;
  authorId: string;
  authorDisplayName: string;
  authorIsBot: boolean;
  timestamp: Date;
  content: string;
  replyToMessageId: string | null;
  mentionsUserIds: unknown;
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
    mentionsUserIds: Array.isArray(row.mentionsUserIds) ? row.mentionsUserIds : [],
  };
}

export const discordDomainMethods = [
  buildBridgeMethod({
    namespace: 'discord',
    method: 'channels.get',
    input: z.object({
      channelId: z.string().trim().min(1),
    }),
    mutability: 'read',
    async execute(args, context) {
      await assertReadableChannelAccess({
        toolContext: context.toolContext,
        channelIds: [args.channelId],
      });
      const channel = await fetchGuildChannel({
        toolContext: context.toolContext,
        channelId: args.channelId,
      });
      return {
        id: channel.id,
        guildId: 'guildId' in channel ? channel.guildId ?? null : null,
        name: 'name' in channel ? channel.name ?? null : null,
        type: channel.type,
        parentId: 'parentId' in channel ? channel.parentId ?? null : null,
        isTextBased: channel.isTextBased?.() ?? false,
      };
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'channels.list',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
    }),
    mutability: 'read',
    async execute(args, context) {
      const guild = await client.guilds.fetch(args.guildId ?? requireGuildId(context.toolContext));
      const channels = await guild.channels.fetch();
      const items = Array.from(channels.values())
        .filter((channel): channel is NonNullable<typeof channel> => Boolean(channel))
        .map((channel) => ({
          id: channel.id,
          name: 'name' in channel ? channel.name ?? null : null,
          type: channel.type,
          parentId: 'parentId' in channel ? channel.parentId ?? null : null,
          isTextBased: channel.isTextBased?.() ?? false,
        }));
      return items;
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'messages.get',
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
      return formatStoredMessage(row);
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'messages.list',
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
      return rows.reverse().map(formatStoredMessage);
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'messages.search',
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
      return rows.map(formatStoredMessage);
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'messages.send',
    input: z.object({
      channelId: z.string().trim().min(1),
      content: z.string().trim().min(1).max(4_000),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const channel = await fetchWritableTextChannel({
        toolContext: context.toolContext,
        channelId: args.channelId,
      });
      const sent = await channel.send(args.content);
      return {
        messageId: sent.id,
        channelId: args.channelId,
        content: sent.content,
        createdAt: sent.createdAt.toISOString(),
      };
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'messages.reply',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageId: z.string().trim().min(1),
      content: z.string().trim().min(1).max(4_000),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const channel = await fetchWritableTextChannel({
        toolContext: context.toolContext,
        channelId: args.channelId,
      });
      if (!('messages' in channel) || !channel.messages) {
        throw new Error('This channel does not support replies.');
      }
      const target = await channel.messages.fetch(args.messageId).catch(() => null);
      if (!target) {
        throw new Error('Reply target message not found.');
      }
      const sent = await target.reply(args.content);
      return {
        messageId: sent.id,
        replyToMessageId: args.messageId,
        channelId: args.channelId,
        content: sent.content,
        createdAt: sent.createdAt.toISOString(),
      };
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'reactions.add',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageId: z.string().trim().min(1),
      emoji: z.string().trim().min(1).max(100),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const channel = await fetchWritableTextChannel({
        toolContext: context.toolContext,
        channelId: args.channelId,
      });
      if (!('messages' in channel) || !channel.messages) {
        throw new Error('This channel does not support reactions.');
      }
      const target = await channel.messages.fetch(args.messageId).catch(() => null);
      if (!target) {
        throw new Error('Target message not found.');
      }
      await target.react(args.emoji);
      return { ok: true };
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'members.get',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      userId: z.string().trim().min(1),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const guild = await client.guilds.fetch(args.guildId ?? requireGuildId(context.toolContext));
      const member = await guild.members.fetch(args.userId).catch(() => null);
      if (!member) {
        return null;
      }
      return {
        id: member.id,
        displayName: member.displayName,
        joinedAt: member.joinedAt?.toISOString() ?? null,
        roles: member.roles.cache.map((role) => ({ id: role.id, name: role.name })),
      };
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'roles.add',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      userId: z.string().trim().min(1),
      roleId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const guild = await fetchGuildFromContext({
        ...context.toolContext,
        guildId: args.guildId ?? context.toolContext.guildId,
      });
      const member = await guild.members.fetch(args.userId).catch(() => null);
      if (!member) {
        throw new Error('Member not found.');
      }
      await member.roles.add(args.roleId);
      return { ok: true, userId: args.userId, roleId: args.roleId };
    },
  }),
  buildBridgeMethod({
    namespace: 'discord',
    method: 'roles.remove',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      userId: z.string().trim().min(1),
      roleId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const guild = await fetchGuildFromContext({
        ...context.toolContext,
        guildId: args.guildId ?? context.toolContext.guildId,
      });
      const member = await guild.members.fetch(args.userId).catch(() => null);
      if (!member) {
        throw new Error('Member not found.');
      }
      await member.roles.remove(args.roleId);
      return { ok: true, userId: args.userId, roleId: args.roleId };
    },
  }),
];

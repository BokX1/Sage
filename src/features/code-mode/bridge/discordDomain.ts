import { PermissionsBitField, ThreadAutoArchiveDuration, type GuildBasedChannel } from 'discord.js';
import { z } from 'zod';
import { client } from '../../../platform/discord/client';
import { filterChannelIdsByMemberAccess } from '../../../platform/discord/channel-access';
import {
  assertBridgeAccess,
  assertReadableChannelAccess,
  defineBridgeMethod,
  fetchGuildChannel,
  fetchGuildFromContext,
  fetchWritableTextChannel,
  requireGuildId,
} from './common';

const READ_HISTORY_REQUIREMENTS = [
  { flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' },
  { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' },
];

type GuildRoleLike = {
  id: string;
  name: string;
  color?: number;
  hexColor?: string;
  position?: number;
  managed?: boolean;
  mentionable?: boolean;
  hoist?: boolean;
};

type GuildMessageReactionLike = {
  emoji: {
    identifier?: string | null;
    name?: string | null;
    id?: string | null;
  };
  users: {
    remove: (userId: string) => Promise<unknown>;
  };
};

type GuildMessageLike = {
  id: string;
  channelId?: string;
  content: string;
  createdAt: Date;
  author?: {
    id?: string;
  };
  reply: (payload: string | { content: string }) => Promise<GuildMessageLike>;
  edit: (payload: string | { content: string }) => Promise<GuildMessageLike>;
  react: (emoji: string) => Promise<unknown>;
  startThread: (args: {
    name: string;
    autoArchiveDuration?: ThreadAutoArchiveDuration;
    reason?: string;
  }) => Promise<GuildThreadLike>;
  reactions?: {
    resolve?: (emoji: string) => GuildMessageReactionLike | null | undefined;
    fetch?: (emoji: string) => Promise<GuildMessageReactionLike>;
    cache?: {
      values: () => IterableIterator<GuildMessageReactionLike>;
    };
  };
};

type GuildTextChannelLike = GuildBasedChannel & {
  send: (payload: string | { content: string }) => Promise<GuildMessageLike>;
  messages: {
    fetch: (messageId: string) => Promise<GuildMessageLike>;
  };
  threads?: {
    create: (args: {
      name: string;
      autoArchiveDuration?: ThreadAutoArchiveDuration;
      reason?: string;
    }) => Promise<GuildThreadLike>;
  };
};

type GuildThreadLike = GuildBasedChannel & {
  id: string;
  guildId?: string;
  parentId?: string | null;
  name?: string;
  archived?: boolean;
  locked?: boolean;
  autoArchiveDuration?: number;
  join?: () => Promise<unknown>;
  leave?: () => Promise<unknown>;
  members?: {
    add: (userId: string) => Promise<unknown>;
    remove: (userId: string) => Promise<unknown>;
  };
  setName?: (name: string, reason?: string) => Promise<GuildThreadLike>;
  setArchived?: (archived?: boolean, reason?: string) => Promise<GuildThreadLike>;
  setLocked?: (locked?: boolean, reason?: string) => Promise<GuildThreadLike>;
  setAutoArchiveDuration?: (minutes: ThreadAutoArchiveDuration, reason?: string) => Promise<GuildThreadLike>;
};

function asTextChannel(channel: GuildBasedChannel, channelId: string): GuildTextChannelLike {
  const candidate = channel as Partial<GuildTextChannelLike>;
  if (
    !channel.isTextBased?.() ||
    typeof candidate.send !== 'function' ||
    !candidate.messages ||
    typeof candidate.messages.fetch !== 'function'
  ) {
    throw new Error(`Channel "${channelId}" does not support text message operations.`);
  }
  return channel as GuildTextChannelLike;
}

function asThreadChannel(channel: GuildBasedChannel, threadId: string): GuildThreadLike {
  const candidate = channel as Partial<GuildThreadLike> & { isThread?: () => boolean };
  if (typeof candidate.isThread === 'function' && !candidate.isThread()) {
    throw new Error(`Channel "${threadId}" is not a thread.`);
  }
  if (
    typeof candidate.join !== 'function' ||
    typeof candidate.leave !== 'function' ||
    typeof candidate.setArchived !== 'function'
  ) {
    throw new Error(`Channel "${threadId}" does not support thread operations.`);
  }
  return channel as GuildThreadLike;
}

function serializeMessage(message: GuildMessageLike, channelId: string, extra?: Record<string, unknown>) {
  return {
    messageId: message.id,
    channelId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    ...(extra ?? {}),
  };
}

function serializeThread(thread: GuildThreadLike) {
  return {
    threadId: thread.id,
    guildId: thread.guildId ?? null,
    parentId: thread.parentId ?? null,
    name: thread.name ?? null,
    archived: thread.archived ?? null,
    locked: thread.locked ?? null,
    autoArchiveDurationMinutes: thread.autoArchiveDuration ?? null,
  };
}

function serializeRole(role: GuildRoleLike) {
  return {
    roleId: role.id,
    name: role.name,
    color: role.color ?? null,
    hexColor: role.hexColor ?? null,
    position: role.position ?? null,
    managed: role.managed ?? false,
    mentionable: role.mentionable ?? false,
    hoist: role.hoist ?? false,
  };
}

function normalizeEmojiIdentifier(rawEmoji: string): string {
  const trimmed = rawEmoji.trim();
  const custom = trimmed.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);
  if (!custom) {
    return trimmed;
  }
  return `${custom[1]}:${custom[2]}`;
}

async function fetchMessageForOperation(params: {
  toolContext: Parameters<typeof fetchWritableTextChannel>[0]['toolContext'];
  channelId: string;
  messageId: string;
}): Promise<{ channel: GuildTextChannelLike; message: GuildMessageLike }> {
  const channel = asTextChannel(
    await fetchWritableTextChannel({
      toolContext: params.toolContext,
      channelId: params.channelId,
    }),
    params.channelId,
  );
  const message = await channel.messages.fetch(params.messageId).catch(() => null);
  if (!message) {
    throw new Error(`Message "${params.messageId}" was not found.`);
  }
  return { channel, message };
}

async function fetchThreadForOperation(params: {
  toolContext: Parameters<typeof fetchGuildChannel>[0]['toolContext'];
  threadId: string;
}): Promise<GuildThreadLike> {
  const channel = await fetchGuildChannel({
    toolContext: params.toolContext,
    channelId: params.threadId,
  });
  return asThreadChannel(channel, params.threadId);
}

async function findMessageReaction(message: GuildMessageLike, emoji: string): Promise<GuildMessageReactionLike | null> {
  const normalized = normalizeEmojiIdentifier(emoji);
  const resolved = message.reactions?.resolve?.(normalized);
  if (resolved) {
    return resolved;
  }
  const fromCache = message.reactions?.cache
    ? Array.from(message.reactions.cache.values()).find((entry) =>
        [entry.emoji.identifier, entry.emoji.id ? `${entry.emoji.name}:${entry.emoji.id}` : null, entry.emoji.name]
          .filter((value): value is string => typeof value === 'string')
          .includes(normalized),
      )
    : null;
  if (fromCache) {
    return fromCache;
  }
  if (typeof message.reactions?.fetch === 'function') {
    return await message.reactions.fetch(normalized).catch(() => null);
  }
  return null;
}

async function listAccessibleChannels(params: {
  guildId: string;
  userId: string;
  channelIds: string[];
}) {
  return filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.userId,
    channelIds: params.channelIds,
    requirements: READ_HISTORY_REQUIREMENTS,
  });
}

export const discordDomainMethods = [
  defineBridgeMethod({
    namespace: 'discord',
    method: 'channels.get',
    summary: 'Read basic metadata for one visible Discord channel.',
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
  defineBridgeMethod({
    namespace: 'discord',
    method: 'channels.list',
    summary: 'List Discord channels the current actor can see in the active guild.',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
    }),
    mutability: 'read',
    async execute(args, context) {
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      const allItems = Array.from(channels.values()).filter((channel): channel is NonNullable<typeof channel> => Boolean(channel));
      const allowedIds = await listAccessibleChannels({
        guildId,
        userId: context.toolContext.userId,
        channelIds: allItems.map((channel) => channel.id),
      });
      return allItems
        .filter((channel) => allowedIds.has(channel.id))
        .map((channel) => ({
          id: channel.id,
          name: 'name' in channel ? channel.name ?? null : null,
          type: channel.type,
          parentId: 'parentId' in channel ? channel.parentId ?? null : null,
          isTextBased: channel.isTextBased?.() ?? false,
        }));
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'messages.send',
    summary: 'Send a new message to a writable Discord channel.',
    input: z.object({
      channelId: z.string().trim().min(1),
      content: z.string().trim().min(1).max(4_000),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const channel = asTextChannel(
        await fetchWritableTextChannel({
          toolContext: context.toolContext,
          channelId: args.channelId,
        }),
        args.channelId,
      );
      const sent = await channel.send(args.content);
      return serializeMessage(sent, args.channelId);
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'messages.reply',
    summary: 'Reply to an existing Discord message in a writable channel.',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageId: z.string().trim().min(1),
      content: z.string().trim().min(1).max(4_000),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const { message } = await fetchMessageForOperation({
        toolContext: context.toolContext,
        channelId: args.channelId,
        messageId: args.messageId,
      });
      const sent = await message.reply(args.content);
      return serializeMessage(sent, args.channelId, {
        replyToMessageId: args.messageId,
      });
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'messages.edit',
    summary: 'Edit a Sage-authored Discord message in a writable channel.',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageId: z.string().trim().min(1),
      content: z.string().trim().min(1).max(4_000),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const botUserId = client.user?.id?.trim();
      if (!botUserId) {
        throw new Error('Sage bot identity is unavailable.');
      }
      const { message } = await fetchMessageForOperation({
        toolContext: context.toolContext,
        channelId: args.channelId,
        messageId: args.messageId,
      });
      if (message.author?.id !== botUserId) {
        throw new Error('discord.messages.edit only supports Sage-authored messages.');
      }
      const edited = await message.edit(args.content);
      return serializeMessage(edited, args.channelId, {
        editedMessageId: args.messageId,
      });
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'reactions.add',
    summary: 'Add a reaction to a Discord message.',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageId: z.string().trim().min(1),
      emoji: z.string().trim().min(1).max(100),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const { message } = await fetchMessageForOperation({
        toolContext: context.toolContext,
        channelId: args.channelId,
        messageId: args.messageId,
      });
      await message.react(args.emoji);
      return {
        ok: true,
        channelId: args.channelId,
        messageId: args.messageId,
        emoji: args.emoji,
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'reactions.remove',
    summary: 'Remove Sage’s own reaction from a Discord message.',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageId: z.string().trim().min(1),
      emoji: z.string().trim().min(1).max(100),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const botUserId = client.user?.id?.trim();
      if (!botUserId) {
        throw new Error('Sage bot identity is unavailable.');
      }
      const { message } = await fetchMessageForOperation({
        toolContext: context.toolContext,
        channelId: args.channelId,
        messageId: args.messageId,
      });
      const reaction = await findMessageReaction(message, args.emoji);
      if (!reaction) {
        throw new Error('Target reaction was not found.');
      }
      await reaction.users.remove(botUserId);
      return {
        ok: true,
        channelId: args.channelId,
        messageId: args.messageId,
        emoji: args.emoji,
        removedUserId: botUserId,
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'threads.create',
    summary: 'Create a Discord thread from a message or under a thread-capable parent channel.',
    input: z.object({
      channelId: z.string().trim().min(1),
      name: z.string().trim().min(1).max(100),
      fromMessageId: z.string().trim().min(1).optional(),
      autoArchiveDurationMinutes: z.union([
        z.literal(60),
        z.literal(1_440),
        z.literal(4_320),
        z.literal(10_080),
      ]).optional(),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      if (args.fromMessageId) {
        const { message } = await fetchMessageForOperation({
          toolContext: context.toolContext,
          channelId: args.channelId,
          messageId: args.fromMessageId,
        });
        const thread = await message.startThread({
          name: args.name,
          autoArchiveDuration: args.autoArchiveDurationMinutes as ThreadAutoArchiveDuration | undefined,
        });
        return serializeThread(thread);
      }
      const channel = asTextChannel(
        await fetchWritableTextChannel({
          toolContext: context.toolContext,
          channelId: args.channelId,
        }),
        args.channelId,
      );
      if (!channel.threads || typeof channel.threads.create !== 'function') {
        throw new Error(`Channel "${args.channelId}" does not support thread creation.`);
      }
      const thread = await channel.threads.create({
        name: args.name,
        autoArchiveDuration: args.autoArchiveDurationMinutes as ThreadAutoArchiveDuration | undefined,
      });
      return serializeThread(thread);
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'threads.update',
    summary: 'Update mutable metadata on an existing Discord thread.',
    input: z.object({
      threadId: z.string().trim().min(1),
      name: z.string().trim().min(1).max(100).optional(),
      archived: z.boolean().optional(),
      locked: z.boolean().optional(),
      autoArchiveDurationMinutes: z.union([
        z.literal(60),
        z.literal(1_440),
        z.literal(4_320),
        z.literal(10_080),
      ]).optional(),
    }).refine(
      (value) =>
        value.name !== undefined ||
        value.archived !== undefined ||
        value.locked !== undefined ||
        value.autoArchiveDurationMinutes !== undefined,
      { message: 'Provide at least one mutable thread field.' },
    ),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      let thread = await fetchThreadForOperation({
        toolContext: context.toolContext,
        threadId: args.threadId,
      });
      if (args.name !== undefined && typeof thread.setName === 'function') {
        thread = await thread.setName(args.name);
      }
      if (args.archived !== undefined && typeof thread.setArchived === 'function') {
        thread = await thread.setArchived(args.archived);
      }
      if (args.locked !== undefined && typeof thread.setLocked === 'function') {
        thread = await thread.setLocked(args.locked);
      }
      if (args.autoArchiveDurationMinutes !== undefined && typeof thread.setAutoArchiveDuration === 'function') {
        thread = await thread.setAutoArchiveDuration(
          args.autoArchiveDurationMinutes as ThreadAutoArchiveDuration,
        );
      }
      return serializeThread(thread);
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'threads.join',
    summary: 'Join a Discord thread as Sage.',
    input: z.object({
      threadId: z.string().trim().min(1),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const thread = await fetchThreadForOperation({
        toolContext: context.toolContext,
        threadId: args.threadId,
      });
      await thread.join?.();
      return {
        ok: true,
        ...serializeThread(thread),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'threads.leave',
    summary: 'Leave a Discord thread as Sage.',
    input: z.object({
      threadId: z.string().trim().min(1),
    }),
    mutability: 'write',
    approvalMode: 'required',
    async execute(args, context) {
      const thread = await fetchThreadForOperation({
        toolContext: context.toolContext,
        threadId: args.threadId,
      });
      await thread.leave?.();
      return {
        ok: true,
        ...serializeThread(thread),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'threads.addMember',
    summary: 'Add a user to a Discord thread.',
    input: z.object({
      threadId: z.string().trim().min(1),
      userId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const thread = await fetchThreadForOperation({
        toolContext: context.toolContext,
        threadId: args.threadId,
      });
      if (!thread.members || typeof thread.members.add !== 'function') {
        throw new Error('This thread does not support membership changes.');
      }
      await thread.members.add(args.userId);
      return {
        ok: true,
        userId: args.userId,
        ...serializeThread(thread),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'threads.removeMember',
    summary: 'Remove a user from a Discord thread.',
    input: z.object({
      threadId: z.string().trim().min(1),
      userId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const thread = await fetchThreadForOperation({
        toolContext: context.toolContext,
        threadId: args.threadId,
      });
      if (!thread.members || typeof thread.members.remove !== 'function') {
        throw new Error('This thread does not support membership changes.');
      }
      await thread.members.remove(args.userId);
      return {
        ok: true,
        userId: args.userId,
        ...serializeThread(thread),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'threads.archive',
    summary: 'Archive a Discord thread and optionally lock it.',
    input: z.object({
      threadId: z.string().trim().min(1),
      locked: z.boolean().optional(),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      let thread = await fetchThreadForOperation({
        toolContext: context.toolContext,
        threadId: args.threadId,
      });
      thread = await thread.setArchived?.(true) ?? thread;
      if (args.locked !== undefined && typeof thread.setLocked === 'function') {
        thread = await thread.setLocked(args.locked);
      }
      return serializeThread(thread);
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'threads.reopen',
    summary: 'Reopen an archived Discord thread.',
    input: z.object({
      threadId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      let thread = await fetchThreadForOperation({
        toolContext: context.toolContext,
        threadId: args.threadId,
      });
      thread = await thread.setArchived?.(false) ?? thread;
      return serializeThread(thread);
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'members.get',
    summary: 'Read one guild member’s profile and role membership.',
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
        userId: member.id,
        displayName: member.displayName,
        joinedAt: member.joinedAt?.toISOString() ?? null,
        roles: member.roles.cache.map((role) => serializeRole(role)),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'roles.get',
    summary: 'Read one guild role by id.',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      roleId: z.string().trim().min(1),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const guild = await client.guilds.fetch(args.guildId ?? requireGuildId(context.toolContext));
      const role = await guild.roles.fetch(args.roleId).catch(() => null);
      return role ? serializeRole(role) : null;
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'roles.list',
    summary: 'List guild roles in display order.',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const guild = await client.guilds.fetch(args.guildId ?? requireGuildId(context.toolContext));
      await guild.roles.fetch();
      return guild.roles.cache
        .sort((left, right) => right.position - left.position)
        .map((role) => serializeRole(role));
    },
  }),
  defineBridgeMethod({
    namespace: 'discord',
    method: 'roles.add',
    summary: 'Add an existing guild role to a member.',
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
  defineBridgeMethod({
    namespace: 'discord',
    method: 'roles.remove',
    summary: 'Remove an existing guild role from a member.',
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

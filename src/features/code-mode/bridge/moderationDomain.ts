import { z } from 'zod';
import {
  acknowledgeModerationCase,
  addModerationCaseNote,
  getModerationCaseById,
  listModerationCaseNotes,
  listModerationCasesByGuild,
  markModerationCaseResolved,
} from '../../moderation/moderationPolicyRepo';
import type { ModerationCaseStatus } from '../../moderation/types';
import {
  assertBridgeAccess,
  defineBridgeMethod,
  fetchGuildChannel,
  requireGuildId,
} from './common';

const DISCORD_SNOWFLAKE_EPOCH_MS = 1_420_070_400_000n;
const BULK_DELETE_ELIGIBILITY_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;
const BULK_DELETE_MAX_MESSAGES_PER_REQUEST = 100;

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
  delete: () => Promise<void>;
  reactions?: {
    resolve?: (emoji: string) => GuildMessageReactionLike | null | undefined;
    fetch?: (emoji: string) => Promise<GuildMessageReactionLike>;
    cache?: {
      values: () => IterableIterator<GuildMessageReactionLike>;
    };
  };
};

type GuildTextModerationChannelLike = {
  messages?: {
    fetch: (messageId: string) => Promise<GuildMessageLike>;
  };
  bulkDelete?: (messageIds: string[] | Iterable<string>, filterOld?: boolean) => Promise<{
    size?: number;
    values?: () => IterableIterator<GuildMessageLike>;
  }>;
};

function serializeCase(record: NonNullable<Awaited<ReturnType<typeof getModerationCaseById>>>) {
  return {
    ...record,
    acknowledgedAt: record.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function asModerationChannel(channel: unknown, channelId: string): GuildTextModerationChannelLike {
  if (!channel || typeof channel !== 'object') {
    throw new Error(`Channel "${channelId}" is unavailable.`);
  }
  const candidate = channel as Partial<GuildTextModerationChannelLike> & { isTextBased?: () => boolean };
  if (typeof candidate.isTextBased === 'function' && !candidate.isTextBased()) {
    throw new Error(`Channel "${channelId}" is not text-based.`);
  }
  if (!candidate.messages || typeof candidate.messages.fetch !== 'function') {
    throw new Error(`Channel "${channelId}" does not support moderation message operations.`);
  }
  return candidate as GuildTextModerationChannelLike;
}

function normalizeEmojiIdentifier(rawEmoji: string): string {
  const trimmed = rawEmoji.trim();
  const custom = trimmed.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);
  if (!custom) {
    return trimmed;
  }
  return `${custom[1]}:${custom[2]}`;
}

async function fetchModerationMessage(params: {
  toolContext: Parameters<typeof fetchGuildChannel>[0]['toolContext'];
  channelId: string;
  messageId: string;
}): Promise<GuildMessageLike> {
  const channel = asModerationChannel(
    await fetchGuildChannel({
      toolContext: params.toolContext,
      channelId: params.channelId,
    }),
    params.channelId,
  );
  const message = await channel.messages?.fetch(params.messageId).catch(() => null);
  if (!message) {
    throw new Error(`Message "${params.messageId}" was not found.`);
  }
  return message;
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

function snowflakeTimestampMs(id: string): number | null {
  try {
    return Number((BigInt(id) >> 22n) + DISCORD_SNOWFLAKE_EPOCH_MS);
  } catch {
    return null;
  }
}

function splitIntoBatches(values: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

export const moderationDomainMethods = [
  defineBridgeMethod({
    namespace: 'moderation',
    method: 'cases.list',
    summary: 'List moderation cases for the active guild.',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    mutability: 'read',
    access: 'moderator',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'moderator');
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const cases = await listModerationCasesByGuild({
        guildId,
        limit: args.limit ?? 25,
      });
      return cases.map((record) => serializeCase(record));
    },
  }),
  defineBridgeMethod({
    namespace: 'moderation',
    method: 'cases.get',
    summary: 'Read one moderation case with its notes.',
    input: z.object({
      caseId: z.string().trim().min(1),
    }),
    mutability: 'read',
    access: 'moderator',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'moderator');
      const record = await getModerationCaseById(args.caseId);
      if (!record) {
        return null;
      }
      const notes = await listModerationCaseNotes(record.id);
      return {
        case: serializeCase(record),
        notes: notes.map((note) => ({
          ...note,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
        })),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'moderation',
    method: 'cases.acknowledge',
    summary: 'Acknowledge a moderation case for follow-up.',
    input: z.object({
      caseId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'moderator');
      const updated = await acknowledgeModerationCase({
        id: args.caseId,
        acknowledgedByUserId: context.toolContext.userId,
      });
      return serializeCase(updated);
    },
  }),
  defineBridgeMethod({
    namespace: 'moderation',
    method: 'cases.resolve',
    summary: 'Resolve a moderation case with an outcome and optional note.',
    input: z.object({
      caseId: z.string().trim().min(1),
      outcome: z.enum(['executed', 'failed', 'noop'] satisfies ModerationCaseStatus[]),
      lifecycleStatus: z.enum(['resolved', 'voided']).default('resolved'),
      resolutionReasonText: z.string().trim().max(4_000).optional(),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'moderator');
      const updated = await markModerationCaseResolved({
        id: args.caseId,
        status: args.outcome,
        lifecycleStatus: args.lifecycleStatus,
        executedByUserId: context.toolContext.userId,
        resolutionReasonText: args.resolutionReasonText ?? null,
      });
      return serializeCase(updated);
    },
  }),
  defineBridgeMethod({
    namespace: 'moderation',
    method: 'notes.create',
    summary: 'Add a note to a moderation case.',
    input: z.object({
      caseId: z.string().trim().min(1),
      noteText: z.string().trim().min(1).max(4_000),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'moderator');
      const note = await addModerationCaseNote({
        caseId: args.caseId,
        guildId: requireGuildId(context.toolContext),
        createdByUserId: context.toolContext.userId,
        noteText: args.noteText,
      });
      return {
        ...note,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'moderation',
    method: 'messages.delete',
    summary: 'Delete one Discord message through the moderator path.',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageId: z.string().trim().min(1),
      reasonText: z.string().trim().max(500).optional(),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'moderator');
      const message = await fetchModerationMessage({
        toolContext: context.toolContext,
        channelId: args.channelId,
        messageId: args.messageId,
      });
      await message.delete();
      return {
        ok: true,
        channelId: args.channelId,
        messageId: args.messageId,
        reasonText: args.reasonText ?? null,
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'moderation',
    method: 'messages.bulkDelete',
    summary: 'Delete multiple recent Discord messages and report deleted, skipped, and missing counts.',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageIds: z.array(z.string().trim().min(1)).min(1).max(500),
      reasonText: z.string().trim().max(500).optional(),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'moderator');
      const channel = asModerationChannel(
        await fetchGuildChannel({
          toolContext: context.toolContext,
          channelId: args.channelId,
        }),
        args.channelId,
      );
      if (typeof channel.bulkDelete !== 'function') {
        throw new Error(`Channel "${args.channelId}" does not support bulk deletion.`);
      }
      const cutoff = Date.now() - BULK_DELETE_ELIGIBILITY_WINDOW_MS;
      const eligibleIds: string[] = [];
      const skippedTooOld: string[] = [];
      for (const messageId of args.messageIds) {
        const timestamp = snowflakeTimestampMs(messageId);
        if (timestamp !== null && timestamp < cutoff) {
          skippedTooOld.push(messageId);
        } else {
          eligibleIds.push(messageId);
        }
      }
      let deletedCount = 0;
      for (const batch of splitIntoBatches(eligibleIds, BULK_DELETE_MAX_MESSAGES_PER_REQUEST)) {
        if (batch.length === 0) {
          continue;
        }
        const deleted = await channel.bulkDelete(batch, false);
        const size = typeof deleted?.size === 'number'
          ? deleted.size
          : deleted && typeof deleted === 'object' && typeof deleted.values === 'function'
            ? Array.from(deleted.values()).length
            : 0;
        deletedCount += size;
      }
      const notFoundCount = Math.max(0, eligibleIds.length - deletedCount);
      return {
        ok: true,
        channelId: args.channelId,
        requestedCount: args.messageIds.length,
        deletedCount,
        skippedTooOldCount: skippedTooOld.length,
        skippedTooOldMessageIds: skippedTooOld,
        notFoundCount,
        reasonText: args.reasonText ?? null,
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'moderation',
    method: 'reactions.removeUser',
    summary: 'Remove one user’s reaction from a Discord message.',
    input: z.object({
      channelId: z.string().trim().min(1),
      messageId: z.string().trim().min(1),
      emoji: z.string().trim().min(1).max(100),
      userId: z.string().trim().min(1),
      reasonText: z.string().trim().max(500).optional(),
    }),
    mutability: 'write',
    access: 'moderator',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'moderator');
      const message = await fetchModerationMessage({
        toolContext: context.toolContext,
        channelId: args.channelId,
        messageId: args.messageId,
      });
      const reaction = await findMessageReaction(message, args.emoji);
      if (!reaction) {
        throw new Error('Target reaction was not found.');
      }
      await reaction.users.remove(args.userId);
      return {
        ok: true,
        channelId: args.channelId,
        messageId: args.messageId,
        emoji: args.emoji,
        removedUserId: args.userId,
        reasonText: args.reasonText ?? null,
      };
    },
  }),
];

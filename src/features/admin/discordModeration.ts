import { z } from 'zod';

const DISCORD_REF_MAX_CHARS = 2_000;

const flexibleDiscordRefSchema = z.string().trim().min(1).max(DISCORD_REF_MAX_CHARS);

const removeUserReactionRequestSchema = z.object({
  action: z.literal('remove_user_reaction'),
  messageId: flexibleDiscordRefSchema.optional(),
  channelId: flexibleDiscordRefSchema.optional(),
  emoji: z.string().trim().min(1).max(128),
  userId: flexibleDiscordRefSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});

const clearReactionsRequestSchema = z.object({
  action: z.literal('clear_reactions'),
  messageId: flexibleDiscordRefSchema.optional(),
  channelId: flexibleDiscordRefSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});

const deleteMessageRequestSchema = z.object({
  action: z.literal('delete_message'),
  messageId: flexibleDiscordRefSchema.optional(),
  channelId: flexibleDiscordRefSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});

const timeoutMemberRequestSchema = z.object({
  action: z.literal('timeout_member'),
  userId: flexibleDiscordRefSchema.optional(),
  durationMinutes: z.number().int().min(1).max(40_320),
  reason: z.string().trim().min(3).max(500),
});

const untimeoutMemberRequestSchema = z.object({
  action: z.literal('untimeout_member'),
  userId: flexibleDiscordRefSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});

const kickMemberRequestSchema = z.object({
  action: z.literal('kick_member'),
  userId: flexibleDiscordRefSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});

const banMemberRequestSchema = z.object({
  action: z.literal('ban_member'),
  userId: flexibleDiscordRefSchema.optional(),
  deleteMessageSeconds: z.number().int().min(0).max(604_800).optional(),
  reason: z.string().trim().min(3).max(500),
});

const unbanMemberRequestSchema = z.object({
  action: z.literal('unban_member'),
  userId: flexibleDiscordRefSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});

export const discordModerationActionRequestSchema = z.discriminatedUnion('action', [
  removeUserReactionRequestSchema,
  clearReactionsRequestSchema,
  deleteMessageRequestSchema,
  timeoutMemberRequestSchema,
  untimeoutMemberRequestSchema,
  kickMemberRequestSchema,
  banMemberRequestSchema,
  unbanMemberRequestSchema,
]);

export type DiscordModerationActionRequest = z.infer<typeof discordModerationActionRequestSchema>;

export type PreparedModerationAction =
  | {
      action: 'remove_user_reaction';
      channelId: string;
      messageId: string;
      emoji: string;
      userId: string;
      reason: string;
    }
  | {
      action: 'clear_reactions' | 'delete_message';
      channelId: string;
      messageId: string;
      reason: string;
    }
  | {
      action: 'timeout_member';
      userId: string;
      durationMinutes: number;
      reason: string;
    }
  | {
      action: 'untimeout_member' | 'kick_member' | 'unban_member';
      userId: string;
      reason: string;
    }
  | {
      action: 'ban_member';
      userId: string;
      deleteMessageSeconds?: number;
      reason: string;
    };

export type PreparedModerationEvidence = {
  targetKind: 'message' | 'reaction' | 'member';
  source:
    | 'explicit_id'
    | 'current_channel_default'
    | 'channel_mention'
    | 'user_mention'
    | 'message_url'
    | 'reply_target'
    | 'message_author_url';
  channelId?: string | null;
  messageId?: string | null;
  messageUrl?: string | null;
  userId?: string | null;
  messageAuthorId?: string | null;
  messageAuthorDisplayName?: string | null;
  messageExcerpt?: string | null;
};

export type PreparedModerationPreflight = {
  approverPermission: string | null;
  botPermissionChecks: string[];
  targetChannelScope: string | null;
  hierarchyChecked: boolean;
  notes: string[];
};

export type PreparedModerationEnvelope = {
  version: 1;
  originalRequest: DiscordModerationActionRequest;
  canonicalAction: PreparedModerationAction;
  evidence: PreparedModerationEvidence;
  preflight: PreparedModerationPreflight;
  dedupeKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOriginalRequest(value: unknown): DiscordModerationActionRequest | null {
  if (!isRecord(value)) return null;
  const action = asString(value.action);
  if (!action) return null;
  const parsed = discordModerationActionRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizePreparedModerationAction(value: unknown): PreparedModerationAction | null {
  if (!isRecord(value)) return null;
  const action = asString(value.action);
  if (!action) return null;

  switch (action) {
    case 'remove_user_reaction': {
      const channelId = asString(value.channelId);
      const messageId = asString(value.messageId);
      const emoji = asString(value.emoji);
      const userId = asString(value.userId);
      const reason = asString(value.reason);
      if (!channelId || !messageId || !emoji || !userId || !reason) return null;
      return { action, channelId, messageId, emoji, userId, reason };
    }
    case 'clear_reactions':
    case 'delete_message': {
      const channelId = asString(value.channelId);
      const messageId = asString(value.messageId);
      const reason = asString(value.reason);
      if (!channelId || !messageId || !reason) return null;
      return { action, channelId, messageId, reason };
    }
    case 'timeout_member': {
      const userId = asString(value.userId);
      const reason = asString(value.reason);
      const durationMinutes = typeof value.durationMinutes === 'number' ? value.durationMinutes : null;
      if (!userId || !reason || !durationMinutes || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
        return null;
      }
      return { action, userId, reason, durationMinutes };
    }
    case 'untimeout_member':
    case 'kick_member':
    case 'unban_member': {
      const userId = asString(value.userId);
      const reason = asString(value.reason);
      if (!userId || !reason) return null;
      return { action, userId, reason };
    }
    case 'ban_member': {
      const userId = asString(value.userId);
      const reason = asString(value.reason);
      const deleteMessageSeconds =
        typeof value.deleteMessageSeconds === 'number' && Number.isInteger(value.deleteMessageSeconds)
          ? value.deleteMessageSeconds
          : undefined;
      if (!userId || !reason) return null;
      return { action, userId, reason, deleteMessageSeconds };
    }
    default:
      return null;
  }
}

function normalizePreparedModerationEvidence(value: unknown): PreparedModerationEvidence | null {
  if (!isRecord(value)) return null;
  const targetKind = asString(value.targetKind);
  const source = asString(value.source);
  if (
    targetKind !== 'message' &&
    targetKind !== 'reaction' &&
    targetKind !== 'member'
  ) {
    return null;
  }
  if (
    source !== 'explicit_id' &&
    source !== 'current_channel_default' &&
    source !== 'channel_mention' &&
    source !== 'user_mention' &&
    source !== 'message_url' &&
    source !== 'reply_target' &&
    source !== 'message_author_url'
  ) {
    return null;
  }
  return {
    targetKind,
    source,
    channelId: asString(value.channelId),
    messageId: asString(value.messageId),
    messageUrl: asString(value.messageUrl),
    userId: asString(value.userId),
    messageAuthorId: asString(value.messageAuthorId),
    messageAuthorDisplayName: asString(value.messageAuthorDisplayName),
    messageExcerpt: asString(value.messageExcerpt),
  };
}

function normalizePreparedModerationPreflight(value: unknown): PreparedModerationPreflight | null {
  if (!isRecord(value)) return null;
  const approverPermission = value.approverPermission === null ? null : asString(value.approverPermission);
  const botPermissionChecks = Array.isArray(value.botPermissionChecks)
    ? value.botPermissionChecks.map((entry) => asString(entry)).filter((entry): entry is string => !!entry)
    : [];
  const targetChannelScope = value.targetChannelScope === null ? null : asString(value.targetChannelScope);
  const hierarchyChecked = value.hierarchyChecked === true;
  const notes = Array.isArray(value.notes)
    ? value.notes.map((entry) => asString(entry)).filter((entry): entry is string => !!entry)
    : [];
  return {
    approverPermission,
    botPermissionChecks,
    targetChannelScope,
    hierarchyChecked,
    notes,
  };
}

export function isPreparedModerationEnvelope(value: unknown): value is PreparedModerationEnvelope {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (!readOriginalRequest(value.originalRequest)) return false;
  if (!normalizePreparedModerationAction(value.canonicalAction)) return false;
  if (!normalizePreparedModerationEvidence(value.evidence)) return false;
  if (!normalizePreparedModerationPreflight(value.preflight)) return false;
  return asString(value.dedupeKey) !== null;
}

function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForHash(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((out, key) => {
      out[key] = canonicalizeForHash((value as Record<string, unknown>)[key]);
      return out;
    }, {});
}

export function computePreparedModerationDedupeKey(action: PreparedModerationAction): string {
  return JSON.stringify(canonicalizeForHash(action));
}

export function readPreparedModerationEnvelope(
  payloadJson: unknown,
): PreparedModerationEnvelope | null {
  if (!isRecord(payloadJson)) return null;

  if (isPreparedModerationEnvelope(payloadJson.prepared)) {
    return payloadJson.prepared;
  }

  if (isPreparedModerationEnvelope(payloadJson)) {
    return payloadJson;
  }

  return null;
}

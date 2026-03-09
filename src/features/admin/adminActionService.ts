import crypto from 'crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Guild,
  GuildBasedChannel,
  GuildMember,
  MessageFlags,
  PermissionsBitField,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import {
  ButtonStyle as ApiButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  type APIFileComponent,
  type APIMediaGalleryComponent,
  type APIMessageTopLevelComponent,
  type APISectionComponent,
  type APISeparatorComponent,
  SeparatorSpacingSize,
  type APITextDisplayComponent,
  type APIThumbnailComponent,
} from 'discord-api-types/payloads/v10';
import { z } from 'zod';
import {
  createPendingAdminAction,
  attachPendingAdminActionApprovalMessageId,
  findMatchingPendingAdminAction,
  getPendingAdminActionById,
  clearPendingAdminActionApprovalMessageId,
  markPendingAdminActionDecision,
  markPendingAdminActionExecuted,
  markPendingAdminActionExpired,
  markPendingAdminActionFailed,
  PendingAdminActionRecord,
} from './pendingAdminActionRepo';
import { clearGuildMemory, getGuildMemoryRecord, upsertGuildMemory } from '../settings/guildMemoryRepo';
import { computeParamsHash, logAdminAction } from '../relationships/adminAuditRepo';
import { logger } from '../../platform/logging/logger';
import { smartSplit } from '../../shared/text/message-splitter';
import {
  discordRestRequest,
  type DiscordRestFileInput,
  type DiscordRestMethod,
  type DiscordRestMultipartBodyMode,
} from '../../platform/discord/discordRest';
import {
  assertDiscordRestRequestGuildScoped,
  discordRestRequestGuildScoped,
} from '../../platform/discord/discordRestPolicy';
import { client } from '../../platform/discord/client';
import {
  discordComponentsV2BlockSchema as componentsV2BlockSchema,
  discordInteractiveActionButtonSchema,
  discordComponentsV2MediaRefSchema as componentsV2MediaRefSchema,
  discordComponentsV2MessageSchema,
  discordMessageFileInputSchema,
  discordMessageLinkButtonSchema as messageLinkButtonSchema,
  discordMessagePresentationSchema,
  type DiscordComponentsV2Message,
  validateDiscordSendMessagePayload,
} from '../discord/messageContract';
import {
  buildActionButtonComponent,
  createInteractiveButtonSession,
} from '../discord/interactiveComponentService';
import { isAdminInteraction } from '../../platform/discord/admin-permissions';

const APPROVAL_TTL_MS = 10 * 60 * 1_000;
const RESOLVED_APPROVAL_CARD_DELETE_DELAY_MS = 60_000;
const MAX_SERVER_INSTRUCTIONS_CHARS = 8_000;
const DEFAULT_SERVER_INSTRUCTIONS_MAX_CHARS = 4_000;
const ADMIN_ACTION_CUSTOM_ID_PREFIX = 'sage:admin_action:';
const DISCORD_INTERACTION_COOLDOWN_BY_ACTION_MS = {
  create_poll: 45_000,
  create_thread: 30_000,
  update_thread: 15_000,
  join_thread: 7_500,
  leave_thread: 7_500,
  add_thread_member: 15_000,
  remove_thread_member: 15_000,
  add_reaction: 7_500,
  remove_bot_reaction: 7_500,
  send_message: 3_000,
} as const;
const DISCORD_INTERACTION_COOLDOWNS = new Map<string, number>();

const sendPollsFlag = (
  PermissionsBitField.Flags as Record<string, bigint | undefined>
).SendPolls;

type PendingDecision = 'approve' | 'reject';

/**
 * Declares exported bindings: serverInstructionsUpdateRequestSchema.
 */
export const serverInstructionsUpdateRequestSchema = z.object({
  operation: z.enum(['set', 'append', 'clear']),
  text: z.string().trim().max(MAX_SERVER_INSTRUCTIONS_CHARS).optional(),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Represents the ServerInstructionsUpdateRequest type.
 */
export type ServerInstructionsUpdateRequest = z.infer<typeof serverInstructionsUpdateRequestSchema>;

const createPollRequestSchema = z.object({
  action: z.literal('create_poll'),
  question: z.string().trim().min(1).max(300),
  answers: z.array(z.string().trim().min(1).max(55)).min(2).max(10),
  durationHours: z.number().int().min(1).max(768).default(24),
  allowMultiselect: z.boolean().optional(),
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const createThreadRequestSchema = z.object({
  action: z.literal('create_thread'),
  name: z.string().trim().min(1).max(100),
  messageId: z.string().trim().min(1).max(64).optional(),
  channelId: z.string().trim().min(1).max(64).optional(),
  autoArchiveDurationMinutes: z.union([
    z.literal(60),
    z.literal(1_440),
    z.literal(4_320),
    z.literal(10_080),
  ]).optional(),
  reason: z.string().trim().max(500).optional(),
});

const updateThreadRequestSchema = z.object({
  action: z.literal('update_thread'),
  threadId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100).optional(),
  archived: z.boolean().optional(),
  locked: z.boolean().optional(),
  autoArchiveDurationMinutes: z.union([
    z.literal(60),
    z.literal(1_440),
    z.literal(4_320),
    z.literal(10_080),
  ]).optional(),
  reason: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (
    value.name === undefined &&
    value.archived === undefined &&
    value.locked === undefined &&
    value.autoArchiveDurationMinutes === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'update_thread requires at least one mutable field.',
      path: ['name'],
    });
  }
});

const joinLeaveThreadRequestSchema = (
  action: 'join_thread' | 'leave_thread',
) => z.object({
  action: z.literal(action),
  threadId: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(500).optional(),
});

const threadMemberRequestSchema = (
  action: 'add_thread_member' | 'remove_thread_member',
) => z.object({
  action: z.literal(action),
  threadId: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(500).optional(),
});

const addReactionRequestSchema = z.object({
  action: z.literal('add_reaction'),
  messageId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  emoji: z.string().trim().min(1).max(128),
  reason: z.string().trim().max(500).optional(),
});

const removeBotReactionRequestSchema = z.object({
  action: z.literal('remove_bot_reaction'),
  messageId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  emoji: z.string().trim().min(1).max(128),
  reason: z.string().trim().max(500).optional(),
});

const sendMessageRequestSchema = z.object({
  action: z.literal('send_message'),
  channelId: z.string().trim().min(1).max(64),
  presentation: discordMessagePresentationSchema.optional(),
  content: z.string().trim().min(1).max(8_000).optional(),
  files: z.array(discordMessageFileInputSchema).min(1).max(4).optional(),
  componentsV2: discordComponentsV2MessageSchema.optional(),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine((value, ctx) => {
  validateDiscordSendMessagePayload(value, ctx, { actionLabel: 'send_message' });
});

const removeUserReactionRequestSchema = z.object({
  action: z.literal('remove_user_reaction'),
  messageId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  emoji: z.string().trim().min(1).max(128),
  userId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(3).max(500),
});

const clearReactionsRequestSchema = z.object({
  action: z.literal('clear_reactions'),
  messageId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().min(3).max(500),
});

const deleteMessageRequestSchema = z.object({
  action: z.literal('delete_message'),
  messageId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().min(3).max(500),
});

const timeoutMemberRequestSchema = z.object({
  action: z.literal('timeout_member'),
  userId: z.string().trim().min(1).max(64),
  durationMinutes: z.number().int().min(1).max(40_320),
  reason: z.string().trim().min(3).max(500),
});

const kickMemberRequestSchema = z.object({
  action: z.literal('kick_member'),
  userId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(3).max(500),
});

const banMemberRequestSchema = z.object({
  action: z.literal('ban_member'),
  userId: z.string().trim().min(1).max(64),
  deleteMessageSeconds: z.number().int().min(0).max(604_800).optional(),
  reason: z.string().trim().min(3).max(500),
});

const unbanMemberRequestSchema = z.object({
  action: z.literal('unban_member'),
  userId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Declares exported bindings: discordInteractionRequestSchema.
 */
export const discordInteractionRequestSchema = z.discriminatedUnion('action', [
  createPollRequestSchema,
  createThreadRequestSchema,
  updateThreadRequestSchema,
  joinLeaveThreadRequestSchema('join_thread'),
  joinLeaveThreadRequestSchema('leave_thread'),
  threadMemberRequestSchema('add_thread_member'),
  threadMemberRequestSchema('remove_thread_member'),
  addReactionRequestSchema,
  removeBotReactionRequestSchema,
  sendMessageRequestSchema,
]);

/**
 * Represents the DiscordInteractionRequest type.
 */
export type DiscordInteractionRequest = z.infer<typeof discordInteractionRequestSchema>;

/**
 * Declares exported bindings: discordModerationActionRequestSchema.
 */
export const discordModerationActionRequestSchema = z.discriminatedUnion('action', [
  removeUserReactionRequestSchema,
  clearReactionsRequestSchema,
  deleteMessageRequestSchema,
  timeoutMemberRequestSchema,
  kickMemberRequestSchema,
  banMemberRequestSchema,
  unbanMemberRequestSchema,
]);

/**
 * Represents the DiscordModerationActionRequest type.
 */
export type DiscordModerationActionRequest = z.infer<typeof discordModerationActionRequestSchema>;
type ImmediateDiscordAction = DiscordInteractionRequest;
type QueuedDiscordAction = DiscordModerationActionRequest;

type ServerInstructionsPendingPayload = {
  operation: ServerInstructionsUpdateRequest['operation'];
  newInstructionsText: string;
  reason: string;
  baseVersion: number;
};

type DiscordActionPendingPayload = {
  action: QueuedDiscordAction;
};

/**
 * Represents the DiscordRestWriteRequest type.
 */
export type DiscordRestWriteRequest = {
  method: DiscordRestMethod;
  path: string;
  query?: Record<string, string | number | boolean | null>;
  body?: unknown;
  multipartBodyMode?: DiscordRestMultipartBodyMode;
  files?: DiscordRestFileInput[];
  reason?: string;
  maxResponseChars?: number;
};

type DiscordRestWritePendingPayload = {
  request: DiscordRestWriteRequest;
};

function hashForAudit(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function truncateWithFlag(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, Math.max(1, maxChars - 1))}…`,
    truncated: true,
  };
}

function formatDiscordTimestamp(date: Date): string {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  return `<t:${unixSeconds}:f> (<t:${unixSeconds}:R>)`;
}

function makeDecisionCustomId(decision: PendingDecision, actionId: string): string {
  return `${ADMIN_ACTION_CUSTOM_ID_PREFIX}${decision}:${actionId}`;
}

function parseDecisionCustomId(
  customId: string,
): { decision: PendingDecision; actionId: string } | null {
  if (!customId.startsWith(ADMIN_ACTION_CUSTOM_ID_PREFIX)) {
    return null;
  }

  const payload = customId.slice(ADMIN_ACTION_CUSTOM_ID_PREFIX.length);
  const [decision, actionId] = payload.split(':');
  if ((decision !== 'approve' && decision !== 'reject') || !actionId) {
    return null;
  }

  return { decision, actionId };
}

type SendableGuildChannel = GuildBasedChannel & {
  send: (payload: Record<string, unknown>) => Promise<{ id: string }>;
};

function isSendableGuildChannel(channel: GuildBasedChannel | null): channel is SendableGuildChannel {
  if (!channel) {
    return false;
  }
  const candidate = channel as unknown as { send?: unknown };
  return typeof candidate.send === 'function';
}

async function fetchGuildChannel(guildId: string, channelId: string): Promise<GuildBasedChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.isDMBased() || !('guildId' in channel)) {
    throw new Error('Target channel is unavailable or not a guild channel.');
  }

  if (channel.guildId !== guildId) {
    throw new Error('Target channel does not belong to the active guild.');
  }

  return channel as GuildBasedChannel;
}

async function fetchGuildAndBotMember(guildId: string): Promise<{ guild: Guild; botMember: GuildMember }> {
  const guild = await client.guilds.fetch(guildId);
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  return { guild, botMember };
}

type GuildMessageLike = {
  id: string;
  delete: () => Promise<void>;
  react: (emoji: string) => Promise<unknown>;
  startThread: (args: {
    name: string;
    autoArchiveDuration?: ThreadAutoArchiveDuration;
    reason?: string;
  }) => Promise<{ id: string }>;
  reactions?: {
    resolve?: (emoji: string) => GuildMessageReactionLike | null | undefined;
    fetch?: (emoji: string) => Promise<GuildMessageReactionLike>;
    cache?: Map<string, GuildMessageReactionLike> | { values: () => IterableIterator<GuildMessageReactionLike> };
    removeAll?: () => Promise<void>;
  };
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

type MessageLookupGuildChannel = GuildBasedChannel & {
  messages?: {
    fetch: (messageId: string) => Promise<GuildMessageLike>;
  };
};

async function fetchGuildMessage(channel: GuildBasedChannel, messageId: string): Promise<GuildMessageLike> {
  const candidate = channel as MessageLookupGuildChannel;
  if (!candidate.messages) {
    throw new Error('Target channel does not support message lookup.');
  }
  return candidate.messages.fetch(messageId);
}

function normalizeEmojiIdentifier(rawEmoji: string): string {
  const trimmed = rawEmoji.trim();
  const custom = trimmed.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);
  if (!custom) {
    return trimmed;
  }

  return `${custom[1]}:${custom[2]}`;
}

function normalizeChannelId(rawChannelId: string): string {
  const trimmed = rawChannelId.trim();
  const match = trimmed.match(/^<#(\d+)>$/);
  return match ? match[1] : trimmed;
}

function matchesEmojiIdentifier(reaction: GuildMessageReactionLike, emojiIdentifier: string): boolean {
  const reactionIdentifier = reaction.emoji.identifier;
  if (reactionIdentifier && reactionIdentifier === emojiIdentifier) {
    return true;
  }

  if (reaction.emoji.name && reaction.emoji.id) {
    return `${reaction.emoji.name}:${reaction.emoji.id}` === emojiIdentifier;
  }

  return reaction.emoji.name === emojiIdentifier;
}

function reactionCacheValues(
  cache: Map<string, GuildMessageReactionLike> | { values: () => IterableIterator<GuildMessageReactionLike> },
): IterableIterator<GuildMessageReactionLike> {
  if (cache instanceof Map) {
    return cache.values();
  }
  return cache.values();
}

async function resolveMessageReaction(
  message: GuildMessageLike,
  emojiIdentifier: string,
): Promise<GuildMessageReactionLike | null> {
  const manager = message.reactions;
  if (!manager) {
    return null;
  }

  const resolved = manager.resolve?.(emojiIdentifier);
  if (resolved && matchesEmojiIdentifier(resolved, emojiIdentifier)) {
    return resolved;
  }

  if (manager.fetch) {
    const fetched = await manager.fetch(emojiIdentifier).catch(() => null);
    if (fetched && matchesEmojiIdentifier(fetched, emojiIdentifier)) {
      return fetched;
    }
  }

  if (manager.cache) {
    for (const reaction of reactionCacheValues(manager.cache)) {
      if (matchesEmojiIdentifier(reaction, emojiIdentifier)) {
        return reaction;
      }
    }
  }

  return null;
}

function getInteractionMemberPermissions(
  interaction: Pick<ButtonInteraction, 'member'>,
): Readonly<PermissionsBitField> | null {
  const member = interaction.member;
  if (!member || !('permissions' in member)) {
    return null;
  }

  return typeof member.permissions === 'string'
    ? new PermissionsBitField(BigInt(member.permissions))
    : member.permissions;
}

function requiredApproverPermission(
  action: QueuedDiscordAction,
): { flag: bigint; label: string } | null {
  switch (action.action) {
    case 'delete_message':
    case 'remove_user_reaction':
    case 'clear_reactions':
      return { flag: PermissionsBitField.Flags.ManageMessages, label: 'Manage Messages' };
    case 'timeout_member':
      return { flag: PermissionsBitField.Flags.ModerateMembers, label: 'Moderate Members' };
    case 'kick_member':
      return { flag: PermissionsBitField.Flags.KickMembers, label: 'Kick Members' };
    case 'ban_member':
    case 'unban_member':
      return { flag: PermissionsBitField.Flags.BanMembers, label: 'Ban Members' };
    default:
      return null;
  }
}

function assertMemberHierarchy(botMember: GuildMember, target: GuildMember): void {
  if (target.id === target.guild.ownerId) {
    throw new Error('Cannot moderate the guild owner.');
  }

  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new Error('Bot role hierarchy is too low for this moderation action.');
  }
}

function withAuditReason(baseReason: string, actionId: string, requestedBy: string, decidedBy?: string): string {
  const prefix = decidedBy
    ? `[sage action:${actionId}] requested_by=${requestedBy} approved_by=${decidedBy}; `
    : `[sage action:${actionId}] requested_by=${requestedBy}; `;
  return `${prefix}${baseReason}`.slice(0, 500);
}

async function postApprovalCard(params: {
  guildId: string;
  channelId: string;
  actionId: string;
  title: string;
  details: string[];
  requestedBy: string;
  expiresAt: Date;
}): Promise<string | null> {
  try {
    const channel = await fetchGuildChannel(params.guildId, params.channelId);
    if (!isSendableGuildChannel(channel)) {
      return null;
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(makeDecisionCustomId('approve', params.actionId))
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(makeDecisionCustomId('reject', params.actionId))
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger),
    );

    const contentLines = [
      `**${params.title}**`,
      `Requested by <@${params.requestedBy}>`,
      `Action ID: \`${params.actionId}\``,
      `Expires: ${formatDiscordTimestamp(params.expiresAt)}`,
      ...params.details,
    ];

    const message = await channel.send({
      content: contentLines.join('\n'),
      components: [row],
    });
    return message.id;
  } catch (error) {
    logger.warn(
      { error, actionId: params.actionId, guildId: params.guildId, channelId: params.channelId },
      'Failed to post admin approval card',
    );
    return null;
  }
}

async function ensureApprovalCardForPending(params: {
  pending: PendingAdminActionRecord;
  channelId: string;
  title: string;
  details: string[];
  requestedBy: string;
  coalesced?: boolean;
}): Promise<string | null> {
  const existingApprovalMessageId = params.pending.approvalMessageId?.trim() || null;
  if (existingApprovalMessageId) {
    return existingApprovalMessageId;
  }
  if (params.coalesced) {
    return null;
  }

  const approvalMessageId = await postApprovalCard({
    guildId: params.pending.guildId,
    channelId: params.channelId,
    actionId: params.pending.id,
    title: params.title,
    details: params.details,
    requestedBy: params.requestedBy,
    expiresAt: params.pending.expiresAt,
  });

  if (approvalMessageId) {
    await attachPendingAdminActionApprovalMessageId({
      id: params.pending.id,
      approvalMessageId,
    }).catch((error) => {
      logger.warn({ error, actionId: params.pending.id }, 'Failed to persist approval message id for coalesced pending action');
    });
  }

  return approvalMessageId;
}

function buildDiscordActionSummary(action: QueuedDiscordAction): string[] {
  switch (action.action) {
    case 'remove_user_reaction':
      return [
        `Type: remove_user_reaction`,
        `Message ID: ${action.messageId}`,
        `Emoji: ${action.emoji}`,
        `Target: <@${action.userId}>`,
        `Reason: ${action.reason}`,
      ];
    case 'clear_reactions':
      return [
        `Type: clear_reactions`,
        `Message ID: ${action.messageId}`,
        `Reason: ${action.reason}`,
      ];
    case 'delete_message':
      return [
        `Type: delete_message`,
        `Message ID: ${action.messageId}`,
        `Reason: ${action.reason}`,
      ];
    case 'timeout_member':
      return [
        `Type: timeout_member`,
        `Target: <@${action.userId}>`,
        `Duration: ${action.durationMinutes} minute(s)`,
        `Reason: ${action.reason}`,
      ];
    case 'kick_member':
      return [
        `Type: kick_member`,
        `Target: <@${action.userId}>`,
        `Reason: ${action.reason}`,
      ];
    case 'ban_member':
      return [
        `Type: ban_member`,
        `Target: <@${action.userId}>`,
        `Delete message seconds: ${action.deleteMessageSeconds ?? 0}`,
        `Reason: ${action.reason}`,
      ];
    case 'unban_member':
      return [
        `Type: unban_member`,
        `Target: <@${action.userId}>`,
        `Reason: ${action.reason}`,
      ];
    default:
      return ['Type: unknown'];
  }
}

export function buildDiscordRestWriteSummary(request: DiscordRestWriteRequest): string[] {
  const lines: string[] = [
    'Type: discord_rest_write',
    `Method: ${request.method}`,
    `Path: ${request.path}`,
  ];

  const summarizeKeys = (keys: string[], max: number): string => {
    if (keys.length === 0) return '';
    const preview = keys.slice(0, max).join(', ');
    return keys.length > max ? `${preview}, …+${keys.length - max}` : preview;
  };

  const describeJsonShape = (value: unknown): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `string (${value.length} chars)`;
    if (typeof value === 'number') return Number.isFinite(value) ? `number (${value})` : 'number (non-finite)';
    if (typeof value === 'boolean') return `boolean (${value ? 'true' : 'false'})`;
    if (Array.isArray(value)) return `array (${value.length} item(s))`;
    if (typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>).sort();
      if (keys.length === 0) return 'object (no keys)';
      return `object keys: ${summarizeKeys(keys, 16)}`;
    }
    return typeof value;
  };

  const stripUrlForDisplay = (raw: string): string => {
    try {
      const parsed = new URL(raw);
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return '[invalid url]';
    }
  };

  if (request.multipartBodyMode) {
    lines.push(`Multipart body mode: ${request.multipartBodyMode}`);
  }

  if (request.reason?.trim()) {
    const safeReason = String(sanitizeObjectForDisplay(request.reason.trim()));
    lines.push(`Reason: ${safeReason}`);
  }

  const queryKeys = request.query ? Object.keys(request.query) : [];
  if (queryKeys.length > 0) {
    lines.push(`Query keys: ${summarizeKeys(queryKeys.sort(), 20)}`);
  }

  if (request.body !== undefined) {
    lines.push(`Body: ${describeJsonShape(request.body)}`);
  }

  const files = request.files ?? [];
  if (files.length > 0) {
    lines.push(`Files: ${files.length}`);
    const preview = files.slice(0, 4);
    for (let index = 0; index < preview.length; index += 1) {
      const file = preview[index];
      const fieldName = file.fieldName?.trim() || `files[${index}]`;
      const sourcePreview = (() => {
        if (file.source.type === 'url') return truncateWithFlag(stripUrlForDisplay(file.source.url), 220).text;
        if (file.source.type === 'text') return `text (${file.source.text.length} chars)`;
        return `base64 (${file.source.base64.length} chars)`;
      })();
      lines.push(`- ${fieldName}: ${file.filename} (${file.source.type}: ${sourcePreview})`);
    }
    if (files.length > preview.length) {
      lines.push(`- …and ${files.length - preview.length} more`);
    }
  }

  return lines;
}

const SENSITIVE_KEY_PATTERN = /(?:authorization|api[_-]?key|token|secret|password|cookie|session)/i;

function sanitizeObjectForDisplay(value: unknown, depth = 0): unknown {
  if (depth >= 6) return '[…]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const normalized = value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [REDACTED]')
      .replace(/\bBot\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bot [REDACTED]');
    if (normalized.length <= 400) return normalized;
    return `${normalized.slice(0, 399)}…`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const preview = value.slice(0, 20).map((item) => sanitizeObjectForDisplay(item, depth + 1));
    if (value.length > preview.length) {
      preview.push(`[…+${value.length - preview.length} more]`);
    }
    return preview;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(record).sort();
    const previewKeys = keys.slice(0, 60);
    for (const key of previewKeys) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeObjectForDisplay(record[key], depth + 1);
      }
    }
    if (keys.length > previewKeys.length) {
      out['…'] = `[+${keys.length - previewKeys.length} more keys]`;
    }
    return out;
  }
  return String(value);
}

function buildJsonPreviewForDisplay(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  const sanitized = sanitizeObjectForDisplay(value);
  const json = JSON.stringify(sanitized, null, 2);
  return truncateWithFlag(json, maxChars);
}

type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

function parseAccentColorHex(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  return Number.parseInt(normalized, 16);
}

function toAttachmentUrl(name: string): string {
  return `attachment://${name}`;
}

function toMediaUrl(media: z.infer<typeof componentsV2MediaRefSchema>): string {
  return media.attachmentName ? toAttachmentUrl(media.attachmentName) : media.url!;
}

function buildLinkButtonComponent(
  button: z.infer<typeof messageLinkButtonSchema>,
): APIButtonComponent {
  return {
    type: ComponentType.Button,
    style: ApiButtonStyle.Link,
    label: button.label,
    url: button.url,
  };
}

async function renderComponentsV2Block(
  block: z.infer<typeof componentsV2BlockSchema>,
  params: {
    guildId: string;
    channelId: string;
    requestedBy: string;
  },
): Promise<APIContainerComponent['components'][number]> {
  switch (block.type) {
    case 'text':
      return {
        type: ComponentType.TextDisplay,
        content: block.content,
      } satisfies APITextDisplayComponent;
    case 'section': {
      const section: APISectionComponent = {
        type: ComponentType.Section,
        components: block.texts.map((text) => ({
          type: ComponentType.TextDisplay,
          content: text,
        })) satisfies APITextDisplayComponent[],
        accessory: block.accessory.type === 'thumbnail'
          ? {
              type: ComponentType.Thumbnail,
              media: { url: toMediaUrl(block.accessory.media) },
              description: block.accessory.description ?? undefined,
              spoiler: block.accessory.spoiler ?? false,
            } satisfies APIThumbnailComponent
          : buildLinkButtonComponent(block.accessory.button),
      };
      return section;
    }
    case 'media_gallery':
      return {
        type: ComponentType.MediaGallery,
        items: block.items.map((item) => ({
          media: { url: toMediaUrl(item.media) },
          description: item.description ?? undefined,
          spoiler: item.spoiler ?? false,
        })),
      } satisfies APIMediaGalleryComponent;
    case 'file':
      return {
        type: ComponentType.File,
        file: { url: toAttachmentUrl(block.attachmentName) },
        spoiler: block.spoiler ?? false,
      } satisfies APIFileComponent;
    case 'separator':
      return {
        type: ComponentType.Separator,
        divider: block.divider ?? true,
        spacing: block.spacing === 'large' ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small,
      } satisfies APISeparatorComponent;
    case 'action_row': {
      const components = await Promise.all(
        block.buttons.map(async (button) => {
          if ('url' in button) {
            return buildLinkButtonComponent(button);
          }

          const parsed = discordInteractiveActionButtonSchema.parse(button);
          const customId = await createInteractiveButtonSession({
            guildId: params.guildId,
            channelId: params.channelId,
            createdByUserId: params.requestedBy,
            action: parsed.interaction,
          });
          return buildActionButtonComponent({
            customId,
            label: parsed.label,
            style: parsed.style,
          });
        }),
      );
      return {
        type: ComponentType.ActionRow,
        components,
      } satisfies APIActionRowComponent<APIButtonComponent>;
    }
  }
}

export async function buildDiscordComponentsV2MessagePayload(params: {
  message: DiscordComponentsV2Message;
  files?: Array<z.infer<typeof discordMessageFileInputSchema>>;
  guildId: string;
  channelId: string;
  requestedBy: string;
}): Promise<{
  flags: MessageFlags;
  components: APIMessageTopLevelComponent[];
  attachments?: Array<{ id: number; filename: string }>;
}> {
  const components = await Promise.all(
    params.message.blocks.map((block) =>
      renderComponentsV2Block(block, {
        guildId: params.guildId,
        channelId: params.channelId,
        requestedBy: params.requestedBy,
      })),
  );
  const attachments = params.files?.map((file, index) => ({
    id: index,
    filename: file.filename,
  }));

  if (params.message.accentColorHex || params.message.spoiler) {
    const container: APIContainerComponent = {
      type: ComponentType.Container,
      accent_color: parseAccentColorHex(params.message.accentColorHex) ?? undefined,
      spoiler: params.message.spoiler ?? false,
      components,
    };
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    };
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: components as APIMessageTopLevelComponent[],
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  };
}

function truncateDiscordMessage(value: string, maxChars = 1900): string {
  if (value.length <= maxChars) return value;
  const truncated = truncateWithFlag(value, maxChars);
  return truncated.text;
}

type ChannelPermissionRequirement = {
  flag: bigint;
  label: string;
};

const THREAD_CREATION_REQUIREMENTS: ChannelPermissionRequirement[] = [
  { flag: PermissionsBitField.Flags.CreatePublicThreads, label: 'CreatePublicThreads' },
  { flag: PermissionsBitField.Flags.CreatePrivateThreads, label: 'CreatePrivateThreads' },
  { flag: PermissionsBitField.Flags.ManageThreads, label: 'ManageThreads' },
];

function assertAllChannelPermissions(params: {
  permissions: Readonly<PermissionsBitField>;
  requirements: ChannelPermissionRequirement[];
  actorLabel: string;
}): void {
  const missing = params.requirements.filter((requirement) => !params.permissions.has(requirement.flag));
  if (missing.length === 0) {
    return;
  }

  const labels = missing.map((item) => item.label).join(', ');
  throw new Error(`${params.actorLabel} lacks required permission(s): ${labels}.`);
}

function assertAnyChannelPermission(params: {
  permissions: Readonly<PermissionsBitField>;
  requirements: ChannelPermissionRequirement[];
  actorLabel: string;
}): void {
  if (params.requirements.some((requirement) => params.permissions.has(requirement.flag))) {
    return;
  }

  const labels = params.requirements.map((item) => item.label).join(', ');
  throw new Error(`${params.actorLabel} requires at least one of: ${labels}.`);
}

function pruneDiscordInteractionCooldowns(nowMs: number): void {
  if (DISCORD_INTERACTION_COOLDOWNS.size < 128) {
    return;
  }

  for (const [key, expiresAtMs] of DISCORD_INTERACTION_COOLDOWNS.entries()) {
    if (expiresAtMs <= nowMs) {
      DISCORD_INTERACTION_COOLDOWNS.delete(key);
    }
  }
}

function buildDiscordInteractionCooldownKey(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  action: ImmediateDiscordAction;
}): string {
  return `${params.guildId}:${params.channelId}:${params.requestedBy}:${params.action.action}`;
}

function enforceDiscordInteractionCooldown(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  action: ImmediateDiscordAction;
}): void {
  const nowMs = Date.now();
  pruneDiscordInteractionCooldowns(nowMs);

  const key = buildDiscordInteractionCooldownKey(params);
  const cooldownUntilMs = DISCORD_INTERACTION_COOLDOWNS.get(key) ?? 0;
  if (cooldownUntilMs > nowMs) {
    const waitSeconds = Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1_000));
    throw new Error(`Rate limit: wait ${waitSeconds}s before repeating ${params.action.action}.`);
  }

  DISCORD_INTERACTION_COOLDOWNS.set(
    key,
    nowMs + DISCORD_INTERACTION_COOLDOWN_BY_ACTION_MS[params.action.action],
  );
}

async function executeImmediateDiscordAction(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  action: ImmediateDiscordAction;
  enforceRequesterGuards?: boolean;
}): Promise<Record<string, unknown>> {
  const channelId = normalizeChannelId(
    'threadId' in params.action
      ? params.action.threadId
      : (params.action.channelId ?? params.channelId),
  );
  const channel = await fetchGuildChannel(params.guildId, channelId);
  const { guild, botMember } = await fetchGuildAndBotMember(params.guildId);
  const permissionsInChannel = botMember.permissionsIn(channel);
  const shouldEnforceRequesterGuards = params.enforceRequesterGuards ?? false;

  const requesterPermissionsInChannel = shouldEnforceRequesterGuards
    ? await guild.members
        .fetch(params.requestedBy)
        .then((member) => member.permissionsIn(channel))
        .catch(() => null)
    : null;

  if (shouldEnforceRequesterGuards && !requesterPermissionsInChannel) {
    throw new Error('Unable to verify invoker permissions in the target channel.');
  }

  if (params.action.action === 'create_poll') {
    if (shouldEnforceRequesterGuards && requesterPermissionsInChannel) {
      assertAllChannelPermissions({
        permissions: requesterPermissionsInChannel,
        requirements: [{ flag: PermissionsBitField.Flags.SendMessages, label: 'SendMessages' }],
        actorLabel: 'Invoker',
      });
      if (sendPollsFlag) {
        assertAllChannelPermissions({
          permissions: requesterPermissionsInChannel,
          requirements: [{ flag: sendPollsFlag, label: 'SendPolls' }],
          actorLabel: 'Invoker',
        });
      }
    }

    if (!isSendableGuildChannel(channel)) {
      throw new Error('Selected channel does not allow message sends.');
    }
    assertAllChannelPermissions({
      permissions: permissionsInChannel,
      requirements: [{ flag: PermissionsBitField.Flags.SendMessages, label: 'SendMessages' }],
      actorLabel: 'Bot',
    });

    if (sendPollsFlag && !permissionsInChannel.has(sendPollsFlag)) {
      throw new Error('Bot lacks SendPolls permission in target channel.');
    }
    if (shouldEnforceRequesterGuards) {
      enforceDiscordInteractionCooldown({
        guildId: params.guildId,
        channelId,
        requestedBy: params.requestedBy,
        action: params.action,
      });
    }

    const sent = await channel.send({
      poll: {
        question: { text: params.action.question },
        answers: params.action.answers.map((text) => ({ text })),
        duration: params.action.durationHours,
        allowMultiselect: params.action.allowMultiselect ?? false,
      },
      content: '',
    });

    return {
      status: 'executed',
      action: 'create_poll',
      channelId: channel.id,
      messageId: sent.id,
    };
  }

  if (params.action.action === 'send_message') {
    if (shouldEnforceRequesterGuards && requesterPermissionsInChannel) {
      assertAllChannelPermissions({
        permissions: requesterPermissionsInChannel,
        requirements: [{ flag: PermissionsBitField.Flags.SendMessages, label: 'SendMessages' }],
        actorLabel: 'Invoker',
      });
    }

    if (!isSendableGuildChannel(channel)) {
      throw new Error('Selected channel does not allow message sends.');
    }
    assertAllChannelPermissions({
      permissions: permissionsInChannel,
      requirements: [{ flag: PermissionsBitField.Flags.SendMessages, label: 'SendMessages' }],
      actorLabel: 'Bot',
    });
    if (shouldEnforceRequesterGuards) {
      enforceDiscordInteractionCooldown({
        guildId: params.guildId,
        channelId,
        requestedBy: params.requestedBy,
        action: params.action,
      });
    }

    const messageIds: string[] = [];
    let sendAction: SendMessageRequest = params.action;

    const files = sendAction.files?.map((file) => ({
      filename: file.filename,
      contentType: file.contentType,
      source: file.source,
    } satisfies DiscordRestFileInput)) ?? [];

      if ((sendAction.presentation ?? 'plain') === 'components_v2') {
        const payload = await buildDiscordComponentsV2MessagePayload({
          message: sendAction.componentsV2!,
          files: sendAction.files,
          guildId: params.guildId,
          channelId: channel.id,
          requestedBy: params.requestedBy,
        });
      const restResponse = await discordRestRequest({
        method: 'POST',
        path: `/channels/${channel.id}/messages`,
        body: {
          flags: payload.flags,
          components: payload.components,
          attachments: payload.attachments,
          allowed_mentions: { parse: [] },
        },
        files,
        reason: sendAction.reason,
      });

      if (!restResponse.ok) {
        logger.warn(
          {
            guildId: params.guildId,
            channelId: channel.id,
            requestedBy: params.requestedBy,
            status: restResponse.status,
            statusText: restResponse.statusText,
          },
          'Components V2 send failed; retrying as plain text fallback',
        );

        const fallbackText = sendAction.componentsV2!.blocks
          .flatMap((block) => {
            switch (block.type) {
              case 'text':
                return [block.content];
              case 'section':
                return block.texts;
              case 'media_gallery':
                return block.items
                  .map((item) => item.description?.trim())
                  .filter((item): item is string => !!item);
              case 'file':
                return [`Attached file: ${block.attachmentName}`];
              default:
                return [];
            }
          })
          .join('\n\n')
          .trim();

        sendAction = {
          ...sendAction,
          presentation: 'plain',
          content: fallbackText || 'Shared a structured update.',
        };
      } else {
        const messageId = (
          restResponse.data &&
          typeof restResponse.data === 'object' &&
          !Array.isArray(restResponse.data) &&
          typeof (restResponse.data as Record<string, unknown>).id === 'string'
        )
          ? (restResponse.data as Record<string, unknown>).id as string
          : null;
        if (messageId) messageIds.push(messageId);

        return {
          status: 'executed',
          action: 'send_message',
          channelId: channel.id,
          messageIds,
          presentation: 'components_v2',
        };
      }
    }

    const chunks = sendAction.content?.trim().length
      ? smartSplit(sendAction.content, 2000)
      : [];

    if (files.length > 0) {
      const firstChunk = chunks.shift() ?? '';
      const restResponse = await discordRestRequest({
        method: 'POST',
        path: `/channels/${channel.id}/messages`,
        body: {
          content: firstChunk,
          allowed_mentions: { parse: [] },
          attachments: files.map((file, index) => ({
            id: index,
            filename: file.filename,
          })),
        },
        files,
        reason: sendAction.reason,
      });

      if (!restResponse.ok) {
        throw new Error(`Failed to send message with attachments (${restResponse.status} ${restResponse.statusText}).`);
      }

      const messageId = (
        restResponse.data &&
        typeof restResponse.data === 'object' &&
        !Array.isArray(restResponse.data) &&
        typeof (restResponse.data as Record<string, unknown>).id === 'string'
      )
        ? (restResponse.data as Record<string, unknown>).id as string
        : null;
      if (messageId) {
        messageIds.push(messageId);
      }
    }

    for (const chunk of chunks) {
      const sent = await channel.send({ content: chunk, allowedMentions: { parse: [] } });
      messageIds.push(sent.id);
    }

    return {
      status: 'executed',
      action: 'send_message',
      channelId: channel.id,
      messageIds,
      presentation: sendAction.presentation ?? 'plain',
    };
  }

  if (params.action.action === 'add_reaction') {
    if (shouldEnforceRequesterGuards && requesterPermissionsInChannel) {
      assertAllChannelPermissions({
        permissions: requesterPermissionsInChannel,
        requirements: [
          { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' },
          { flag: PermissionsBitField.Flags.AddReactions, label: 'AddReactions' },
        ],
        actorLabel: 'Invoker',
      });
    }

    assertAllChannelPermissions({
      permissions: permissionsInChannel,
      requirements: [
        { flag: PermissionsBitField.Flags.AddReactions, label: 'AddReactions' },
        { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' },
      ],
      actorLabel: 'Bot',
    });
    if (shouldEnforceRequesterGuards) {
      enforceDiscordInteractionCooldown({
        guildId: params.guildId,
        channelId,
        requestedBy: params.requestedBy,
        action: params.action,
      });
    }

    const message = await fetchGuildMessage(channel, params.action.messageId);
    const emoji = normalizeEmojiIdentifier(params.action.emoji);
    await message.react(emoji);
    return {
      status: 'executed',
      action: params.action.action,
      channelId: channel.id,
      messageId: message.id,
      emoji,
    };
  }

  if (params.action.action === 'remove_bot_reaction') {
    if (shouldEnforceRequesterGuards && requesterPermissionsInChannel) {
      assertAllChannelPermissions({
        permissions: requesterPermissionsInChannel,
        requirements: [{ flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' }],
        actorLabel: 'Invoker',
      });
    }

    assertAllChannelPermissions({
      permissions: permissionsInChannel,
      requirements: [{ flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' }],
      actorLabel: 'Bot',
    });
    if (shouldEnforceRequesterGuards) {
      enforceDiscordInteractionCooldown({
        guildId: params.guildId,
        channelId,
        requestedBy: params.requestedBy,
        action: params.action,
      });
    }

    const message = await fetchGuildMessage(channel, params.action.messageId);
    const emoji = normalizeEmojiIdentifier(params.action.emoji);

    if (!client.user) {
      throw new Error('Bot user is unavailable.');
    }

    const reaction = await resolveMessageReaction(message, emoji);
    if (!reaction) {
      throw new Error('Reaction not found on the target message.');
    }

    await reaction.users.remove(client.user.id);
    return {
      status: 'executed',
      action: params.action.action,
      channelId: channel.id,
      messageId: message.id,
      emoji,
      userId: client.user.id,
    };
  }

  if (params.action.action === 'update_thread') {
    if (shouldEnforceRequesterGuards && requesterPermissionsInChannel) {
      assertAllChannelPermissions({
        permissions: requesterPermissionsInChannel,
        requirements: [{ flag: PermissionsBitField.Flags.ManageThreads, label: 'ManageThreads' }],
        actorLabel: 'Invoker',
      });
    }

    assertAllChannelPermissions({
      permissions: permissionsInChannel,
      requirements: [{ flag: PermissionsBitField.Flags.ManageThreads, label: 'ManageThreads' }],
      actorLabel: 'Bot',
    });
    if (shouldEnforceRequesterGuards) {
      enforceDiscordInteractionCooldown({
        guildId: params.guildId,
        channelId,
        requestedBy: params.requestedBy,
        action: params.action,
      });
    }

    const body: Record<string, unknown> = {};
    if (params.action.name !== undefined) body.name = params.action.name;
    if (params.action.archived !== undefined) body.archived = params.action.archived;
    if (params.action.locked !== undefined) body.locked = params.action.locked;
    if (params.action.autoArchiveDurationMinutes !== undefined) {
      body.auto_archive_duration = params.action.autoArchiveDurationMinutes;
    }

    const response = await discordRestRequest({
      method: 'PATCH',
      path: `/channels/${channel.id}`,
      body,
      reason: params.action.reason,
    });
    if (!response.ok) {
      throw new Error(`Failed to update thread (${response.status} ${response.statusText}).`);
    }

    return {
      status: 'executed',
      action: 'update_thread',
      threadId: channel.id,
      name: params.action.name ?? null,
      archived: params.action.archived ?? null,
      locked: params.action.locked ?? null,
      autoArchiveDurationMinutes: params.action.autoArchiveDurationMinutes ?? null,
    };
  }

  if (params.action.action === 'join_thread' || params.action.action === 'leave_thread') {
    if (shouldEnforceRequesterGuards && requesterPermissionsInChannel) {
      assertAllChannelPermissions({
        permissions: requesterPermissionsInChannel,
        requirements: [{ flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' }],
        actorLabel: 'Invoker',
      });
    }

    assertAllChannelPermissions({
      permissions: permissionsInChannel,
      requirements: [{ flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' }],
      actorLabel: 'Bot',
    });
    if (shouldEnforceRequesterGuards) {
      enforceDiscordInteractionCooldown({
        guildId: params.guildId,
        channelId,
        requestedBy: params.requestedBy,
        action: params.action,
      });
    }

    const response = await discordRestRequest({
      method: params.action.action === 'join_thread' ? 'PUT' : 'DELETE',
      path: `/channels/${channel.id}/thread-members/@me`,
      reason: params.action.reason,
    });
    if (!response.ok) {
      throw new Error(`Failed to ${params.action.action === 'join_thread' ? 'join' : 'leave'} thread (${response.status} ${response.statusText}).`);
    }

    return {
      status: 'executed',
      action: params.action.action,
      threadId: channel.id,
    };
  }

  if (params.action.action === 'add_thread_member' || params.action.action === 'remove_thread_member') {
    if (shouldEnforceRequesterGuards && requesterPermissionsInChannel) {
      assertAllChannelPermissions({
        permissions: requesterPermissionsInChannel,
        requirements: [{ flag: PermissionsBitField.Flags.ManageThreads, label: 'ManageThreads' }],
        actorLabel: 'Invoker',
      });
    }

    assertAllChannelPermissions({
      permissions: permissionsInChannel,
      requirements: [{ flag: PermissionsBitField.Flags.ManageThreads, label: 'ManageThreads' }],
      actorLabel: 'Bot',
    });
    if (shouldEnforceRequesterGuards) {
      enforceDiscordInteractionCooldown({
        guildId: params.guildId,
        channelId,
        requestedBy: params.requestedBy,
        action: params.action,
      });
    }

    const response = await discordRestRequest({
      method: params.action.action === 'add_thread_member' ? 'PUT' : 'DELETE',
      path: `/channels/${channel.id}/thread-members/${params.action.userId}`,
      reason: params.action.reason,
    });
    if (!response.ok) {
      throw new Error(`Failed to update thread membership (${response.status} ${response.statusText}).`);
    }

    return {
      status: 'executed',
      action: params.action.action,
      threadId: channel.id,
      userId: params.action.userId,
    };
  }

  if (params.action.action === 'create_thread') {
    const createThreadAction = params.action;

    if (shouldEnforceRequesterGuards && requesterPermissionsInChannel) {
      assertAnyChannelPermission({
        permissions: requesterPermissionsInChannel,
        requirements: THREAD_CREATION_REQUIREMENTS,
        actorLabel: 'Invoker',
      });
      if (createThreadAction.messageId) {
        assertAllChannelPermissions({
          permissions: requesterPermissionsInChannel,
          requirements: [{ flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' }],
          actorLabel: 'Invoker',
        });
      }
    }

    if (!isSendableGuildChannel(channel)) {
      throw new Error('Selected channel does not allow message sends.');
    }
    assertAnyChannelPermission({
      permissions: permissionsInChannel,
      requirements: THREAD_CREATION_REQUIREMENTS,
      actorLabel: 'Bot',
    });
    if (shouldEnforceRequesterGuards) {
      enforceDiscordInteractionCooldown({
        guildId: params.guildId,
        channelId,
        requestedBy: params.requestedBy,
        action: createThreadAction,
      });
    }

    const autoArchiveDuration =
      (createThreadAction.autoArchiveDurationMinutes as ThreadAutoArchiveDuration | undefined) ??
      ThreadAutoArchiveDuration.OneDay;

    if (createThreadAction.messageId) {
      const message = await fetchGuildMessage(channel, createThreadAction.messageId);
      const thread = await message.startThread({
        name: createThreadAction.name,
        autoArchiveDuration,
        reason: createThreadAction.reason,
      });

      return {
        status: 'executed',
        action: 'create_thread',
        channelId: channel.id,
        threadId: thread.id,
        sourceMessageId: createThreadAction.messageId,
      };
    }

    const threadCapable = channel as unknown as {
      threads?: {
        create: (args: {
          name: string;
          autoArchiveDuration?: ThreadAutoArchiveDuration;
          reason?: string;
        }) => Promise<{ id: string }>;
      };
    };
    if (!threadCapable.threads) {
      throw new Error('Channel does not support thread creation.');
    }

    const thread = await threadCapable.threads.create({
      name: createThreadAction.name,
      autoArchiveDuration,
      reason: createThreadAction.reason,
    });

    return {
      status: 'executed',
      action: 'create_thread',
      channelId: channel.id,
      threadId: thread.id,
      sourceMessageId: null,
    };
  }

  throw new Error(`Unsupported immediate Discord action: ${(params.action as { action: string }).action}`);
}

async function executeQueuedDiscordAction(params: {
  action: QueuedDiscordAction;
  guildId: string;
  channelId: string;
  actionId: string;
  requestedBy: string;
  approvedBy: string;
}): Promise<Record<string, unknown>> {
  const { guild, botMember } = await fetchGuildAndBotMember(params.guildId);

  switch (params.action.action) {
    case 'delete_message': {
      const targetChannelId = params.action.channelId ?? params.channelId;
      const channel = await fetchGuildChannel(params.guildId, targetChannelId);
      if (!isSendableGuildChannel(channel)) {
        throw new Error('Target channel does not support deleting messages.');
      }

      const permissions = botMember.permissionsIn(channel);
      if (!permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        throw new Error('Bot lacks ManageMessages permission in target channel.');
      }

      const messageChannel = channel as unknown as {
        messages?: {
          fetch: (messageId: string) => Promise<{ delete: () => Promise<void> }>;
        };
      };

      if (!messageChannel.messages) {
        throw new Error('Target channel does not support message lookup.');
      }

      const message = await messageChannel.messages.fetch(params.action.messageId);
      await message.delete();

      return {
        action: params.action.action,
        status: 'executed',
        channelId: channel.id,
        messageId: params.action.messageId,
      };
    }

    case 'remove_user_reaction': {
      const targetChannelId = params.action.channelId ?? params.channelId;
      const channel = await fetchGuildChannel(params.guildId, targetChannelId);
      const permissions = botMember.permissionsIn(channel);
      if (!permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        throw new Error('Bot lacks ManageMessages permission in target channel.');
      }
      if (!permissions.has(PermissionsBitField.Flags.ReadMessageHistory)) {
        throw new Error('Bot lacks ReadMessageHistory permission in target channel.');
      }

      const message = await fetchGuildMessage(channel, params.action.messageId);
      const emoji = normalizeEmojiIdentifier(params.action.emoji);
      const reaction = await resolveMessageReaction(message, emoji);
      if (!reaction) {
        throw new Error('Reaction not found on the target message.');
      }

      await reaction.users.remove(params.action.userId);
      return {
        action: params.action.action,
        status: 'executed',
        channelId: channel.id,
        messageId: params.action.messageId,
        emoji,
        userId: params.action.userId,
      };
    }

    case 'clear_reactions': {
      const targetChannelId = params.action.channelId ?? params.channelId;
      const channel = await fetchGuildChannel(params.guildId, targetChannelId);
      const permissions = botMember.permissionsIn(channel);
      if (!permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        throw new Error('Bot lacks ManageMessages permission in target channel.');
      }
      if (!permissions.has(PermissionsBitField.Flags.ReadMessageHistory)) {
        throw new Error('Bot lacks ReadMessageHistory permission in target channel.');
      }

      const message = await fetchGuildMessage(channel, params.action.messageId);
      if (!message.reactions?.removeAll) {
        throw new Error('Target message does not support reaction management.');
      }

      await message.reactions.removeAll();
      return {
        action: params.action.action,
        status: 'executed',
        channelId: channel.id,
        messageId: params.action.messageId,
      };
    }

    case 'timeout_member': {
      if (!botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        throw new Error('Bot lacks ModerateMembers permission.');
      }

      const targetMember = await guild.members.fetch(params.action.userId);
      assertMemberHierarchy(botMember, targetMember);

      await targetMember.timeout(
        params.action.durationMinutes * 60_000,
        withAuditReason(
          params.action.reason,
          params.actionId,
          params.requestedBy,
          params.approvedBy,
        ),
      );

      return {
        action: params.action.action,
        status: 'executed',
        userId: params.action.userId,
        durationMinutes: params.action.durationMinutes,
      };
    }

    case 'kick_member': {
      if (!botMember.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        throw new Error('Bot lacks KickMembers permission.');
      }

      const targetMember = await guild.members.fetch(params.action.userId);
      assertMemberHierarchy(botMember, targetMember);
      await targetMember.kick(
        withAuditReason(
          params.action.reason,
          params.actionId,
          params.requestedBy,
          params.approvedBy,
        ),
      );

      return {
        action: params.action.action,
        status: 'executed',
        userId: params.action.userId,
      };
    }

    case 'ban_member': {
      if (!botMember.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        throw new Error('Bot lacks BanMembers permission.');
      }

      const existingMember = await guild.members.fetch(params.action.userId).catch(() => null);
      if (existingMember) {
        assertMemberHierarchy(botMember, existingMember);
      }

      await guild.members.ban(params.action.userId, {
        deleteMessageSeconds: params.action.deleteMessageSeconds,
        reason: withAuditReason(
          params.action.reason,
          params.actionId,
          params.requestedBy,
          params.approvedBy,
        ),
      });

      return {
        action: params.action.action,
        status: 'executed',
        userId: params.action.userId,
        deleteMessageSeconds: params.action.deleteMessageSeconds ?? 0,
      };
    }

    case 'unban_member': {
      if (!botMember.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        throw new Error('Bot lacks BanMembers permission.');
      }

      await guild.bans.remove(
        params.action.userId,
        withAuditReason(
          params.action.reason,
          params.actionId,
          params.requestedBy,
          params.approvedBy,
        ),
      );

      return {
        action: params.action.action,
        status: 'executed',
        userId: params.action.userId,
      };
    }

    default:
      throw new Error('Unsupported queued Discord action.');
  }
}

async function executePendingAction(params: {
  action: PendingAdminActionRecord;
  approvedBy: string;
}): Promise<Record<string, unknown>> {
  if (params.action.kind === 'server_instructions_update') {
    const payload = params.action.payloadJson as ServerInstructionsPendingPayload;
    const current = await getGuildMemoryRecord(params.action.guildId);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== payload.baseVersion) {
      throw new Error(
        `Server instructions changed since request creation (baseVersion=${payload.baseVersion}, currentVersion=${currentVersion}). Recreate and approve a fresh request.`,
      );
    }

    if (payload.operation === 'clear') {
      const cleared = await clearGuildMemory({
        guildId: params.action.guildId,
        adminId: params.approvedBy,
      });
      return {
        action: 'server_instructions_update',
        operation: payload.operation,
        cleared,
      };
    }

    const updated = await upsertGuildMemory({
      guildId: params.action.guildId,
      memoryText: payload.newInstructionsText,
      adminId: params.approvedBy,
    });

    return {
      action: 'server_instructions_update',
      operation: payload.operation,
      version: updated.version,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  if (params.action.kind === 'discord_queue_moderation_action') {
    const payload = params.action.payloadJson as DiscordActionPendingPayload;
    return executeQueuedDiscordAction({
      action: payload.action,
      guildId: params.action.guildId,
      channelId: params.action.channelId,
      actionId: params.action.id,
      requestedBy: params.action.requestedBy,
      approvedBy: params.approvedBy,
    });
  }

  if (params.action.kind === 'discord_rest_write') {
    const payload = params.action.payloadJson as DiscordRestWritePendingPayload;
    const request = payload.request;
    const auditReasonBase = request.reason?.trim() || `${request.method} ${request.path}`;
    const auditReason = withAuditReason(
      auditReasonBase,
      params.action.id,
      params.action.requestedBy,
      params.approvedBy,
    );

    const result = await discordRestRequestGuildScoped({
      guildId: params.action.guildId,
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
      multipartBodyMode: request.multipartBodyMode,
      files: request.files,
      reason: auditReason,
      maxResponseChars: request.maxResponseChars,
    });

    if (!result.ok) {
      const status = String(result.status ?? 'unknown');
      const statusText = String(result.statusText ?? '');
      const errorText = String(result.error ?? 'Unknown error');
      throw new Error(`Discord REST write failed (${status} ${statusText}): ${errorText}`);
    }

    return {
      action: 'discord_rest_write',
      status: 'executed',
      method: request.method,
      path: request.path,
      result,
    };
  }

  throw new Error(`Unknown pending action kind: ${params.action.kind}`);
}

export async function lookupServerInstructionsForTool(params: {
  guildId: string;
  maxChars?: number;
}): Promise<Record<string, unknown>> {
  const maxChars = Math.max(200, Math.min(params.maxChars ?? DEFAULT_SERVER_INSTRUCTIONS_MAX_CHARS, 12_000));
  const record = await getGuildMemoryRecord(params.guildId);
  if (!record) {
    return {
      found: false,
      guildId: params.guildId,
      instructionsText: '',
      content: 'No server instructions have been configured for this guild.',
    };
  }

  const truncated = truncateWithFlag(record.memoryText, maxChars);
  return {
    found: true,
    guildId: params.guildId,
    instructionsText: truncated.text,
    truncated: truncated.truncated,
    version: record.version,
    updatedAtIso: record.updatedAt.toISOString(),
  };
}

export async function requestServerInstructionsUpdateForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  request: ServerInstructionsUpdateRequest;
}): Promise<Record<string, unknown>> {
  const current = await getGuildMemoryRecord(params.guildId);
  const currentText = current?.memoryText ?? '';

  let nextText: string;
  if (params.request.operation === 'set') {
    const next = params.request.text?.trim();
    if (!next) {
      throw new Error('`text` is required for operation="set".');
    }
    nextText = next;
  } else if (params.request.operation === 'append') {
    const addition = params.request.text?.trim();
    if (!addition) {
      throw new Error('`text` is required for operation="append".');
    }
    nextText = currentText ? `${currentText}\n${addition}` : addition;
  } else {
    nextText = '';
  }

  if (params.request.operation !== 'clear' && nextText.length > MAX_SERVER_INSTRUCTIONS_CHARS) {
    throw new Error(`Server instructions exceed max length (${MAX_SERVER_INSTRUCTIONS_CHARS} chars).`);
  }

  const baseVersion = current?.version ?? 0;
  const payload = {
    operation: params.request.operation,
    newInstructionsText: nextText,
    reason: params.request.reason,
    baseVersion,
  } satisfies ServerInstructionsPendingPayload;

  const preview = truncateWithFlag(nextText, 700);
  const currentChars = currentText.length;
  const nextChars = nextText.length;
  const deltaChars = nextChars - currentChars;
  const signedDelta = deltaChars >= 0 ? `+${deltaChars}` : String(deltaChars);
  const details = [
    `Operation: ${params.request.operation}`,
    `Reason: ${params.request.reason}`,
    `Base version: ${baseVersion}`,
    `Current size: ${currentChars} chars`,
    `Proposed size: ${nextChars} chars (${signedDelta})`,
    `Preview:\n\`\`\`\n${preview.text || '[empty]'}\n\`\`\``,
  ];
  const existingPending = await findMatchingPendingAdminAction({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    kind: 'server_instructions_update',
    payloadJson: payload,
  });
  const expiresAt = existingPending?.expiresAt ?? new Date(Date.now() + APPROVAL_TTL_MS);
  const pending = existingPending ?? await createPendingAdminAction({
    guildId: params.guildId,
    channelId: params.channelId,
    requestedBy: params.requestedBy,
    kind: 'server_instructions_update',
    payloadJson: payload,
    expiresAt,
  });
  const coalesced = existingPending !== null;
  const approvalMessageId = await ensureApprovalCardForPending({
    pending,
    channelId: params.channelId,
    title: 'Server Instructions Update Approval',
    details,
    requestedBy: params.requestedBy,
    coalesced,
  });

  await logAdminAction({
    guildId: params.guildId,
    adminId: params.requestedBy,
    command: 'tool_discord_queue_server_instructions_update',
    paramsHash: computeParamsHash({
      actionId: pending.id,
      operation: params.request.operation,
      baseVersion,
      reasonHash: hashForAudit(params.request.reason),
      instructionsHash: hashForAudit(nextText),
    }),
  });

  return {
    status: 'pending_approval',
    actionId: pending.id,
    coalesced,
    expiresAtIso: expiresAt.toISOString(),
    approvalMessageId,
    instructionsChars: nextText.length,
    preview: preview.text,
    previewTruncated: preview.truncated,
  };
}

export async function requestDiscordAdminActionForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  request: DiscordModerationActionRequest;
}): Promise<Record<string, unknown>> {
  const payload = {
    action: params.request,
  } satisfies DiscordActionPendingPayload;
  const details = buildDiscordActionSummary(params.request);
  const existingPending = await findMatchingPendingAdminAction({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    kind: 'discord_queue_moderation_action',
    payloadJson: payload,
  });
  const expiresAt = existingPending?.expiresAt ?? new Date(Date.now() + APPROVAL_TTL_MS);
  const pending = existingPending ?? await createPendingAdminAction({
    guildId: params.guildId,
    channelId: params.channelId,
    requestedBy: params.requestedBy,
    kind: 'discord_queue_moderation_action',
    payloadJson: payload,
    expiresAt,
  });
  const coalesced = existingPending !== null;
  const approvalMessageId = await ensureApprovalCardForPending({
    pending,
    channelId: params.channelId,
    title: 'Discord Moderation Action Approval',
    details,
    requestedBy: params.requestedBy,
    coalesced,
  });

  await logAdminAction({
    guildId: params.guildId,
    adminId: params.requestedBy,
    command: 'tool_discord_queue_moderation_action',
    paramsHash: computeParamsHash({
      actionId: pending.id,
      action: params.request.action,
    }),
  });

  return {
    status: 'pending_approval',
    actionId: pending.id,
    action: params.request.action,
    coalesced,
    expiresAtIso: expiresAt.toISOString(),
    approvalMessageId,
  };
}

export async function requestDiscordRestWriteForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  request: DiscordRestWriteRequest;
}): Promise<Record<string, unknown>> {
  await assertDiscordRestRequestGuildScoped({
    guildId: params.guildId,
    method: params.request.method,
    path: params.request.path,
  });

  const payload = {
    request: params.request,
  } satisfies DiscordRestWritePendingPayload;
  const details = buildDiscordRestWriteSummary(params.request);
  const existingPending = await findMatchingPendingAdminAction({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    kind: 'discord_rest_write',
    payloadJson: payload,
  });
  const expiresAt = existingPending?.expiresAt ?? new Date(Date.now() + APPROVAL_TTL_MS);
  const pending = existingPending ?? await createPendingAdminAction({
    guildId: params.guildId,
    channelId: params.channelId,
    requestedBy: params.requestedBy,
    kind: 'discord_rest_write',
    payloadJson: payload,
    expiresAt,
  });
  const coalesced = existingPending !== null;
  const approvalMessageId = await ensureApprovalCardForPending({
    pending,
    channelId: params.channelId,
    title: 'Discord REST Write Approval',
    details,
    requestedBy: params.requestedBy,
    coalesced,
  });

  await logAdminAction({
    guildId: params.guildId,
    adminId: params.requestedBy,
    command: 'tool_discord_rest_write',
    paramsHash: computeParamsHash({
      actionId: pending.id,
      method: params.request.method,
      path: params.request.path,
    }),
  });

  return {
    status: 'pending_approval',
    actionId: pending.id,
    method: params.request.method,
    path: params.request.path,
    coalesced,
    expiresAtIso: expiresAt.toISOString(),
    approvalMessageId,
  };
}

export async function requestDiscordInteractionForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  request: DiscordInteractionRequest;
}): Promise<Record<string, unknown>> {
  if (params.invokedBy === 'autopilot') {
    throw new Error('discord_execute_interaction is disabled in autopilot turns.');
  }

  const result = await executeImmediateDiscordAction({
    guildId: params.guildId,
    channelId: params.channelId,
    requestedBy: params.requestedBy,
    action: params.request,
    enforceRequesterGuards: true,
  });

  logger.info(
    {
      guildId: params.guildId,
      channelId: params.channelId,
      requestedBy: params.requestedBy,
      action: params.request.action,
    },
    'Executed discord interaction tool action',
  );

  return result;
}

export function buildPendingAdminActionResolutionNotice(action: PendingAdminActionRecord): string {
  const decidedBy = action.decidedBy?.trim();
  const decidedByLine = decidedBy ? `By: <@${decidedBy}>` : null;

  const lines: string[] = [];
  switch (action.status) {
    case 'pending': {
      lines.push('Admin action awaiting approval.');
      break;
    }
    case 'approved': {
      lines.push('Admin action approved. Executing...');
      break;
    }
    case 'rejected': {
      lines.push('Admin action rejected.');
      break;
    }
    case 'executed': {
      lines.push('Admin action approved and executed.');
      break;
    }
    case 'failed': {
      lines.push('Admin action approved, but execution failed.');
      break;
    }
    case 'expired': {
      lines.push('Admin action expired before approval.');
      break;
    }
  }

  lines.push(`Action ID: \`${action.id}\``);
  if (decidedByLine) {
    lines.push(decidedByLine);
  }

  if (action.status === 'executed') {
    const preview = buildJsonPreviewForDisplay(action.resultJson, 900);
    const suffix = preview.truncated ? '\n(Preview truncated)' : '';
    lines.push(`Result: executed successfully.\n\`\`\`json\n${preview.text}\n\`\`\`${suffix}`);
  } else if (action.status === 'failed') {
    const errorText = truncateDiscordMessage(action.errorText ?? 'Unknown error', 900);
    lines.push(`Result: failed.\nError: ${errorText}`);
    if (action.resultJson) {
      const preview = buildJsonPreviewForDisplay(action.resultJson, 700);
      const suffix = preview.truncated ? '\n(Preview truncated)' : '';
      lines.push(`\`\`\`json\n${preview.text}\n\`\`\`${suffix}`);
    }
  } else if (action.status === 'rejected') {
    lines.push('Result: rejected.');
  } else if (action.status === 'expired') {
    lines.push('Result: expired before approval.');
  }

  return truncateDiscordMessage(lines.join('\n'));
}

function buildResolvedMessageContent(params: {
  base: string;
  actionId: string;
  decision: PendingDecision;
  actorId: string;
  outcome: string;
}): string {
  return [
    params.base,
    '',
    `Resolved: ${params.decision.toUpperCase()} by <@${params.actorId}>`,
    `Action ID: \`${params.actionId}\``,
    params.outcome,
  ].join('\n');
}

async function deleteApprovalCardForAction(action: PendingAdminActionRecord): Promise<void> {
  const approvalMessageId = action.approvalMessageId?.trim();
  if (!approvalMessageId) {
    return;
  }

  try {
    const result = await discordRestRequestGuildScoped({
      guildId: action.guildId,
      method: 'DELETE',
      path: `/channels/${action.channelId}/messages/${approvalMessageId}`,
      reason: `[sage action:${action.id}] auto-delete resolved approval card`,
      maxResponseChars: 500,
    });

    const status = typeof result.status === 'number' ? result.status : null;
    const shouldClear =
      result.ok === true ||
      status === 404 ||
      status === 403;

    if (shouldClear) {
      await clearPendingAdminActionApprovalMessageId(action.id).catch((error) => {
        logger.warn({ error, actionId: action.id }, 'Failed to clear approval message id after deletion attempt');
      });
      return;
    }

    if (status !== 429) {
      logger.warn(
        {
          actionId: action.id,
          guildId: action.guildId,
          channelId: action.channelId,
          approvalMessageId,
          status,
          statusText: typeof result.statusText === 'string' ? result.statusText : undefined,
          errorText: typeof result.error === 'string' ? result.error : undefined,
        },
        'Failed to delete resolved approval card message',
      );
    }
  } catch (error) {
    logger.warn(
      { error, actionId: action.id, guildId: action.guildId, channelId: action.channelId },
      'Resolved approval card deletion threw; clearing id to avoid repeated attempts',
    );
    await clearPendingAdminActionApprovalMessageId(action.id).catch(() => {
      // Ignore cleanup failures.
    });
  }
}

async function deleteResolvedApprovalCardForActionId(actionId: string): Promise<void> {
  const action = await getPendingAdminActionById(actionId);
  if (!action) return;
  await deleteApprovalCardForAction(action);
}

function scheduleResolvedApprovalCardDeletion(actionId: string): void {
  const timer = setTimeout(() => {
    void deleteResolvedApprovalCardForActionId(actionId).catch((error) => {
      logger.warn({ error, actionId }, 'Failed to auto-delete resolved approval card');
    });
  }, RESOLVED_APPROVAL_CARD_DELETE_DELAY_MS);
  timer.unref?.();
}

async function updateRequesterMessageForResolvedAction(action: PendingAdminActionRecord): Promise<void> {
  const requestMessageId = action.requestMessageId?.trim();
  if (!requestMessageId) {
    return;
  }

  const content = buildPendingAdminActionResolutionNotice(action);
  const result = await discordRestRequestGuildScoped({
    guildId: action.guildId,
    method: 'PATCH',
    path: `/channels/${action.channelId}/messages/${requestMessageId}`,
    body: {
      content,
      allowed_mentions: { parse: [] },
    },
  });

  if (result.ok) {
    return;
  }

  const status = String(result.status ?? 'unknown');
  const statusText = String(result.statusText ?? '');
  const errorText = String(result.error ?? 'Unknown error');
  logger.warn(
    {
      actionId: action.id,
      guildId: action.guildId,
      channelId: action.channelId,
      requestMessageId,
      status,
      statusText,
      errorText,
    },
    'Failed to update requester message for admin action',
  );

  try {
    const channel = await fetchGuildChannel(action.guildId, action.channelId);
    if (!isSendableGuildChannel(channel)) {
      return;
    }
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (fallbackError) {
    logger.warn(
      { error: fallbackError, actionId: action.id, guildId: action.guildId, channelId: action.channelId },
      'Failed to post admin action resolution fallback message',
    );
  }
}

export async function handleAdminActionButtonInteraction(
  interaction: ButtonInteraction,
): Promise<boolean> {
  const parsed = parseDecisionCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Admin action approvals are guild-only.', ephemeral: true });
    return true;
  }

  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return true;
  }

  let action = await getPendingAdminActionById(parsed.actionId);
  if (!action) {
    await interaction.reply({ content: 'Action not found.', ephemeral: true });
    return true;
  }

  if (action.guildId !== interaction.guildId) {
    await interaction.reply({ content: 'This action belongs to a different guild.', ephemeral: true });
    return true;
  }

  if (action.status !== 'pending') {
    await interaction.reply({ content: `Action is already ${action.status}.`, ephemeral: true });
    return true;
  }

  if (!action.approvalMessageId?.trim() && interaction.message?.id) {
    const updated = await attachPendingAdminActionApprovalMessageId({
      id: action.id,
      approvalMessageId: interaction.message.id,
    }).catch((error) => {
      logger.warn({ error, actionId: action?.id }, 'Failed to attach approval card message id while handling decision');
      return null;
    });

    if (updated) {
      action = updated;
    } else {
      action = { ...action, approvalMessageId: interaction.message.id };
    }
  }

  if (action.expiresAt.getTime() <= Date.now()) {
    await markPendingAdminActionExpired(action.id);
    const expired = await getPendingAdminActionById(action.id).catch(() => null);
    const content = buildResolvedMessageContent({
      base: interaction.message.content,
      actionId: action.id,
      decision: parsed.decision,
      actorId: interaction.user.id,
      outcome: 'Result: expired before approval.',
    });
    await interaction.update({ content, components: [] });
    if (expired) {
      void updateRequesterMessageForResolvedAction(expired).catch((error) => {
        logger.warn({ error, actionId: expired.id }, 'Failed to update requester message after admin action expiry');
      });
    }
    scheduleResolvedApprovalCardDeletion(action.id);
    return true;
  }

  if (parsed.decision === 'approve' && action.kind === 'discord_queue_moderation_action') {
    const payload = action.payloadJson as DiscordActionPendingPayload;
    const requiredPermission = requiredApproverPermission(payload.action);
    if (requiredPermission) {
      const memberPermissions = getInteractionMemberPermissions(interaction);
      if (!memberPermissions || !memberPermissions.has(requiredPermission.flag)) {
        await interaction.reply({
          content: `❌ Missing required permission to approve this action: ${requiredPermission.label}.`,
          ephemeral: true,
        });
        return true;
      }
    }
  }

  if (parsed.decision === 'reject') {
    const rejected = await markPendingAdminActionDecision({
      id: action.id,
      decidedBy: interaction.user.id,
      status: 'rejected',
    });
    await logAdminAction({
      guildId: action.guildId,
      adminId: interaction.user.id,
      command: 'admin_action_reject',
      paramsHash: computeParamsHash({ actionId: action.id, kind: action.kind }),
    });

    const content = buildResolvedMessageContent({
      base: interaction.message.content,
      actionId: action.id,
      decision: parsed.decision,
      actorId: interaction.user.id,
      outcome: 'Result: rejected.',
    });
    await interaction.update({ content, components: [] });
    void updateRequesterMessageForResolvedAction(rejected).catch((error) => {
      logger.warn({ error, actionId: rejected.id }, 'Failed to update requester message after admin action rejection');
    });
    scheduleResolvedApprovalCardDeletion(action.id);
    return true;
  }

  await markPendingAdminActionDecision({
    id: action.id,
    decidedBy: interaction.user.id,
    status: 'approved',
  });

  try {
    const result = await executePendingAction({
      action,
      approvedBy: interaction.user.id,
    });
    const executed = await markPendingAdminActionExecuted({
      id: action.id,
      resultJson: result,
    });

    await logAdminAction({
      guildId: action.guildId,
      adminId: interaction.user.id,
      command: 'admin_action_execute',
      paramsHash: computeParamsHash({ actionId: action.id, kind: action.kind }),
    });

    const content = buildResolvedMessageContent({
      base: interaction.message.content,
      actionId: action.id,
      decision: parsed.decision,
      actorId: interaction.user.id,
      outcome: (() => {
        const preview = buildJsonPreviewForDisplay(result, 900);
        const suffix = preview.truncated ? '\n(Preview truncated)' : '';
        return `Result: executed successfully.\n\`\`\`json\n${preview.text}\n\`\`\`${suffix}`;
      })(),
    });
    await interaction.update({ content: truncateDiscordMessage(content), components: [] });
    void updateRequesterMessageForResolvedAction(executed).catch((error) => {
      logger.warn({ error, actionId: executed.id }, 'Failed to update requester message after admin action execution');
    });
    scheduleResolvedApprovalCardDeletion(action.id);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failed = await markPendingAdminActionFailed({
      id: action.id,
      errorText: errorMessage,
    });
    logger.warn({ error, actionId: action.id }, 'Pending admin action execution failed');

    const content = buildResolvedMessageContent({
      base: interaction.message.content,
      actionId: action.id,
      decision: parsed.decision,
      actorId: interaction.user.id,
      outcome: `Result: failed.\nError: ${truncateDiscordMessage(errorMessage, 900)}`,
    });
    await interaction.update({ content: truncateDiscordMessage(content), components: [] });
    void updateRequesterMessageForResolvedAction(failed).catch((notifyError) => {
      logger.warn(
        { error: notifyError, actionId: failed.id },
        'Failed to update requester message after admin action failure',
      );
    });
    scheduleResolvedApprovalCardDeletion(action.id);
  }

  return true;
}

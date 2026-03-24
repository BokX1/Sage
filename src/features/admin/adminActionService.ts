import crypto from 'crypto';
import {
  ActionRowBuilder,
  ButtonInteraction,
  Guild,
  GuildBasedChannel,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
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
  createApprovalReviewRequest,
  attachApprovalReviewRequesterStatusMessageId,
  clearApprovalReviewReviewerMessageId,
  findMatchingPendingApprovalReviewRequest,
  getApprovalReviewRequestById,
  listApprovalReviewRequestsByThreadId,
  markApprovalReviewRequestDecisionIfPending,
  markApprovalReviewRequestExecutedIfApproved,
  markApprovalReviewRequestExpiredIfPending,
  markApprovalReviewRequestFailedIfApproved,
  listPendingApprovalReviewsExpiredBy,
  updateApprovalReviewSurface,
  type ApprovalReviewRequestRecord,
} from './approvalReviewRequestRepo';
import {
  clearGuildSagePersona,
  getGuildSagePersonaRecord,
  upsertGuildSagePersona,
} from '../settings/guildSagePersonaRepo';
import { getGuildApprovalReviewChannelId } from '../settings/guildSettingsRepo';
import { computeParamsHash, logAdminAction } from '../relationships/adminAuditRepo';
import { logger } from '../../platform/logging/logger';
import { smartSplit } from '../../shared/text/message-splitter';
import { generateTraceId } from '../../shared/observability/trace-id-generator';
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
import {
  buildApprovalActionNotFoundText,
  buildApprovalAdminOnlyText,
  buildApprovalAlreadyResolvedText,
  buildApprovalFollowUpPostFailureText,
  buildApprovalGuildOnlyText,
  buildApprovalReasonRequiredText,
  buildApprovalWrongGuildText,
  buildModerationApprovalChannelPermissionsUnknownText,
  buildModerationApprovalChannelPermissionMissingText,
  buildModerationApprovalChannelUnavailableText,
  buildModerationApprovalPermissionMissingText,
  buildModerationApprovalPermissionsUnknownText,
} from '../discord/userFacingCopy';
import { isAdminInteraction } from '../../platform/discord/admin-permissions';
import {
  buildApprovalReviewDetailsText,
  buildApprovalReviewRequesterCardPayload,
  buildApprovalReviewReviewerCardPayload,
} from './governanceCards';
import {
  computePreparedModerationDedupeKey,
  discordModerationActionRequestSchema,
  readPreparedModerationEnvelope,
  type DiscordModerationActionRequest,
  type PreparedModerationAction,
  type PreparedModerationEnvelope,
  type PreparedModerationEvidence,
} from './discordModeration';
import {
  extractTextFromMessageContent,
  type CurrentTurnContext,
  type ReplyTargetContext,
} from '../agent-runtime/continuityContext';
import { resolveRuntimeCredential } from '../agent-runtime/apiKeyResolver';
import { ApprovalRequiredSignal, type ApprovalInterruptPayload } from '../agent-runtime/toolControlSignals';

const APPROVAL_TTL_MS = 10 * 60 * 1_000;
const RESOLVED_APPROVAL_CARD_DELETE_DELAY_MS = 60_000;
const resolvedApprovalCardDeleteTimers = new Map<string, NodeJS.Timeout>();
const MAX_SAGE_PERSONA_CHARS = 8_000;
const DEFAULT_SAGE_PERSONA_MAX_CHARS = 4_000;
const ADMIN_ACTION_CUSTOM_ID_PREFIX = 'sage:admin_action:';
const ADMIN_ACTION_REJECT_MODAL_CUSTOM_ID_PREFIX = 'sage:admin_action:reject_modal:';
const ADMIN_ACTION_REJECT_REASON_FIELD_ID = 'rejection_reason';
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
const DISCORD_URL_HOSTS = new Set(['discord.com', 'canary.discord.com', 'ptb.discord.com']);
const REPLY_TARGET_ALIASES = new Set(['reply_target', 'reply', 'replied_message', 'current_reply_target']);
const DISCORD_SNOWFLAKE_EPOCH_MS = 1_420_070_400_000n;
const BULK_DELETE_MAX_MESSAGES_PER_REQUEST = 100;
const BULK_DELETE_MAX_BATCH_SIZE = 500;
const BULK_DELETE_ELIGIBILITY_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;
const PURGE_DEFAULT_LIMIT = 50;
const PURGE_DEFAULT_WINDOW_MINUTES = 60;
const PURGE_MAX_SCAN_MESSAGES = 1_000;
const DISCORD_REST_MESSAGES_PAGE_LIMIT = 100;
const LANGGRAPH_APPROVAL_BATCH_METADATA_KEY = 'langgraphApprovalBatch';

interface ApprovalBatchMetadata {
  batchId: string;
  batchIndex: number;
  batchSize: number;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readApprovalBatchMetadata(value: unknown): ApprovalBatchMetadata | null {
  if (!isJsonRecord(value)) {
    return null;
  }
  const rawBatch = value[LANGGRAPH_APPROVAL_BATCH_METADATA_KEY];
  if (!isJsonRecord(rawBatch)) {
    return null;
  }
  const batchId = typeof rawBatch.batchId === 'string' ? rawBatch.batchId.trim() : '';
  const batchIndex =
    typeof rawBatch.batchIndex === 'number' && Number.isInteger(rawBatch.batchIndex) ? rawBatch.batchIndex : -1;
  const batchSize =
    typeof rawBatch.batchSize === 'number' && Number.isInteger(rawBatch.batchSize) ? rawBatch.batchSize : -1;
  if (!batchId || batchIndex < 0 || batchSize < 1) {
    return null;
  }
  return {
    batchId,
    batchIndex,
    batchSize,
  };
}

function buildApprovalResumeDecision(action: ApprovalReviewRequestRecord): {
  requestId: string;
  status: 'approved' | 'rejected' | 'expired';
  reviewerId?: string | null;
  decisionReasonText?: string | null;
} {
  if (action.status !== 'approved' && action.status !== 'rejected' && action.status !== 'expired') {
    throw new Error(`Approval request "${action.id}" is not ready to resume with status "${action.status}".`);
  }
  return {
    requestId: action.id,
    status: action.status,
    reviewerId: action.decidedBy ?? null,
    decisionReasonText: action.decisionReasonText ?? null,
  };
}

type PendingButtonAction = 'approve' | 'reject' | 'details';

/**
 * Declares exported bindings: sagePersonaUpdateRequestSchema.
 */
export const sagePersonaUpdateRequestSchema = z.object({
  operation: z.enum(['set', 'append', 'clear']),
  text: z.string().trim().max(MAX_SAGE_PERSONA_CHARS).optional(),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Represents the SagePersonaUpdateRequest type.
 */
export type SagePersonaUpdateRequest = z.infer<typeof sagePersonaUpdateRequestSchema>;

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

export { discordModerationActionRequestSchema };
export type { DiscordModerationActionRequest };
type ImmediateDiscordAction = DiscordInteractionRequest;
type QueuedDiscordAction = PreparedModerationAction;

type SagePersonaPendingPayload = {
  operation: SagePersonaUpdateRequest['operation'];
  newInstructionsText: string;
  reason: string;
  baseVersion: number;
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
  request?: DiscordRestWriteRequest;
  requests?: DiscordRestWriteRequest[];
};

function readPendingDiscordRestWriteRequests(payload: unknown): DiscordRestWriteRequest[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Approval review REST write payload is invalid or unreadable.');
  }
  const record = payload as { request?: unknown; requests?: unknown };
  if (Array.isArray(record.requests)) {
    const requests = record.requests.filter(
      (value): value is DiscordRestWriteRequest => !!value && typeof value === 'object' && !Array.isArray(value),
    );
    if (requests.length === 0) {
      throw new Error('Approval review REST write payload is missing requests.');
    }
    return requests;
  }
  if (record.request && typeof record.request === 'object' && !Array.isArray(record.request)) {
    return [record.request as DiscordRestWriteRequest];
  }
  throw new Error('Approval review REST write payload is missing requests.');
}

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

function normalizeUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function makeAdminActionButtonCustomId(action: PendingButtonAction, actionId: string): string {
  return `${ADMIN_ACTION_CUSTOM_ID_PREFIX}${action}:${actionId}`;
}

function makeAdminActionRejectModalCustomId(actionId: string): string {
  return `${ADMIN_ACTION_REJECT_MODAL_CUSTOM_ID_PREFIX}${actionId}`;
}

function parseAdminActionButtonCustomId(
  customId: string,
): { action: PendingButtonAction; actionId: string } | null {
  if (!customId.startsWith(ADMIN_ACTION_CUSTOM_ID_PREFIX)) {
    return null;
  }

  const payload = customId.slice(ADMIN_ACTION_CUSTOM_ID_PREFIX.length);
  const [action, actionId] = payload.split(':');
  if (
    (action !== 'approve' && action !== 'reject' && action !== 'details') ||
    !actionId
  ) {
    return null;
  }

  return { action, actionId };
}

function parseAdminActionRejectModalCustomId(customId: string): string | null {
  if (!customId.startsWith(ADMIN_ACTION_REJECT_MODAL_CUSTOM_ID_PREFIX)) {
    return null;
  }
  const actionId = customId.slice(ADMIN_ACTION_REJECT_MODAL_CUSTOM_ID_PREFIX.length).trim();
  return actionId || null;
}

function buildAdminActionRejectModal(actionId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(makeAdminActionRejectModalCustomId(actionId))
    .setTitle('Reject Governance Action')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(ADMIN_ACTION_REJECT_REASON_FIELD_ID)
          .setLabel('Why are you rejecting this?')
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setPlaceholder('Give the requester a short reason they can act on.'),
      ),
    );
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
  channelId?: string;
  guildId?: string | null;
  content?: string;
  author?: {
    id?: string;
    bot?: boolean;
    username?: string;
    globalName?: string | null;
  };
  member?: {
    displayName?: string | null;
  } | null;
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

type DiscordRestChannelMessage = {
  id: string;
  channelId: string | null;
  content: string | null;
  timestampMs: number | null;
  pinned: boolean;
  authorId: string | null;
  authorDisplayName: string | null;
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

function normalizeUserId(rawUserId: string): string | null {
  const trimmed = rawUserId.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    return mentionMatch[1] ?? null;
  }
  return trimmed.length > 0 ? trimmed : null;
}

type ParsedDiscordMessageUrl = {
  guildId: string | '@me';
  channelId: string;
  messageId: string;
  normalizedUrl: string;
};

function parseDiscordMessageUrl(raw: string): ParsedDiscordMessageUrl | null {
  const trimmed = raw.trim();
  const unwrapped =
    trimmed.startsWith('<') && trimmed.endsWith('>')
      ? trimmed.slice(1, Math.max(1, trimmed.length - 1)).trim()
      : trimmed;

  let parsed: URL;
  try {
    parsed = new URL(unwrapped);
  } catch {
    return null;
  }

  if (!DISCORD_URL_HOSTS.has(parsed.hostname)) {
    return null;
  }

  const match = parsed.pathname.match(/^\/channels\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
  if (!match) {
    return null;
  }

  const [, guildId, channelId, messageId] = match;
  if (!guildId || !channelId || !messageId) {
    return null;
  }
  return {
    guildId: guildId === '@me' ? '@me' : guildId,
    channelId,
    messageId,
    normalizedUrl: `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
  };
}

function parseIsoTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSnowflakeTimestampMs(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    const snowflake = BigInt(trimmed);
    const timestampMs = Number((snowflake >> 22n) + DISCORD_SNOWFLAKE_EPOCH_MS);
    return Number.isFinite(timestampMs) ? timestampMs : null;
  } catch {
    return null;
  }
}

function isBulkDeleteEligibleMessageId(messageId: string, nowMs = Date.now()): boolean {
  const timestampMs = parseSnowflakeTimestampMs(messageId);
  if (timestampMs === null) {
    return false;
  }
  return nowMs - timestampMs < BULK_DELETE_ELIGIBILITY_WINDOW_MS;
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function chunkStrings(values: string[], chunkSize: number): string[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError('chunkSize must be a positive integer.');
  }
  if (values.length === 0) return [];

  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function readDiscordRestChannelMessages(data: unknown): DiscordRestChannelMessage[] {
  if (!Array.isArray(data)) return [];
  const messages: DiscordRestChannelMessage[] = [];

  for (const entry of data) {
    const record = normalizeUnknownRecord(entry);
    if (!record) continue;
    const id = asString(record.id);
    if (!id) continue;

    const author = normalizeUnknownRecord(record.author);
    const authorId = asString(author?.id);
    const authorDisplayName =
      asString(author?.global_name) ??
      asString(author?.username) ??
      authorId;

    messages.push({
      id,
      channelId: asString(record.channel_id),
      content: asString(record.content),
      timestampMs: parseIsoTimestampMs(asString(record.timestamp)),
      pinned: record.pinned === true,
      authorId,
      authorDisplayName,
    });
  }

  return messages;
}

async function fetchRecentChannelMessagesForPurge(params: {
  guildId: string;
  channelId: string;
  maxScan: number;
  beforeMessageId?: string | null;
}): Promise<DiscordRestChannelMessage[]> {
  const maxScan = Math.max(1, Math.min(params.maxScan, PURGE_MAX_SCAN_MESSAGES));
  const collected: DiscordRestChannelMessage[] = [];
  let before = params.beforeMessageId?.trim() || null;

  while (collected.length < maxScan) {
    const requestLimit = Math.max(
      1,
      Math.min(DISCORD_REST_MESSAGES_PAGE_LIMIT, maxScan - collected.length),
    );
    const restResult = await discordRestRequestGuildScoped({
      guildId: params.guildId,
      method: 'GET',
      path: `/channels/${params.channelId}/messages`,
      query: {
        limit: requestLimit,
        ...(before ? { before } : {}),
      },
      maxResponseChars: 50_000,
    });
    if (restResult.ok !== true) {
      throw new Error(
        `Failed to fetch channel messages for purge (${String(restResult.status ?? 'unknown')} ${String(restResult.statusText ?? '').trim()}).`,
      );
    }

    const page = readDiscordRestChannelMessages(restResult.data);
    if (page.length === 0) {
      break;
    }

    collected.push(...page);

    const lastMessageId = page[page.length - 1]?.id?.trim() || null;
    if (!lastMessageId || page.length < requestLimit) {
      break;
    }
    before = lastMessageId;
  }

  return collected.slice(0, maxScan);
}

function resolveBulkDeleteMessageTargets(params: {
  guildId: string;
  sourceChannelId: string;
  rawChannelId?: string;
  rawMessageIds: string[];
  usage: string;
}): {
  source: PreparedModerationEvidence['source'];
  channelId: string;
  messageIds: string[];
  messageUrls: string[];
} {
  const rawChannelId = params.rawChannelId?.trim() || null;
  const explicitChannelId = rawChannelId ? normalizeChannelId(rawChannelId) : null;
  const messageIdToUrl = new Map<string, string>();
  const urlTargets: ParsedDiscordMessageUrl[] = [];
  const rawIdTargets: string[] = [];

  for (const rawMessageRef of params.rawMessageIds) {
    const ref = rawMessageRef.trim();
    if (!ref) continue;
    if (isReplyTargetAlias(ref)) {
      throw new Error(`${params.usage} requires explicit message IDs or Discord message URLs.`);
    }

    const parsedUrl = parseDiscordMessageUrl(ref);
    if (parsedUrl) {
      if (parsedUrl.guildId === '@me') {
        throw new Error(`${params.usage} cannot target DM message URLs.`);
      }
      if (parsedUrl.guildId !== params.guildId) {
        throw new Error(`${params.usage} cannot target messages from another guild.`);
      }
      urlTargets.push(parsedUrl);
      continue;
    }

    if (!/^\d+$/.test(ref)) {
      throw new Error(`${params.usage} requires message IDs or valid Discord message URLs.`);
    }
    rawIdTargets.push(ref);
  }

  if (urlTargets.length === 0 && rawIdTargets.length === 0) {
    throw new Error(`${params.usage} requires at least one target message.`);
  }

  const inferredUrlChannelIds = new Set(urlTargets.map((target) => target.channelId));
  if (inferredUrlChannelIds.size > 1) {
    throw new Error(`${params.usage} cannot mix message targets from different channels.`);
  }
  const inferredUrlChannelId = inferredUrlChannelIds.values().next().value as string | undefined;
  if (explicitChannelId && inferredUrlChannelId && explicitChannelId !== inferredUrlChannelId) {
    throw new Error(`${params.usage} cannot mix message targets from different channels.`);
  }

  const channelId = explicitChannelId ?? inferredUrlChannelId ?? params.sourceChannelId;

  for (const parsedUrl of urlTargets) {
    if (!messageIdToUrl.has(parsedUrl.messageId)) {
      messageIdToUrl.set(parsedUrl.messageId, parsedUrl.normalizedUrl);
    }
  }
  for (const messageId of rawIdTargets) {
    if (!messageIdToUrl.has(messageId)) {
      messageIdToUrl.set(messageId, buildDiscordMessageUrl(params.guildId, channelId, messageId));
    }
  }

  if (messageIdToUrl.size > BULK_DELETE_MAX_BATCH_SIZE) {
    throw new Error(`${params.usage} supports at most ${BULK_DELETE_MAX_BATCH_SIZE} target messages.`);
  }

  const canonicalEntries = Array.from(messageIdToUrl.entries())
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));

  return {
    source: 'bulk_explicit_ids',
    channelId,
    messageIds: canonicalEntries.map(([messageId]) => messageId),
    messageUrls: canonicalEntries.map(([, messageUrl]) => messageUrl),
  };
}

function isReplyTargetAlias(value: string | null | undefined): boolean {
  if (!value) return true;
  return REPLY_TARGET_ALIASES.has(value.trim().toLowerCase());
}

function buildDiscordMessageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function extractReplyTargetPreview(replyTarget: ReplyTargetContext | null | undefined): {
  messageExcerpt: string | null;
  messageAuthorDisplayName: string | null;
} {
  if (!replyTarget) {
    return { messageExcerpt: null, messageAuthorDisplayName: null };
  }

  const content = extractTextFromMessageContent(replyTarget.content);
  return {
    messageExcerpt: content ? truncateWithFlag(content.replace(/\s+/g, ' ').trim(), 220).text : null,
    messageAuthorDisplayName: replyTarget.authorDisplayName.trim() || null,
  };
}

function extractMessagePreview(message: GuildMessageLike): {
  messageExcerpt: string | null;
  messageAuthorId: string | null;
  messageAuthorDisplayName: string | null;
} {
  const content = typeof message.content === 'string' ? message.content.replace(/\s+/g, ' ').trim() : '';
  const authorId = message.author?.id?.trim() || null;
  const messageAuthorDisplayName =
    message.member?.displayName?.trim() ||
    message.author?.globalName?.trim() ||
    message.author?.username?.trim() ||
    authorId;

  return {
    messageExcerpt: content ? truncateWithFlag(content, 220).text : null,
    messageAuthorId: authorId,
    messageAuthorDisplayName,
  };
}

function readDiscordErrorCode(error: unknown): number | string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number' || typeof code === 'string') {
    return code;
  }
  return null;
}

function isDiscordNotFoundError(error: unknown): boolean {
  const code = readDiscordErrorCode(error);
  if (code === 10003 || code === 10008 || code === 10013 || code === 10014 || code === 10026) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('unknown message') ||
    message.includes('unknown channel') ||
    message.includes('unknown member') ||
    message.includes('unknown ban') ||
    message.includes('not found')
  );
}

async function fetchGuildMessageOrNull(channel: GuildBasedChannel, messageId: string): Promise<GuildMessageLike | null> {
  return fetchGuildMessage(channel, messageId).catch((error) => {
    if (isDiscordNotFoundError(error)) {
      return null;
    }
    throw error;
  });
}

type RequiredModerationPermission = {
  flag: bigint;
  label: string;
  scope: 'channel' | 'guild';
};

type ResolvedMessageTarget = {
  source: PreparedModerationEvidence['source'];
  channelId: string;
  messageId: string;
  messageUrl: string | null;
};

type ResolvedMemberTarget = {
  source: PreparedModerationEvidence['source'];
  userId: string;
  messageUrl: string | null;
  evidenceChannelId: string | null;
  evidenceMessageId: string | null;
};

type PreparedModerationDeps = {
  guildId: string;
  sourceChannelId: string;
  request: DiscordModerationActionRequest;
  currentTurn?: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
};

function computeModerationDedupeKey(action: PreparedModerationAction): string {
  return computePreparedModerationDedupeKey(action);
}

function assertReplyTargetInGuild(params: {
  guildId: string;
  replyTarget?: ReplyTargetContext | null;
  usage: string;
}): ReplyTargetContext {
  const replyTarget = params.replyTarget;
  if (!replyTarget) {
    throw new Error(`${params.usage} requires either an explicit target or a direct reply target.`);
  }
  if ((replyTarget.guildId ?? null) !== params.guildId) {
    throw new Error(`${params.usage} can only target messages from the active guild.`);
  }
  return replyTarget;
}

function resolveMessageTarget(params: {
  guildId: string;
  sourceChannelId: string;
  rawMessageId?: string;
  rawChannelId?: string;
  replyTarget?: ReplyTargetContext | null;
  usage: string;
}): ResolvedMessageTarget {
  const rawMessageId = params.rawMessageId?.trim() || null;
  const rawChannelId = params.rawChannelId?.trim() || null;

  if (rawMessageId && !isReplyTargetAlias(rawMessageId)) {
    const parsedUrl = parseDiscordMessageUrl(rawMessageId);
    if (parsedUrl) {
      if (parsedUrl.guildId === '@me') {
        throw new Error(`${params.usage} cannot target DM message URLs.`);
      }
      if (parsedUrl.guildId !== params.guildId) {
        throw new Error(`${params.usage} cannot target a message from another guild.`);
      }

      const explicitChannelId = rawChannelId ? normalizeChannelId(rawChannelId) : null;
      if (explicitChannelId && explicitChannelId !== parsedUrl.channelId) {
        throw new Error(`${params.usage} received conflicting channel and message references.`);
      }

      return {
        source: 'message_url',
        channelId: parsedUrl.channelId,
        messageId: parsedUrl.messageId,
        messageUrl: parsedUrl.normalizedUrl,
      };
    }

    const channelId = rawChannelId ? normalizeChannelId(rawChannelId) : params.sourceChannelId;
    return {
      source: rawChannelId ? (rawChannelId.startsWith('<#') ? 'channel_mention' : 'explicit_id') : 'current_channel_default',
      channelId,
      messageId: rawMessageId,
      messageUrl: buildDiscordMessageUrl(params.guildId, channelId, rawMessageId),
    };
  }

  const replyTarget = assertReplyTargetInGuild({
    guildId: params.guildId,
    replyTarget: params.replyTarget,
    usage: params.usage,
  });
  return {
    source: 'reply_target',
    channelId: replyTarget.channelId,
    messageId: replyTarget.messageId,
    messageUrl: buildDiscordMessageUrl(params.guildId, replyTarget.channelId, replyTarget.messageId),
  };
}

function resolveMemberTargetInput(params: {
  guildId: string;
  rawUserId?: string;
  replyTarget?: ReplyTargetContext | null;
  usage: string;
  allowReplyTargetInference?: boolean;
}): ResolvedMemberTarget {
  const rawUserId = params.rawUserId?.trim() || null;

  if (rawUserId && !isReplyTargetAlias(rawUserId)) {
    const parsedUrl = parseDiscordMessageUrl(rawUserId);
    if (parsedUrl) {
      if (parsedUrl.guildId === '@me') {
        throw new Error(`${params.usage} cannot target DM message URLs.`);
      }
      if (parsedUrl.guildId !== params.guildId) {
        throw new Error(`${params.usage} cannot target a message from another guild.`);
      }
      return {
        source: 'message_author_url',
        userId: '',
        messageUrl: parsedUrl.normalizedUrl,
        evidenceChannelId: parsedUrl.channelId,
        evidenceMessageId: parsedUrl.messageId,
      };
    }

    const parsedUserId = normalizeUserId(rawUserId);
    if (parsedUserId) {
      return {
        source: rawUserId.startsWith('<@') ? 'user_mention' : 'explicit_id',
        userId: parsedUserId,
        messageUrl: null,
        evidenceChannelId: null,
        evidenceMessageId: null,
      };
    }

    throw new Error(`${params.usage} requires a Discord user mention, user ID, message URL, or direct reply target.`);
  }

  if (params.allowReplyTargetInference === false) {
    throw new Error(`${params.usage} requires an explicit Discord user mention, user ID, or message URL for the member target.`);
  }

  const replyTarget = assertReplyTargetInGuild({
    guildId: params.guildId,
    replyTarget: params.replyTarget,
    usage: params.usage,
  });
  if (replyTarget.authorIsBot) {
    throw new Error(`${params.usage} cannot infer a member target from a bot-authored reply target.`);
  }
  return {
    source: 'reply_target',
    userId: replyTarget.authorId,
    messageUrl: buildDiscordMessageUrl(params.guildId, replyTarget.channelId, replyTarget.messageId),
    evidenceChannelId: replyTarget.channelId,
    evidenceMessageId: replyTarget.messageId,
  };
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

function requiredApproverPermission(
  action: QueuedDiscordAction,
): RequiredModerationPermission | null {
  switch (action.action) {
    case 'delete_message':
    case 'bulk_delete_messages':
    case 'remove_user_reaction':
    case 'clear_reactions':
      return { flag: PermissionsBitField.Flags.ManageMessages, label: 'Manage Messages', scope: 'channel' };
    case 'timeout_member':
    case 'untimeout_member':
      return { flag: PermissionsBitField.Flags.ModerateMembers, label: 'Moderate Members', scope: 'guild' };
    case 'kick_member':
      return { flag: PermissionsBitField.Flags.KickMembers, label: 'Kick Members', scope: 'guild' };
    case 'ban_member':
    case 'unban_member':
      return { flag: PermissionsBitField.Flags.BanMembers, label: 'Ban Members', scope: 'guild' };
    default:
      return null;
  }
}

function assertPermissionSet(params: {
  permissions: Readonly<PermissionsBitField>;
  required: RequiredModerationPermission[];
  actorLabel: string;
  location?: string | null;
}): void {
  const missing = params.required.filter((item) => !params.permissions.has(item.flag));
  if (missing.length === 0) {
    return;
  }
  const labels = missing.map((item) => item.label).join(', ');
  const suffix = params.location ? ` in ${params.location}` : '';
  throw new Error(`${params.actorLabel} lacks required permission(s)${suffix}: ${labels}.`);
}

function moderationBotPermissionsForAction(action: DiscordModerationActionRequest['action']): RequiredModerationPermission[] {
  switch (action) {
    case 'delete_message':
    case 'bulk_delete_messages':
      return [{ flag: PermissionsBitField.Flags.ManageMessages, label: 'Manage Messages', scope: 'channel' }];
    case 'purge_recent_messages':
      return [
        { flag: PermissionsBitField.Flags.ManageMessages, label: 'Manage Messages', scope: 'channel' },
        { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'Read Message History', scope: 'channel' },
      ];
    case 'remove_user_reaction':
    case 'clear_reactions':
      return [
        { flag: PermissionsBitField.Flags.ManageMessages, label: 'Manage Messages', scope: 'channel' },
        { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'Read Message History', scope: 'channel' },
      ];
    case 'timeout_member':
    case 'untimeout_member':
      return [{ flag: PermissionsBitField.Flags.ModerateMembers, label: 'Moderate Members', scope: 'guild' }];
    case 'kick_member':
      return [{ flag: PermissionsBitField.Flags.KickMembers, label: 'Kick Members', scope: 'guild' }];
    case 'ban_member':
    case 'unban_member':
      return [{ flag: PermissionsBitField.Flags.BanMembers, label: 'Ban Members', scope: 'guild' }];
    default:
      return [];
  }
}

export function getRequiredModerationRequesterPermission(
  action: DiscordModerationActionRequest['action'],
): { flag: bigint; label: string; scope: 'channel' | 'guild' } {
  switch (action) {
    case 'delete_message':
    case 'bulk_delete_messages':
    case 'purge_recent_messages':
    case 'remove_user_reaction':
    case 'clear_reactions':
      return { flag: PermissionsBitField.Flags.ManageMessages, label: 'Manage Messages', scope: 'channel' };
    case 'timeout_member':
    case 'untimeout_member':
      return { flag: PermissionsBitField.Flags.ModerateMembers, label: 'Moderate Members', scope: 'guild' };
    case 'kick_member':
      return { flag: PermissionsBitField.Flags.KickMembers, label: 'Kick Members', scope: 'guild' };
    case 'ban_member':
    case 'unban_member':
      return { flag: PermissionsBitField.Flags.BanMembers, label: 'Ban Members', scope: 'guild' };
    default:
      throw new Error(`Unsupported moderation action: ${action satisfies never}`);
  }
}

export function resolveModerationActionChannelId(params: {
  guildId: string;
  sourceChannelId: string;
  request: DiscordModerationActionRequest;
  replyTarget?: ReplyTargetContext | null;
}): string | null {
  if (params.request.action === 'bulk_delete_messages') {
    return resolveBulkDeleteMessageTargets({
      guildId: params.guildId,
      sourceChannelId: params.sourceChannelId,
      rawChannelId: params.request.channelId,
      rawMessageIds: params.request.messageIds,
      usage: 'discord_moderation_submit_action (bulk_delete_messages)',
    }).channelId;
  }

  if (params.request.action === 'purge_recent_messages') {
    const rawChannelId = params.request.channelId?.trim();
    return rawChannelId ? normalizeChannelId(rawChannelId) : params.sourceChannelId;
  }

  if (
    params.request.action === 'delete_message' ||
    params.request.action === 'clear_reactions' ||
    params.request.action === 'remove_user_reaction'
  ) {
    return resolveMessageTarget({
      guildId: params.guildId,
      sourceChannelId: params.sourceChannelId,
      rawMessageId: params.request.messageId,
      rawChannelId: params.request.channelId,
      replyTarget: params.replyTarget,
      usage: `discord_moderation_submit_action (${params.request.action})`,
    }).channelId;
  }

  return null;
}

function buildNormalizedOriginalRequest(
  original: DiscordModerationActionRequest,
  canonicalAction: PreparedModerationAction,
): DiscordModerationActionRequest {
  switch (canonicalAction.action) {
    case 'remove_user_reaction':
      return {
        action: canonicalAction.action,
        channelId: canonicalAction.channelId,
        messageId: canonicalAction.messageId,
        emoji: canonicalAction.emoji,
        userId: canonicalAction.userId,
        reason: canonicalAction.reason,
      };
    case 'clear_reactions':
    case 'delete_message':
      return {
        action: canonicalAction.action,
        channelId: canonicalAction.channelId,
        messageId: canonicalAction.messageId,
        reason: canonicalAction.reason,
      };
    case 'bulk_delete_messages':
      return {
        action: canonicalAction.action,
        channelId: canonicalAction.channelId,
        messageIds: canonicalAction.messageIds,
        reason: canonicalAction.reason,
      };
    case 'timeout_member':
      return {
        action: canonicalAction.action,
        userId: canonicalAction.userId,
        durationMinutes: canonicalAction.durationMinutes,
        reason: canonicalAction.reason,
      };
    case 'ban_member':
      return {
        action: canonicalAction.action,
        userId: canonicalAction.userId,
        deleteMessageSeconds: canonicalAction.deleteMessageSeconds,
        reason: canonicalAction.reason,
      };
    case 'untimeout_member':
    case 'kick_member':
    case 'unban_member':
      return {
        action: canonicalAction.action,
        userId: canonicalAction.userId,
        reason: canonicalAction.reason,
      };
    default:
      return original;
  }
}

async function resolveMemberEvidenceMessage(params: {
  guildId: string;
  evidenceChannelId: string;
  evidenceMessageId: string;
}): Promise<GuildMessageLike> {
  const channel = await fetchGuildChannel(params.guildId, params.evidenceChannelId);
  const message = await fetchGuildMessageOrNull(channel, params.evidenceMessageId);
  if (!message) {
    throw new Error('Referenced moderation evidence message was not found.');
  }
  return message;
}

async function prepareMessageModerationEnvelope(
  params: PreparedModerationDeps,
): Promise<PreparedModerationEnvelope> {
  const request = params.request;
  const { botMember } = await fetchGuildAndBotMember(params.guildId);
  const botRequirements = moderationBotPermissionsForAction(request.action);

  if (request.action === 'bulk_delete_messages') {
    const resolvedTargets = resolveBulkDeleteMessageTargets({
      guildId: params.guildId,
      sourceChannelId: params.sourceChannelId,
      rawChannelId: request.channelId,
      rawMessageIds: request.messageIds,
      usage: 'discord_moderation_submit_action (bulk_delete_messages)',
    });
    const channel = await fetchGuildChannel(params.guildId, resolvedTargets.channelId);
    const botChannelPermissions = botMember.permissionsIn(channel);
    assertPermissionSet({
      permissions: botChannelPermissions,
      required: botRequirements.filter((item) => item.scope === 'channel'),
      actorLabel: 'Bot',
      location: `channel ${channel.id}`,
    });
    assertPermissionSet({
      permissions: botMember.permissions,
      required: botRequirements.filter((item) => item.scope === 'guild'),
      actorLabel: 'Bot',
      location: 'the guild',
    });

    const canonicalAction: PreparedModerationAction = {
      action: 'bulk_delete_messages',
      channelId: channel.id,
      messageIds: resolvedTargets.messageIds,
      reason: request.reason,
    };
    const approverPermission = requiredApproverPermission(canonicalAction);
    const firstMessageId = resolvedTargets.messageIds[0] ?? null;
    const firstMessageUrl = resolvedTargets.messageUrls[0] ?? null;

    return {
      version: 1,
      originalRequest: buildNormalizedOriginalRequest(request, canonicalAction),
      canonicalAction,
      evidence: {
        targetKind: 'message',
        source: resolvedTargets.source,
        channelId: channel.id,
        messageId: firstMessageId,
        messageUrl: firstMessageUrl,
        userId: null,
        messageAuthorId: null,
        messageAuthorDisplayName: null,
        messageExcerpt: `Resolved ${resolvedTargets.messageIds.length} explicit message target(s) for bulk deletion.`,
      },
      preflight: {
        approverPermission: approverPermission?.label ?? null,
        botPermissionChecks: botRequirements.map((item) => item.label),
        targetChannelScope: channel.id,
        hierarchyChecked: false,
        notes: [
          `Resolved ${resolvedTargets.messageIds.length} explicit message target(s) in <#${channel.id}>.`,
          `Verified bot permissions in <#${channel.id}> before queueing approval.`,
          'Execution policy: skip messages older than 14 days and report them in the outcome summary.',
        ],
      },
      dedupeKey: computeModerationDedupeKey(canonicalAction),
    };
  }

  if (request.action === 'purge_recent_messages') {
    const targetChannelId = request.channelId?.trim()
      ? normalizeChannelId(request.channelId)
      : params.sourceChannelId;
    const channel = await fetchGuildChannel(params.guildId, targetChannelId);
    const botChannelPermissions = botMember.permissionsIn(channel);
    assertPermissionSet({
      permissions: botChannelPermissions,
      required: botRequirements.filter((item) => item.scope === 'channel'),
      actorLabel: 'Bot',
      location: `channel ${channel.id}`,
    });
    assertPermissionSet({
      permissions: botMember.permissions,
      required: botRequirements.filter((item) => item.scope === 'guild'),
      actorLabel: 'Bot',
      location: 'the guild',
    });

    let authorUserId: string | null = null;
    if (request.authorUserId?.trim()) {
      const resolvedUser = resolveMemberTargetInput({
        guildId: params.guildId,
        rawUserId: request.authorUserId,
        replyTarget: params.replyTarget,
        usage: 'discord_moderation_submit_action (purge_recent_messages authorUserId)',
        allowReplyTargetInference: false,
      });
      authorUserId = resolvedUser.userId;
      if (!authorUserId && resolvedUser.evidenceChannelId && resolvedUser.evidenceMessageId) {
        const evidenceMessage = await resolveMemberEvidenceMessage({
          guildId: params.guildId,
          evidenceChannelId: resolvedUser.evidenceChannelId,
          evidenceMessageId: resolvedUser.evidenceMessageId,
        });
        authorUserId = evidenceMessage.author?.id?.trim() || null;
      }
      if (!authorUserId) {
        throw new Error('Unable to resolve purge_recent_messages author filter user.');
      }
    }

    const purgeLimit = request.limit ?? PURGE_DEFAULT_LIMIT;
    const windowMinutes = request.windowMinutes ?? PURGE_DEFAULT_WINDOW_MINUTES;
    const includePinned = request.includePinned === true;
    const maxScan = Math.max(
      DISCORD_REST_MESSAGES_PAGE_LIMIT,
      Math.min(PURGE_MAX_SCAN_MESSAGES, purgeLimit * 5),
    );
    const scannedMessages = await fetchRecentChannelMessagesForPurge({
      guildId: params.guildId,
      channelId: channel.id,
      maxScan,
    });
    const cutoffMs = Date.now() - windowMinutes * 60_000;
    const matchedMessages: DiscordRestChannelMessage[] = [];
    let skippedByWindow = 0;
    let skippedByAuthor = 0;
    let skippedPinned = 0;

    for (const message of scannedMessages) {
      if (message.timestampMs !== null && message.timestampMs < cutoffMs) {
        skippedByWindow += 1;
        continue;
      }
      if (!includePinned && message.pinned) {
        skippedPinned += 1;
        continue;
      }
      if (authorUserId && message.authorId !== authorUserId) {
        skippedByAuthor += 1;
        continue;
      }
      matchedMessages.push(message);
      if (matchedMessages.length >= purgeLimit) {
        break;
      }
    }

    const matchedMessageIds = dedupeStrings(matchedMessages.map((message) => message.id))
      .slice(0, purgeLimit);
    if (matchedMessageIds.length === 0) {
      throw new Error('No recent messages matched the purge criteria in the target channel.');
    }
    const canonicalMessageIds = [...matchedMessageIds].sort((left, right) => left.localeCompare(right));

    const canonicalAction: PreparedModerationAction = {
      action: 'bulk_delete_messages',
      channelId: channel.id,
      messageIds: canonicalMessageIds,
      reason: request.reason,
    };
    const approverPermission = requiredApproverPermission(canonicalAction);
    const firstMatchedMessage = matchedMessages[0] ?? null;
    const firstMessageId = matchedMessageIds[0] ?? null;
    const firstMessageUrl = firstMessageId
      ? buildDiscordMessageUrl(params.guildId, channel.id, firstMessageId)
      : null;
    const firstMessageExcerpt = firstMatchedMessage?.content
      ? truncateWithFlag(firstMatchedMessage.content.replace(/\s+/g, ' ').trim(), 220).text
      : null;

    return {
      version: 1,
      originalRequest: request,
      canonicalAction,
      evidence: {
        targetKind: 'message',
        source: 'purge_recent_scan',
        channelId: channel.id,
        messageId: firstMessageId,
        messageUrl: firstMessageUrl,
        userId: authorUserId ?? firstMatchedMessage?.authorId ?? null,
        messageAuthorId: firstMatchedMessage?.authorId ?? null,
        messageAuthorDisplayName: firstMatchedMessage?.authorDisplayName ?? null,
        messageExcerpt: firstMessageExcerpt ?? `Resolved purge to ${matchedMessageIds.length} message(s).`,
      },
      preflight: {
        approverPermission: approverPermission?.label ?? null,
        botPermissionChecks: botRequirements.map((item) => item.label),
        targetChannelScope: channel.id,
        hierarchyChecked: false,
        notes: [
          `Resolved purge criteria against live Discord history in <#${channel.id}>.`,
          `Matched ${matchedMessageIds.length} message(s) from ${scannedMessages.length} scanned (limit=${purgeLimit}, windowMinutes=${windowMinutes}, includePinned=${includePinned}${authorUserId ? `, author=<@${authorUserId}>` : ''}).`,
          `Filter summary: skippedByWindow=${skippedByWindow}, skippedByAuthor=${skippedByAuthor}, skippedPinned=${skippedPinned}.`,
          'Execution policy: skip messages older than 14 days and report them in the outcome summary.',
        ],
      },
      dedupeKey: computeModerationDedupeKey(canonicalAction),
    };
  }

  const target = resolveMessageTarget({
    guildId: params.guildId,
    sourceChannelId: params.sourceChannelId,
    rawMessageId: 'messageId' in request ? request.messageId : undefined,
    rawChannelId: 'channelId' in request ? request.channelId : undefined,
    replyTarget: params.replyTarget,
    usage: `discord_moderation_submit_action (${request.action})`,
  });
  const channel = await fetchGuildChannel(params.guildId, target.channelId);
  const botChannelPermissions = botMember.permissionsIn(channel);
  assertPermissionSet({
    permissions: botChannelPermissions,
    required: botRequirements.filter((item) => item.scope === 'channel'),
    actorLabel: 'Bot',
    location: `channel ${channel.id}`,
  });
  assertPermissionSet({
    permissions: botMember.permissions,
    required: botRequirements.filter((item) => item.scope === 'guild'),
    actorLabel: 'Bot',
    location: 'the guild',
  });

  const message = await fetchGuildMessageOrNull(channel, target.messageId);
  if (!message) {
    throw new Error('Target message was not found in the active guild.');
  }

  const messagePreview = extractMessagePreview(message);
  const replyPreview = extractReplyTargetPreview(params.replyTarget);
  const messageUrl = target.messageUrl ?? buildDiscordMessageUrl(params.guildId, channel.id, message.id);
  const approverPermission = requiredApproverPermission({
    action: request.action,
    channelId: channel.id,
    messageId: message.id,
    reason: request.reason,
    ...(request.action === 'remove_user_reaction'
      ? {
          emoji: normalizeEmojiIdentifier(request.emoji),
          userId: '',
        }
      : {}),
  } as QueuedDiscordAction);

  if (request.action === 'delete_message' || request.action === 'clear_reactions') {
    const canonicalAction: PreparedModerationAction = {
      action: request.action,
      channelId: channel.id,
      messageId: message.id,
      reason: request.reason,
    };
    return {
      version: 1,
      originalRequest: buildNormalizedOriginalRequest(request, canonicalAction),
      canonicalAction,
      evidence: {
        targetKind: request.action === 'clear_reactions' ? 'reaction' : 'message',
        source: target.source,
        channelId: channel.id,
        messageId: message.id,
        messageUrl,
        userId: messagePreview.messageAuthorId,
        messageAuthorId: messagePreview.messageAuthorId,
        messageAuthorDisplayName: messagePreview.messageAuthorDisplayName ?? replyPreview.messageAuthorDisplayName,
        messageExcerpt: messagePreview.messageExcerpt ?? replyPreview.messageExcerpt,
      },
      preflight: {
        approverPermission: approverPermission?.label ?? null,
        botPermissionChecks: botRequirements.map((item) => item.label),
        targetChannelScope: channel.id,
        hierarchyChecked: false,
        notes: [
          target.source === 'reply_target'
            ? 'Resolved the moderation target from the direct reply target.'
            : 'Resolved the moderation target from explicit Discord identifiers.',
          `Verified bot permissions in <#${channel.id}> before queueing approval.`,
        ],
      },
      dedupeKey: computeModerationDedupeKey(canonicalAction),
    };
  }

  if (request.action !== 'remove_user_reaction') {
    throw new Error('Unsupported message moderation request.');
  }

  const resolvedUser = resolveMemberTargetInput({
    guildId: params.guildId,
    rawUserId: request.userId,
    replyTarget: params.replyTarget,
    usage: 'discord_moderation_submit_action (remove_user_reaction)',
    allowReplyTargetInference: false,
  });

  let resolvedUserId = resolvedUser.userId;
  if (!resolvedUserId && resolvedUser.evidenceChannelId && resolvedUser.evidenceMessageId) {
    const evidenceMessage = await resolveMemberEvidenceMessage({
      guildId: params.guildId,
      evidenceChannelId: resolvedUser.evidenceChannelId,
      evidenceMessageId: resolvedUser.evidenceMessageId,
    });
    resolvedUserId = evidenceMessage.author?.id?.trim() || '';
  }
  if (!resolvedUserId) {
    throw new Error('Unable to resolve the reaction target user.');
  }

  const emoji = normalizeEmojiIdentifier(request.emoji);
  const reaction = await resolveMessageReaction(message, emoji);
  if (!reaction) {
    throw new Error('Target reaction was not found on the target message.');
  }

  const canonicalAction: PreparedModerationAction = {
    action: 'remove_user_reaction',
    channelId: channel.id,
    messageId: message.id,
    emoji,
    userId: resolvedUserId,
    reason: request.reason,
  };
  return {
    version: 1,
    originalRequest: buildNormalizedOriginalRequest(request, canonicalAction),
    canonicalAction,
    evidence: {
      targetKind: 'reaction',
      source: resolvedUser.source === 'message_author_url' ? 'message_author_url' : target.source,
      channelId: channel.id,
      messageId: message.id,
      messageUrl,
      userId: resolvedUserId,
      messageAuthorId: messagePreview.messageAuthorId,
      messageAuthorDisplayName: messagePreview.messageAuthorDisplayName,
      messageExcerpt: messagePreview.messageExcerpt,
    },
    preflight: {
      approverPermission: approverPermission?.label ?? null,
      botPermissionChecks: botRequirements.map((item) => item.label),
      targetChannelScope: channel.id,
      hierarchyChecked: false,
      notes: [
        target.source === 'reply_target'
          ? 'Resolved the target message from the direct reply target.'
          : 'Resolved the target message from explicit Discord identifiers.',
        resolvedUser.source === 'message_author_url'
          ? 'Resolved the reaction user from a referenced message author.'
          : 'Resolved the reaction user from an explicit user reference.',
      ],
    },
    dedupeKey: computeModerationDedupeKey(canonicalAction),
  };
}

async function prepareMemberModerationEnvelope(
  params: PreparedModerationDeps,
): Promise<PreparedModerationEnvelope> {
  if (
    params.request.action !== 'timeout_member' &&
    params.request.action !== 'untimeout_member' &&
    params.request.action !== 'kick_member' &&
    params.request.action !== 'ban_member' &&
    params.request.action !== 'unban_member'
  ) {
    throw new Error('Unsupported member moderation request.');
  }

  const request = params.request;
  const resolved = resolveMemberTargetInput({
    guildId: params.guildId,
    rawUserId: request.userId,
    replyTarget: params.replyTarget,
    usage: `discord_moderation_submit_action (${request.action})`,
  });
  const { guild, botMember } = await fetchGuildAndBotMember(params.guildId);
  const botRequirements = moderationBotPermissionsForAction(request.action);
  assertPermissionSet({
    permissions: botMember.permissions,
    required: botRequirements,
    actorLabel: 'Bot',
    location: 'the guild',
  });

  let evidence: PreparedModerationEvidence = {
    targetKind: 'member',
    source: resolved.source,
    channelId: resolved.evidenceChannelId,
    messageId: resolved.evidenceMessageId,
    messageUrl: resolved.messageUrl,
    userId: null,
    messageAuthorId: null,
    messageAuthorDisplayName: null,
    messageExcerpt: null,
  };
  let userId = resolved.userId;

  if (!userId && resolved.evidenceChannelId && resolved.evidenceMessageId) {
    const evidenceMessage = await resolveMemberEvidenceMessage({
      guildId: params.guildId,
      evidenceChannelId: resolved.evidenceChannelId,
      evidenceMessageId: resolved.evidenceMessageId,
    });
    const messagePreview = extractMessagePreview(evidenceMessage);
    userId = messagePreview.messageAuthorId ?? '';
    evidence = {
      ...evidence,
      userId,
      messageAuthorId: messagePreview.messageAuthorId,
      messageAuthorDisplayName: messagePreview.messageAuthorDisplayName,
      messageExcerpt: messagePreview.messageExcerpt,
      messageUrl:
        resolved.messageUrl ??
        buildDiscordMessageUrl(params.guildId, resolved.evidenceChannelId, resolved.evidenceMessageId),
    };
  } else if (resolved.source === 'reply_target') {
    const replyTarget = assertReplyTargetInGuild({
      guildId: params.guildId,
      replyTarget: params.replyTarget,
    usage: `discord_moderation_submit_action (${params.request.action})`,
    });
    const replyPreview = extractReplyTargetPreview(replyTarget);
    evidence = {
      ...evidence,
      userId,
      messageAuthorId: replyTarget.authorId,
      messageAuthorDisplayName: replyPreview.messageAuthorDisplayName,
      messageExcerpt: replyPreview.messageExcerpt,
      messageUrl: buildDiscordMessageUrl(params.guildId, replyTarget.channelId, replyTarget.messageId),
    };
  } else {
    evidence = {
      ...evidence,
      userId,
    };
  }

  if (!userId) {
    throw new Error('Unable to resolve the member target for moderation.');
  }

  const approverPermission = requiredApproverPermission({
    action: request.action,
    userId,
    reason: request.reason,
    ...(request.action === 'timeout_member'
      ? { durationMinutes: request.durationMinutes }
      : {}),
    ...(request.action === 'ban_member'
      ? { deleteMessageSeconds: request.deleteMessageSeconds }
      : {}),
  } as QueuedDiscordAction);

  let hierarchyChecked = false;
  let hierarchyNote = 'No role-hierarchy check was required for this action.';
  if (request.action === 'unban_member') {
    const existingBan = await guild.bans.fetch(userId).catch((error) => {
      if (isDiscordNotFoundError(error)) return null;
      throw error;
    });
    if (!existingBan) {
      throw new Error('Target user is not currently banned.');
    }
  } else {
    const targetMember = await guild.members.fetch(userId).catch((error) => {
      if (isDiscordNotFoundError(error)) return null;
      throw error;
    });
    if (!targetMember && request.action !== 'ban_member') {
      throw new Error('Target member was not found in the active guild.');
    }

    if (request.action === 'ban_member' && !targetMember) {
      hierarchyNote = 'Target user was not an active guild member during preflight; Sage will execute the ban by raw user ID if approved.';
    }

    if (request.action === 'untimeout_member' && targetMember && !targetMember.communicationDisabledUntilTimestamp) {
      throw new Error('Target member is not currently timed out.');
    }

    if (
      targetMember &&
      (request.action === 'timeout_member' ||
        request.action === 'untimeout_member' ||
        request.action === 'kick_member' ||
        request.action === 'ban_member')
    ) {
      assertMemberHierarchy(botMember, targetMember);
      hierarchyChecked = true;
      hierarchyNote = 'Verified the target member is below Sage in the role hierarchy.';
    }
  }

  let canonicalAction: PreparedModerationAction;
  switch (request.action) {
    case 'timeout_member':
      canonicalAction = {
        action: 'timeout_member',
        userId,
        durationMinutes: request.durationMinutes,
        reason: request.reason,
      };
      break;
    case 'ban_member':
      canonicalAction = {
        action: 'ban_member',
        userId,
        deleteMessageSeconds: request.deleteMessageSeconds,
        reason: request.reason,
      };
      break;
    case 'untimeout_member':
    case 'kick_member':
    case 'unban_member':
      canonicalAction = {
        action: request.action,
        userId,
        reason: request.reason,
      };
      break;
    default:
      throw new Error('Unsupported member moderation request.');
  }

  return {
    version: 1,
    originalRequest: buildNormalizedOriginalRequest(request, canonicalAction),
    canonicalAction,
    evidence,
    preflight: {
      approverPermission: approverPermission?.label ?? null,
      botPermissionChecks: botRequirements.map((item) => item.label),
      targetChannelScope: evidence.channelId ?? null,
      hierarchyChecked,
      notes: [
        resolved.source === 'reply_target'
          ? 'Resolved the member target from the direct reply target author.'
          : resolved.source === 'message_author_url'
            ? 'Resolved the member target from a referenced message author.'
            : 'Resolved the member target from an explicit user reference.',
        hierarchyNote,
      ],
    },
    dedupeKey: computeModerationDedupeKey(canonicalAction),
  };
}

async function prepareDiscordModerationEnvelope(
  params: PreparedModerationDeps,
): Promise<PreparedModerationEnvelope> {
  switch (params.request.action) {
    case 'delete_message':
    case 'bulk_delete_messages':
    case 'purge_recent_messages':
    case 'clear_reactions':
    case 'remove_user_reaction':
      return prepareMessageModerationEnvelope(params);
    case 'timeout_member':
    case 'untimeout_member':
    case 'kick_member':
    case 'ban_member':
    case 'unban_member':
      return prepareMemberModerationEnvelope(params);
    default:
      throw new Error('Unsupported moderation request.');
  }
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

async function sendGovernanceSurfaceMessage(params: {
  guildId: string;
  channelId: string;
  body: { flags: MessageFlags; components: APIMessageTopLevelComponent[] };
  replyToMessageId?: string;
  reason?: string;
}): Promise<string> {
  const result = await discordRestRequestGuildScoped({
    guildId: params.guildId,
    method: 'POST',
    path: `/channels/${params.channelId}/messages`,
    body: {
      flags: params.body.flags,
      components: params.body.components,
      allowed_mentions: { parse: [] },
      ...(params.replyToMessageId
        ? {
            message_reference: {
              message_id: params.replyToMessageId,
              fail_if_not_exists: false,
            },
          }
        : {}),
    },
    reason: params.reason,
  });

  if (result.ok) {
    const data = normalizeUnknownRecord(result.data);
    const messageId = asString(data?.id);
    if (messageId) {
      return messageId;
    }

    throw new Error('Governance surface send succeeded without returning a message id.');
  }

  throw new Error(
    `Governance surface send failed (${String(result.status ?? 'unknown')} ${String(result.statusText ?? '')}): ${String(result.error ?? 'Unknown error')}`,
  );
}

async function editGovernanceSurfaceMessage(params: {
  guildId: string;
  channelId: string;
  messageId: string;
  body: { flags: MessageFlags; components: APIMessageTopLevelComponent[] };
}): Promise<void> {
  const result = await discordRestRequestGuildScoped({
    guildId: params.guildId,
    method: 'PATCH',
    path: `/channels/${params.channelId}/messages/${params.messageId}`,
    body: {
      flags: params.body.flags,
      components: params.body.components,
      allowed_mentions: { parse: [] },
    },
  });

  if (result.ok) {
    return;
  }

  throw new Error(
    `Governance surface edit failed (${String(result.status ?? 'unknown')} ${String(result.statusText ?? '')}): ${String(result.error ?? 'Unknown error')}`,
  );
}

function shouldPublishRequesterStatusMessage(params: {
  action: Pick<ApprovalReviewRequestRecord, 'sourceChannelId' | 'reviewChannelId'>;
  coalesced: boolean;
  publishedReviewerCard: boolean;
}): boolean {
  if (params.action.sourceChannelId !== params.action.reviewChannelId) {
    return true;
  }

  return params.coalesced && !params.publishedReviewerCard;
}

async function sendApprovalOutcomeMessage(params: {
  action: ApprovalReviewRequestRecord;
  content?: string | null;
  files?: Array<{ attachment: Buffer; name: string }>;
}): Promise<string | null> {
  const content = params.content?.trim() || '';
  const files = params.files ?? [];
  if (!content && files.length < 1) {
    return null;
  }

  const attachments = files.map((file, index) => ({
    id: index,
    filename: file.name,
  }));
  const restFiles = files.map((file) => ({
    filename: file.name,
    source: {
      type: 'base64',
      base64: file.attachment.toString('base64'),
    },
  } satisfies DiscordRestFileInput));
  const result = await discordRestRequestGuildScoped({
    guildId: params.action.guildId,
    method: 'POST',
    path: `/channels/${params.action.sourceChannelId}/messages`,
    body: {
      ...(content ? { content } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      allowed_mentions: { parse: [] },
      ...(params.action.sourceMessageId
        ? {
            message_reference: {
              message_id: params.action.sourceMessageId,
              fail_if_not_exists: false,
            },
          }
        : {}),
    },
    ...(restFiles.length > 0 ? { files: restFiles } : {}),
    reason: `[sage action:${params.action.id}] post approval outcome acknowledgement`,
  });

  if (!result.ok) {
    throw new Error(
      `Approval outcome send failed (${String(result.status ?? 'unknown')} ${String(result.statusText ?? '')}): ${String(result.error ?? 'Unknown error')}`,
    );
  }

  const data = normalizeUnknownRecord(result.data);
  return asString(data?.id);
}

async function postApprovalCard(params: {
  pending: ApprovalReviewRequestRecord;
}): Promise<{ reviewChannelId: string; approvalMessageId: string | null }> {
  const reviewChannelId = params.pending.reviewChannelId;
  const payload = buildApprovalReviewReviewerCardPayload({
    action: params.pending,
    approveCustomId: makeAdminActionButtonCustomId('approve', params.pending.id),
    rejectCustomId: makeAdminActionButtonCustomId('reject', params.pending.id),
    detailsCustomId: makeAdminActionButtonCustomId('details', params.pending.id),
  });
  const approvalMessageId = await sendGovernanceSurfaceMessage({
    guildId: params.pending.guildId,
    channelId: reviewChannelId,
    body: payload,
    reason: `[sage action:${params.pending.id}] post governance review card`,
  });
  return { reviewChannelId, approvalMessageId };
}

async function ensureApprovalCardForPending(params: {
  pending: ApprovalReviewRequestRecord;
}): Promise<{ approvalMessageId: string | null; published: boolean }> {
  const existingApprovalMessageId = params.pending.reviewerMessageId?.trim() || null;
  if (existingApprovalMessageId) {
    return {
      approvalMessageId: existingApprovalMessageId,
      published: false,
    };
  }

  const { reviewChannelId, approvalMessageId } = await postApprovalCard({
    pending: params.pending,
  });

  if (approvalMessageId) {
    await updateApprovalReviewSurface({
      id: params.pending.id,
      reviewChannelId,
      reviewerMessageId: approvalMessageId,
    }).catch((error) => {
      logger.warn(
        { error, actionId: params.pending.id },
        'Failed to persist governance review card surface metadata',
      );
    });
  }

  return {
    approvalMessageId,
    published: true,
  };
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

      const auditReason = withAuditReason(
        params.action.reason,
        params.actionId,
        params.requestedBy,
        params.approvedBy,
      );
      const restResult = await discordRestRequestGuildScoped({
        guildId: params.guildId,
        method: 'DELETE',
        path: `/channels/${channel.id}/messages/${params.action.messageId}`,
        reason: auditReason,
      });
      if (!restResult.ok && (restResult.status ?? 0) !== 404) {
        throw new Error(`Failed to delete message (${restResult.status} ${restResult.statusText}): ${String(restResult.error ?? 'Unknown error')}`);
      }

      return {
        action: params.action.action,
        status: restResult.ok ? 'executed' : 'noop',
        channelId: channel.id,
        messageId: params.action.messageId,
        noop: !restResult.ok,
      };
    }

    case 'bulk_delete_messages': {
      const channel = await fetchGuildChannel(params.guildId, params.action.channelId);
      const permissions = botMember.permissionsIn(channel);
      if (!permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        throw new Error('Bot lacks ManageMessages permission in target channel.');
      }

      const requestedMessageIds = dedupeStrings(
        params.action.messageIds
          .map((messageId) => messageId.trim())
          .filter((messageId) => messageId.length > 0),
      );
      if (requestedMessageIds.length === 0) {
        return {
          action: params.action.action,
          status: 'noop',
          channelId: channel.id,
          requested: 0,
          eligible: 0,
          deleted: 0,
          skipped_too_old: 0,
          not_found: 0,
          noop: true,
        };
      }

      const nowMs = Date.now();
      const eligibleMessageIds: string[] = [];
      const skippedTooOldMessageIds: string[] = [];
      for (const messageId of requestedMessageIds) {
        if (isBulkDeleteEligibleMessageId(messageId, nowMs)) {
          eligibleMessageIds.push(messageId);
        } else {
          skippedTooOldMessageIds.push(messageId);
        }
      }

      const auditReason = withAuditReason(
        params.action.reason,
        params.actionId,
        params.requestedBy,
        params.approvedBy,
      );

      let deleted = 0;
      let notFound = 0;

      if (eligibleMessageIds.length === 1) {
        const deleteResult = await discordRestRequestGuildScoped({
          guildId: params.guildId,
          method: 'DELETE',
          path: `/channels/${channel.id}/messages/${eligibleMessageIds[0]}`,
          reason: auditReason,
        });
        if (deleteResult.ok) {
          deleted += 1;
        } else if ((deleteResult.status ?? 0) === 404) {
          notFound += 1;
        } else {
          throw new Error(
            `Failed to delete message (${deleteResult.status} ${deleteResult.statusText}): ${String(deleteResult.error ?? 'Unknown error')}`,
          );
        }
      } else if (eligibleMessageIds.length > 1) {
        const chunks = chunkStrings(eligibleMessageIds, BULK_DELETE_MAX_MESSAGES_PER_REQUEST);
        for (const chunk of chunks) {
          const bulkResult = await discordRestRequestGuildScoped({
            guildId: params.guildId,
            method: 'POST',
            path: `/channels/${channel.id}/messages/bulk-delete`,
            body: { messages: chunk },
            reason: auditReason,
          });
          if (bulkResult.ok) {
            deleted += chunk.length;
            continue;
          }

          const status = bulkResult.status ?? 0;
          if (status !== 400 && status !== 404) {
            throw new Error(
              `Bulk delete failed (${bulkResult.status} ${bulkResult.statusText}): ${String(bulkResult.error ?? 'Unknown error')}`,
            );
          }

          for (const messageId of chunk) {
            const singleResult = await discordRestRequestGuildScoped({
              guildId: params.guildId,
              method: 'DELETE',
              path: `/channels/${channel.id}/messages/${messageId}`,
              reason: auditReason,
            });
            if (singleResult.ok) {
              deleted += 1;
            } else if ((singleResult.status ?? 0) === 404) {
              notFound += 1;
            } else {
              throw new Error(
                `Failed to delete message (${singleResult.status} ${singleResult.statusText}): ${String(singleResult.error ?? 'Unknown error')}`,
              );
            }
          }
        }
      }

      return {
        action: params.action.action,
        status: deleted > 0 ? 'executed' : 'noop',
        channelId: channel.id,
        requested: requestedMessageIds.length,
        eligible: eligibleMessageIds.length,
        deleted,
        skipped_too_old: skippedTooOldMessageIds.length,
        skipped_too_old_ids: skippedTooOldMessageIds.slice(0, 25),
        not_found: notFound,
        noop: deleted === 0,
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

      const message = await fetchGuildMessageOrNull(channel, params.action.messageId);
      if (!message) {
        return {
          action: params.action.action,
          status: 'noop',
          channelId: channel.id,
          messageId: params.action.messageId,
          emoji: params.action.emoji,
          userId: params.action.userId,
          noop: true,
        };
      }
      const emoji = normalizeEmojiIdentifier(params.action.emoji);
      const reaction = await resolveMessageReaction(message, emoji);
      if (!reaction) {
        return {
          action: params.action.action,
          status: 'noop',
          channelId: channel.id,
          messageId: params.action.messageId,
          emoji,
          userId: params.action.userId,
          noop: true,
        };
      }

      await reaction.users.remove(params.action.userId).catch((error) => {
        if (isDiscordNotFoundError(error)) {
          return null;
        }
        throw error;
      });
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

      const message = await fetchGuildMessageOrNull(channel, params.action.messageId);
      if (!message) {
        return {
          action: params.action.action,
          status: 'noop',
          channelId: channel.id,
          messageId: params.action.messageId,
          noop: true,
        };
      }
      if (!message.reactions?.removeAll) {
        throw new Error('Target message does not support reaction management.');
      }

      await message.reactions.removeAll().catch((error) => {
        if (isDiscordNotFoundError(error)) {
          return null;
        }
        throw error;
      });
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

    case 'untimeout_member': {
      if (!botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        throw new Error('Bot lacks ModerateMembers permission.');
      }

      const targetMember = await guild.members.fetch(params.action.userId);
      assertMemberHierarchy(botMember, targetMember);
      if (!targetMember.communicationDisabledUntilTimestamp) {
        return {
          action: params.action.action,
          status: 'noop',
          userId: params.action.userId,
          noop: true,
        };
      }

      await targetMember.timeout(
        null,
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

      const existingBan = await guild.bans.fetch(params.action.userId).catch((error) => {
        if (isDiscordNotFoundError(error)) {
          return null;
        }
        throw error;
      });
      if (!existingBan) {
        return {
          action: params.action.action,
          status: 'noop',
          userId: params.action.userId,
          noop: true,
        };
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

export async function executeAutonomousModerationAction(params: {
  action: PreparedModerationAction;
  guildId: string;
  channelId: string;
  actionId: string;
  requestedBy: string;
  approvedBy?: string;
}): Promise<Record<string, unknown>> {
  return executeQueuedDiscordAction({
    action: params.action,
    guildId: params.guildId,
    channelId: params.channelId,
    actionId: params.actionId,
    requestedBy: params.requestedBy,
    approvedBy: params.approvedBy ?? 'sage:auto',
  });
}

async function executePendingAction(params: {
  action: ApprovalReviewRequestRecord;
  approvedBy: string;
}): Promise<Record<string, unknown>> {
  if (params.action.kind === 'server_instructions_update') {
    const payload = params.action.executionPayloadJson as SagePersonaPendingPayload;
    const current = await getGuildSagePersonaRecord(params.action.guildId);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== payload.baseVersion) {
      throw new Error(
        `Sage Persona changed since request creation (baseVersion=${payload.baseVersion}, currentVersion=${currentVersion}). Recreate and approve a fresh request.`,
      );
    }

    if (payload.operation === 'clear') {
      const cleared = await clearGuildSagePersona({
        guildId: params.action.guildId,
        adminId: params.approvedBy,
      });
      return {
        action: 'server_instructions_update',
        operation: payload.operation,
        cleared,
      };
    }

    const updated = await upsertGuildSagePersona({
      guildId: params.action.guildId,
      instructionsText: payload.newInstructionsText,
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
    const prepared = readPreparedModerationEnvelope(params.action.executionPayloadJson);
    if (!prepared) {
      throw new Error('Approval review moderation payload is invalid or unreadable.');
    }
    return executeQueuedDiscordAction({
      action: prepared.canonicalAction,
      guildId: params.action.guildId,
      channelId: params.action.sourceChannelId,
      actionId: params.action.id,
      requestedBy: params.action.requestedBy,
      approvedBy: params.approvedBy,
    });
  }

  if (params.action.kind === 'discord_rest_write') {
    const requests = readPendingDiscordRestWriteRequests(params.action.executionPayloadJson);
    const results: unknown[] = [];
    for (const request of requests) {
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

      results.push(result);
    }

    if (requests.length === 1) {
      const request = requests[0];
      return {
        action: 'discord_rest_write',
        status: 'executed',
        method: request.method,
        path: request.path,
        result: results[0],
      };
    }

    return {
      action: 'discord_rest_write_sequence',
      status: 'executed',
      requestCount: requests.length,
      requests: requests.map((request) => ({
        method: request.method,
        path: request.path,
      })),
      results,
    };
  }

  throw new Error(`Unknown approval review request kind: ${params.action.kind}`);
}

export async function lookupGuildSagePersonaForTool(params: {
  guildId: string;
  maxChars?: number;
}): Promise<Record<string, unknown>> {
  const maxChars = Math.max(200, Math.min(params.maxChars ?? DEFAULT_SAGE_PERSONA_MAX_CHARS, 12_000));
  const record = await getGuildSagePersonaRecord(params.guildId);
  if (!record) {
    return {
      found: false,
      guildId: params.guildId,
      instructionsText: '',
      content: 'No Sage Persona has been configured for this guild.',
    };
  }

  const truncated = truncateWithFlag(record.instructionsText, maxChars);
  return {
    found: true,
    guildId: params.guildId,
    instructionsText: truncated.text,
    truncated: truncated.truncated,
    version: record.version,
    updatedAtIso: record.updatedAt.toISOString(),
  };
}

function buildApprovalReviewDedupeKey(kind: string, payload: unknown): string {
  return computeParamsHash({
    kind,
    payload,
  });
}

export async function prepareSagePersonaUpdateApprovalForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  sourceMessageId?: string | null;
  request: SagePersonaUpdateRequest;
}): Promise<ApprovalInterruptPayload> {
  const current = await getGuildSagePersonaRecord(params.guildId);
  const currentText = current?.instructionsText ?? '';

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

  if (params.request.operation !== 'clear' && nextText.length > MAX_SAGE_PERSONA_CHARS) {
    throw new Error(`Sage Persona exceeds max length (${MAX_SAGE_PERSONA_CHARS} chars).`);
  }

  const baseVersion = current?.version ?? 0;
  const payload = {
    operation: params.request.operation,
    newInstructionsText: nextText,
    reason: params.request.reason,
    baseVersion,
  } satisfies SagePersonaPendingPayload;
  const reviewChannelId = await getGuildApprovalReviewChannelId(params.guildId) ?? params.channelId;

  return {
    kind: 'server_instructions_update',
    guildId: params.guildId,
    sourceChannelId: params.channelId,
    reviewChannelId,
    sourceMessageId: params.sourceMessageId ?? null,
    requestedBy: params.requestedBy,
    dedupeKey: buildApprovalReviewDedupeKey('server_instructions_update', payload),
    executionPayloadJson: payload,
    reviewSnapshotJson: payload,
    interruptMetadataJson: {
      reasonHash: hashForAudit(params.request.reason),
      instructionsHash: hashForAudit(nextText),
      instructionsChars: nextText.length,
    },
  } satisfies ApprovalInterruptPayload;
}

export async function requestSagePersonaUpdateForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  sourceMessageId?: string | null;
  request: SagePersonaUpdateRequest;
}): Promise<never> {
  throw new ApprovalRequiredSignal(await prepareSagePersonaUpdateApprovalForTool(params));
}

export async function prepareDiscordModerationApprovalForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  sourceMessageId?: string | null;
  request: DiscordModerationActionRequest;
  currentTurn?: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
}): Promise<ApprovalInterruptPayload> {
  const prepared = await prepareDiscordModerationEnvelope({
    guildId: params.guildId,
    sourceChannelId: params.channelId,
    request: params.request,
    currentTurn: params.currentTurn,
    replyTarget: params.replyTarget,
  });
  const reviewChannelId = await getGuildApprovalReviewChannelId(params.guildId) ?? params.channelId;
  return {
    kind: 'discord_queue_moderation_action',
    guildId: params.guildId,
    sourceChannelId: params.channelId,
    reviewChannelId,
    sourceMessageId: params.sourceMessageId ?? null,
    requestedBy: params.requestedBy,
    dedupeKey: prepared.dedupeKey,
    executionPayloadJson: prepared,
    reviewSnapshotJson: {
      action: prepared.canonicalAction.action,
      dedupeKey: prepared.dedupeKey,
      evidence: prepared.evidence,
      preflight: prepared.preflight,
    },
    interruptMetadataJson: {
      action: prepared.canonicalAction.action,
      dedupeKey: prepared.dedupeKey,
    },
  } satisfies ApprovalInterruptPayload;
}

export async function requestDiscordAdminActionForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  sourceMessageId?: string | null;
  request: DiscordModerationActionRequest;
  currentTurn?: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
}): Promise<never> {
  throw new ApprovalRequiredSignal(await prepareDiscordModerationApprovalForTool(params));
}

export async function prepareDiscordRestWriteApprovalForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  sourceMessageId?: string | null;
  request: DiscordRestWriteRequest;
}): Promise<ApprovalInterruptPayload> {
  await assertDiscordRestRequestGuildScoped({
    guildId: params.guildId,
    method: params.request.method,
    path: params.request.path,
  });

  const reviewChannelId = await getGuildApprovalReviewChannelId(params.guildId) ?? params.channelId;

  return {
    kind: 'discord_rest_write',
    guildId: params.guildId,
    sourceChannelId: params.channelId,
    reviewChannelId,
    sourceMessageId: params.sourceMessageId ?? null,
    requestedBy: params.requestedBy,
    dedupeKey: buildApprovalReviewDedupeKey('discord_rest_write', {
      method: params.request.method,
      path: params.request.path,
      query: params.request.query,
      body: params.request.body,
    }),
    executionPayloadJson: {
      request: params.request,
    } satisfies DiscordRestWritePendingPayload,
    reviewSnapshotJson: {
      method: params.request.method,
      path: params.request.path,
    },
    interruptMetadataJson: {
      method: params.request.method,
      path: params.request.path,
    },
  } satisfies ApprovalInterruptPayload;
}

export async function prepareDiscordRestWriteSequenceApprovalForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  sourceMessageId?: string | null;
  requests: DiscordRestWriteRequest[];
}): Promise<ApprovalInterruptPayload> {
  if (params.requests.length === 0) {
    throw new Error('Discord REST write sequence must include at least one request.');
  }
  for (const request of params.requests) {
    await assertDiscordRestRequestGuildScoped({
      guildId: params.guildId,
      method: request.method,
      path: request.path,
    });
  }

  const reviewChannelId = await getGuildApprovalReviewChannelId(params.guildId) ?? params.channelId;

  return {
    kind: 'discord_rest_write',
    guildId: params.guildId,
    sourceChannelId: params.channelId,
    reviewChannelId,
    sourceMessageId: params.sourceMessageId ?? null,
    requestedBy: params.requestedBy,
    dedupeKey: buildApprovalReviewDedupeKey('discord_rest_write', {
      requests: params.requests.map((request) => ({
        method: request.method,
        path: request.path,
        query: request.query,
        body: request.body,
      })),
    }),
    executionPayloadJson: {
      requests: params.requests,
    } satisfies DiscordRestWritePendingPayload,
    reviewSnapshotJson: {
      requestCount: params.requests.length,
      requests: params.requests.map((request) => ({
        method: request.method,
        path: request.path,
      })),
    },
    interruptMetadataJson: {
      requestCount: params.requests.length,
      paths: params.requests.map((request) => request.path),
    },
  } satisfies ApprovalInterruptPayload;
}

export async function requestDiscordRestWriteForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  sourceMessageId?: string | null;
  request: DiscordRestWriteRequest;
}): Promise<never> {
  throw new ApprovalRequiredSignal(await prepareDiscordRestWriteApprovalForTool(params));
}

export async function requestDiscordRestWriteSequenceForTool(params: {
  guildId: string;
  channelId: string;
  requestedBy: string;
  sourceMessageId?: string | null;
  requests: DiscordRestWriteRequest[];
}): Promise<never> {
  throw new ApprovalRequiredSignal(await prepareDiscordRestWriteSequenceApprovalForTool(params));
}

export async function createOrReuseApprovalReviewRequestFromSignal(params: {
  threadId: string;
  originTraceId: string;
  signal: ApprovalRequiredSignal;
}): Promise<{ request: ApprovalReviewRequestRecord; coalesced: boolean }> {
  const payload = params.signal.payload;
  const existingPending = await findMatchingPendingApprovalReviewRequest({
    guildId: payload.guildId,
    requestedBy: payload.requestedBy,
    kind: payload.kind,
    dedupeKey: payload.dedupeKey,
  });
  const expiresAt = existingPending?.expiresAt ?? new Date(Date.now() + APPROVAL_TTL_MS);
  let request =
    existingPending ??
    (await createApprovalReviewRequest({
      threadId: params.threadId,
      originTraceId: params.originTraceId,
      guildId: payload.guildId,
      sourceChannelId: payload.sourceChannelId,
      reviewChannelId: payload.reviewChannelId,
      sourceMessageId: payload.sourceMessageId ?? null,
      requestedBy: payload.requestedBy,
      kind: payload.kind,
      dedupeKey: payload.dedupeKey,
      executionPayloadJson: payload.executionPayloadJson,
      reviewSnapshotJson: payload.reviewSnapshotJson,
      interruptMetadataJson: payload.interruptMetadataJson,
      expiresAt,
    }));
  const coalesced = existingPending !== null;

  const approvalCard = await ensureApprovalCardForPending({
    pending: request,
  });

  if (
    shouldPublishRequesterStatusMessage({
      action: request,
      coalesced,
      publishedReviewerCard: approvalCard.published,
    }) &&
    !request.requesterStatusMessageId?.trim()
  ) {
    const updated = await publishApprovalReviewRequesterStatusMessage({
      actionId: request.id,
      coalesced,
      replyToMessageId: request.sourceMessageId ?? undefined,
    }).catch((error) => {
      logger.warn(
        { error, requestId: request.id },
        'Failed to publish requester governance status message after approval review was created',
      );
      return null;
    });
    if (updated) {
      request = updated;
    }
  }

  await logAdminAction({
    guildId: request.guildId,
    adminId: request.requestedBy,
    command: `tool_${request.kind}`,
    paramsHash: computeParamsHash({
      actionId: request.id,
      kind: request.kind,
      dedupeKey: request.dedupeKey,
      coalesced,
    }),
  }).catch((error) => {
    logger.warn({ error, requestId: request.id }, 'Failed to write approval-request audit log');
  });

  return {
    request,
    coalesced,
  };
}

export async function executeApprovedReviewRequest(params: {
  requestId: string;
  reviewerId?: string | null;
  decisionReasonText?: string | null;
  resumeTraceId?: string | null;
}): Promise<ApprovalReviewRequestRecord | null> {
  const action = await getApprovalReviewRequestById(params.requestId);
  if (!action) {
    return null;
  }

  if (action.status === 'executed' || action.status === 'failed' || action.status === 'rejected' || action.status === 'expired') {
    return action;
  }

  if (action.status !== 'approved') {
    return action;
  }

  try {
    const result = await executePendingAction({
      action,
      approvedBy: params.reviewerId?.trim() || action.decidedBy || action.requestedBy,
    });
    const executed = await markApprovalReviewRequestExecutedIfApproved({
      id: action.id,
      resultJson: result,
      resumeTraceId: params.resumeTraceId ?? null,
    });
    const latest = executed ?? await getApprovalReviewRequestById(action.id);
    if (latest) {
      await refreshApprovalReviewSurfaces(latest, 'approval execution');
    }
    return latest;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failed = await markApprovalReviewRequestFailedIfApproved({
      id: action.id,
      errorText: errorMessage,
      resumeTraceId: params.resumeTraceId ?? null,
    });
    const latest = failed ?? await getApprovalReviewRequestById(action.id);
    if (latest) {
      await refreshApprovalReviewSurfaces(latest, 'approval failure');
    }
    throw error;
  }
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

async function deleteApprovalCardForAction(action: ApprovalReviewRequestRecord): Promise<void> {
  const approvalMessageId = action.reviewerMessageId?.trim();
  if (!approvalMessageId) {
    return;
  }

  try {
    const result = await discordRestRequestGuildScoped({
      guildId: action.guildId,
      method: 'DELETE',
      path: `/channels/${action.reviewChannelId}/messages/${approvalMessageId}`,
      reason: `[sage action:${action.id}] auto-delete resolved approval card`,
      maxResponseChars: 500,
    });

    const status = typeof result.status === 'number' ? result.status : null;
    const shouldClear =
      result.ok === true ||
      status === 404 ||
      status === 403;

    if (shouldClear) {
      await clearApprovalReviewReviewerMessageId(action.id).catch((error) => {
        logger.warn({ error, actionId: action.id }, 'Failed to clear approval message id after deletion attempt');
      });
      return;
    }

    if (status !== 429) {
      logger.warn(
        {
          actionId: action.id,
          guildId: action.guildId,
          channelId: action.reviewChannelId,
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
      { error, actionId: action.id, guildId: action.guildId, channelId: action.reviewChannelId },
      'Resolved approval card deletion threw; clearing id to avoid repeated attempts',
    );
    await clearApprovalReviewReviewerMessageId(action.id).catch(() => {
      // Ignore cleanup failures.
    });
  }
}

async function deleteResolvedApprovalCardForActionId(actionId: string): Promise<void> {
  const action = await getApprovalReviewRequestById(actionId);
  if (!action) return;
  await deleteApprovalCardForAction(action);
}

function scheduleResolvedApprovalCardDeletion(actionId: string): void {
  const existingTimer = resolvedApprovalCardDeleteTimers.get(actionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    resolvedApprovalCardDeleteTimers.delete(actionId);
    void deleteResolvedApprovalCardForActionId(actionId).catch((error) => {
      logger.warn({ error, actionId }, 'Failed to auto-delete resolved approval card');
    });
  }, RESOLVED_APPROVAL_CARD_DELETE_DELAY_MS);
  resolvedApprovalCardDeleteTimers.set(actionId, timer);
  timer.unref?.();
}

async function updateReviewMessageForAction(action: ApprovalReviewRequestRecord): Promise<void> {
  const approvalMessageId = action.reviewerMessageId?.trim();
  if (!approvalMessageId) {
    return;
  }

  const payload = buildApprovalReviewReviewerCardPayload({
    action,
    approveCustomId: makeAdminActionButtonCustomId('approve', action.id),
    rejectCustomId: makeAdminActionButtonCustomId('reject', action.id),
    detailsCustomId: makeAdminActionButtonCustomId('details', action.id),
  });
  try {
    await editGovernanceSurfaceMessage({
      guildId: action.guildId,
      channelId: action.reviewChannelId,
      messageId: approvalMessageId,
      body: payload,
    });
  } catch (error) {
    logger.warn(
      {
        error,
        actionId: action.id,
        guildId: action.guildId,
        reviewChannelId: action.reviewChannelId,
        approvalMessageId,
      },
      'Failed to update governance review card',
    );
  }
}

async function updateRequesterMessageForAction(action: ApprovalReviewRequestRecord): Promise<void> {
  const requestMessageId = action.requesterStatusMessageId?.trim();
  if (!requestMessageId) {
    return;
  }

  const payload = buildApprovalReviewRequesterCardPayload({
    action,
  });

  try {
    await editGovernanceSurfaceMessage({
      guildId: action.guildId,
      channelId: action.sourceChannelId,
      messageId: requestMessageId,
      body: payload,
    });
  } catch (error) {
    logger.warn(
      {
        error,
        actionId: action.id,
        guildId: action.guildId,
        channelId: action.sourceChannelId,
        requestMessageId,
      },
      'Failed to update requester message for admin action',
    );
  }
}

async function refreshApprovalReviewSurfaces(
  action: ApprovalReviewRequestRecord,
  outcomeContext: string,
): Promise<void> {
  await updateReviewMessageForAction(action).catch((error) => {
    logger.warn({ error, actionId: action.id }, `Failed to update governance review card after ${outcomeContext}`);
  });
  void updateRequesterMessageForAction(action).catch((error) => {
    logger.warn({ error, actionId: action.id }, `Failed to update requester card after ${outcomeContext}`);
  });
  if (action.status !== 'pending' && action.status !== 'approved') {
    scheduleResolvedApprovalCardDeletion(action.id);
  }
}

export async function publishApprovalReviewRequesterStatusMessage(params: {
  actionId: string;
  replyToMessageId?: string;
  coalesced?: boolean;
}): Promise<ApprovalReviewRequestRecord | null> {
  const action = await getApprovalReviewRequestById(params.actionId);
  if (!action) {
    return null;
  }

  const payload = buildApprovalReviewRequesterCardPayload({
    action,
    coalesced: params.coalesced,
  });
  const messageId = await sendGovernanceSurfaceMessage({
    guildId: action.guildId,
    channelId: action.sourceChannelId,
    body: payload,
    replyToMessageId: params.replyToMessageId,
    reason: `[sage action:${action.id}] post requester governance status`,
  });

  const updated = await attachApprovalReviewRequesterStatusMessageId({
    id: action.id,
    requesterStatusMessageId: messageId,
  }).catch((error) => {
    logger.warn({ error, actionId: action.id }, 'Failed to persist requester governance status message id');
    return action;
  });

  if (updated.status !== 'pending' && updated.status !== 'approved') {
    await updateRequesterMessageForAction(updated).catch((error) => {
      logger.warn({ error, actionId: updated.id }, 'Failed to sync requester governance status after publish');
    });
  }

  return updated;
}

async function getModerationApprovalPermissionError(
  interaction: ButtonInteraction,
  action: ApprovalReviewRequestRecord,
): Promise<string | null> {
  const prepared = readPreparedModerationEnvelope(action.executionPayloadJson);
  if (!prepared) {
    return buildModerationApprovalPermissionsUnknownText();
  }

  const requiredPermission = requiredApproverPermission(prepared.canonicalAction);
  if (!requiredPermission) {
    return null;
  }

  if (requiredPermission.scope === 'guild') {
    const memberPermissions = getInteractionMemberPermissions(interaction);
    if (!memberPermissions || !memberPermissions.has(requiredPermission.flag)) {
      return buildModerationApprovalPermissionMissingText(requiredPermission.label);
    }
    return null;
  }

  const targetChannelId =
    'channelId' in prepared.canonicalAction ? prepared.canonicalAction.channelId : action.sourceChannelId;
  const guild = interaction.guild ?? (await client.guilds.fetch(action.guildId));
  const approverMember = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!approverMember) {
    return buildModerationApprovalChannelPermissionsUnknownText();
  }

  const targetChannel = await fetchGuildChannel(action.guildId, targetChannelId).catch(() => null);
  if (!targetChannel) {
    return buildModerationApprovalChannelUnavailableText();
  }

  const memberPermissions = approverMember.permissionsIn(targetChannel);
  if (!memberPermissions.has(requiredPermission.flag)) {
    return buildModerationApprovalChannelPermissionMissingText({
      channelId: targetChannel.id,
      permissionLabel: requiredPermission.label,
    });
  }

  return null;
}

async function resolveApprovalResumePayload(params: {
  action: ApprovalReviewRequestRecord;
  resumeTraceId: string;
}): Promise<
  | {
      shouldResume: false;
    }
  | {
      shouldResume: true;
      resumeTraceId: string;
      decisions: Array<ReturnType<typeof buildApprovalResumeDecision>>;
    }
> {
  const batchMetadata = readApprovalBatchMetadata(params.action.interruptMetadataJson);
  if (!batchMetadata) {
    return {
      shouldResume: true,
      resumeTraceId: params.resumeTraceId,
      decisions: [buildApprovalResumeDecision(params.action)],
    };
  }

  const threadRequests = await listApprovalReviewRequestsByThreadId(params.action.threadId);
  const orderedBatch = threadRequests
    .filter((request) => readApprovalBatchMetadata(request.interruptMetadataJson)?.batchId === batchMetadata.batchId)
    .sort((left, right) => {
      const leftIndex = readApprovalBatchMetadata(left.interruptMetadataJson)?.batchIndex ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = readApprovalBatchMetadata(right.interruptMetadataJson)?.batchIndex ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.createdAt.getTime() - right.createdAt.getTime();
    });

  if (orderedBatch.length !== batchMetadata.batchSize) {
    return {
      shouldResume: true,
      resumeTraceId: params.resumeTraceId,
      decisions: [buildApprovalResumeDecision(params.action)],
    };
  }

  const earlierResolved = orderedBatch
    .slice(0, batchMetadata.batchIndex)
    .every((request) => request.status !== 'pending');
  if (!earlierResolved) {
    return { shouldResume: false };
  }

  let latestBatch = orderedBatch;
  if (params.action.status === 'rejected' || params.action.status === 'expired') {
    const laterPending = orderedBatch.slice(batchMetadata.batchIndex + 1).filter((request) => request.status === 'pending');
    if (laterPending.length > 0) {
      const forcedExpireTime = new Date();
      const refreshedBatch = [...orderedBatch];
      for (const request of laterPending) {
        const expired = await markApprovalReviewRequestExpiredIfPending({
          id: request.id,
          now: forcedExpireTime,
          resumeTraceId: params.resumeTraceId,
          force: true,
        });
        if (!expired) {
          continue;
        }
        const targetIndex = refreshedBatch.findIndex((entry) => entry.id === request.id);
        if (targetIndex >= 0) {
          refreshedBatch[targetIndex] = expired;
        }
        await refreshApprovalReviewSurfaces(expired, 'approval batch short-circuit').catch((error) => {
          logger.warn({ error, actionId: expired.id }, 'Failed to refresh auto-expired approval batch sibling');
        });
      }
      latestBatch = refreshedBatch;
    }
  }

  if (latestBatch.some((request) => request.status === 'pending')) {
    return { shouldResume: false };
  }

  return {
    shouldResume: true,
    resumeTraceId: params.resumeTraceId,
    decisions: latestBatch.map(buildApprovalResumeDecision),
  };
}

async function resumeApprovalReviewGraph(params: {
  action: ApprovalReviewRequestRecord;
  decision: 'approved' | 'rejected' | 'expired';
  reviewerId?: string | null;
  decisionReasonText?: string | null;
  resumeTraceId?: string | null;
}): Promise<boolean> {
  const resumeTraceId = params.resumeTraceId?.trim() || generateTraceId();
  const { upsertTraceStart, updateTraceEnd } = await import('../agent-runtime/agent-trace-repo');
  const { resumeAgentGraphTurn } = await import('../agent-runtime/langgraph/runtime');
  const resumePayload = await resolveApprovalResumePayload({
    action: params.action,
    resumeTraceId,
  });
  if (!resumePayload.shouldResume) {
    return false;
  }

  if (process.env.SAGE_TRACE_DB_ENABLED !== 'false') {
    await upsertTraceStart({
      id: resumeTraceId,
      guildId: params.action.guildId,
      channelId: params.action.reviewChannelId,
      userId: params.reviewerId?.trim() || params.action.requestedBy,
      routeKind: 'approval_resume',
      tokenJson: {
        approvalRequestId: params.action.id,
        threadId: params.action.threadId,
        decision: params.decision,
      },
      budgetJson: {
        route: 'approval_resume',
      },
      threadId: params.action.threadId,
      parentTraceId: params.action.originTraceId,
      graphStatus: 'running',
      approvalRequestId: params.action.id,
    }).catch((error) => {
      logger.warn({ error, requestId: params.action.id }, 'Failed to persist approval resume trace start');
    });
  }

  const runtimeCredential = await resolveRuntimeCredential(params.action.guildId);

  try {
    const graphResult = await resumeAgentGraphTurn({
      threadId: params.action.threadId,
      resume: {
        interruptKind: 'approval_review',
        decisions: resumePayload.decisions,
        resumeTraceId,
      },
      context: runtimeCredential.apiKey
        ? { apiKey: runtimeCredential.apiKey, apiKeySource: runtimeCredential.authSource }
        : undefined,
    });
    const visibleReplyText = graphResult.replyText;

    await updateTraceEnd({
      id: resumeTraceId,
      replyText: visibleReplyText,
      toolJson: {
        approvalRequestId: params.action.id,
        decision: params.decision,
        graphStatus: graphResult.graphStatus,
        stopReason: graphResult.stopReason,
        completionKind: graphResult.completionKind,
        deliveryDisposition: graphResult.deliveryDisposition,
      },
      budgetJson: {
        route: 'approval_resume',
        graphStatus: graphResult.graphStatus,
      },
      tokenJson: {
        approvalRequestId: params.action.id,
        decision: params.decision,
      },
      threadId: params.action.threadId,
      parentTraceId: params.action.originTraceId,
      graphStatus: graphResult.graphStatus,
      approvalRequestId: params.action.id,
      terminationReason: null,
      langSmithRunId: graphResult.langSmithRunId,
      langSmithTraceId: graphResult.langSmithTraceId,
    }).catch((error) => {
      logger.warn({ error, requestId: params.action.id }, 'Failed to persist approval resume trace end');
    });

    if (visibleReplyText || graphResult.files.length > 0) {
      await sendApprovalOutcomeMessage({
        action: params.action,
        content: visibleReplyText,
        files: graphResult.files,
      }).catch((error) => {
        logger.warn({ error, requestId: params.action.id }, 'Failed to publish approval outcome acknowledgement');
      });
    }
    return true;
  } catch (error) {
    await updateTraceEnd({
      id: resumeTraceId,
      replyText: '',
      toolJson: {
        approvalRequestId: params.action.id,
        decision: params.decision,
        failed: true,
        errorText: error instanceof Error ? error.message : String(error),
      },
      budgetJson: {
        route: 'approval_resume',
        failed: true,
      },
      tokenJson: {
        approvalRequestId: params.action.id,
        decision: params.decision,
      },
      threadId: params.action.threadId,
      parentTraceId: params.action.originTraceId,
      graphStatus: 'failed',
      approvalRequestId: params.action.id,
      terminationReason: 'approval_interrupt',
    }).catch(() => {
      // Ignore trace-end persistence failures for approval resumes.
    });
    throw error;
  }
}

export async function reconcileExpiredApprovalReviewRequests(params?: {
  now?: Date;
  limit?: number;
}): Promise<number> {
  const now = params?.now ?? new Date();
  const expiredPending = await listPendingApprovalReviewsExpiredBy({
    now,
    limit: params?.limit,
  });
  let resolvedCount = 0;

  for (const pending of expiredPending) {
    const resumeTraceId = generateTraceId();
    const expired = await markApprovalReviewRequestExpiredIfPending({
      id: pending.id,
      now,
      resumeTraceId,
    });
    if (!expired) {
      continue;
    }

    resolvedCount += 1;
    await refreshApprovalReviewSurfaces(expired, 'scheduled approval expiry').catch((error) => {
      logger.warn({ error, actionId: expired.id }, 'Failed to refresh approval surfaces after scheduled expiry');
    });
    await resumeApprovalReviewGraph({
      action: expired,
      decision: 'expired',
      resumeTraceId,
    }).catch((error) => {
      logger.warn({ error, actionId: expired.id }, 'Failed to resume scheduled expired approval review graph');
    });
  }

  return resolvedCount;
}

export async function handleAdminActionButtonInteraction(
  interaction: ButtonInteraction,
): Promise<boolean> {
  const parsed = parseAdminActionButtonCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: buildApprovalGuildOnlyText(), ephemeral: true });
    return true;
  }

  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: buildApprovalAdminOnlyText(), ephemeral: true });
    return true;
  }

  let action = await getApprovalReviewRequestById(parsed.actionId);
  if (!action) {
    await interaction.reply({ content: buildApprovalActionNotFoundText(), ephemeral: true });
    return true;
  }

  if (action.guildId !== interaction.guildId) {
    await interaction.reply({ content: buildApprovalWrongGuildText(), ephemeral: true });
    return true;
  }

  if (action.status !== 'pending') {
    await interaction.reply({ content: buildApprovalAlreadyResolvedText(action.status), ephemeral: true });
    return true;
  }

  if (!action.reviewerMessageId?.trim() && interaction.message?.id) {
    const updated = await updateApprovalReviewSurface({
      id: action.id,
      reviewChannelId: interaction.channelId,
      reviewerMessageId: interaction.message.id,
    }).catch((error) => {
      logger.warn({ error, actionId: action?.id }, 'Failed to attach approval card message id while handling decision');
      return null;
    });

    if (updated) {
      action = updated;
    } else {
      action = { ...action, reviewerMessageId: interaction.message.id, reviewChannelId: interaction.channelId };
    }
  }

  if (action.expiresAt.getTime() <= Date.now()) {
    await interaction.deferUpdate();
    const resumeTraceId = generateTraceId();
    const expired = await markApprovalReviewRequestExpiredIfPending({
      id: action.id,
      now: new Date(),
      resumeTraceId,
    }).catch(() => null);
    const latest = expired ?? await getApprovalReviewRequestById(action.id).catch(() => null);
    if (latest?.status === 'expired') {
      await refreshApprovalReviewSurfaces(latest, 'admin action expiry');
      await resumeApprovalReviewGraph({
        action: latest,
        decision: 'expired',
        reviewerId: interaction.user.id,
        resumeTraceId,
      }).catch((error) => {
        logger.warn({ error, actionId: latest.id }, 'Failed to resume expired approval review graph');
      });
    }
    return true;
  }

  if (parsed.action === 'details') {
    await interaction.reply({
      content: buildApprovalReviewDetailsText(action),
      ephemeral: true,
    });
    return true;
  }

  if (parsed.action === 'reject') {
    await interaction.showModal(buildAdminActionRejectModal(action.id));
    return true;
  }

  if (parsed.action === 'approve' && action.kind === 'discord_queue_moderation_action') {
    const permissionError = await getModerationApprovalPermissionError(interaction, action);
    if (permissionError) {
      await interaction.reply({
        content: permissionError,
        ephemeral: true,
      });
      return true;
    }
  }
  await interaction.deferUpdate();
  const resumeTraceId = generateTraceId();
  const approved = await markApprovalReviewRequestDecisionIfPending({
    id: action.id,
    decidedBy: interaction.user.id,
    status: 'approved',
    resumeTraceId,
  });
  if (!approved) {
    const latest = await getApprovalReviewRequestById(action.id).catch(() => null);
    if (latest) {
      await refreshApprovalReviewSurfaces(latest, 'approval-decision race').catch(() => {
        // Ignore refresh failures after races.
      });
    }
    await interaction
      .followUp({ content: buildApprovalAlreadyResolvedText(latest?.status ?? 'resolved'), ephemeral: true })
      .catch(() => {
        // Ignore follow-up failures.
      });
    return true;
  }
  await refreshApprovalReviewSurfaces(approved, 'admin action approval').catch((error) => {
    logger.warn({ error, actionId: approved.id }, 'Failed to refresh approval surfaces after approval');
  });

  try {
    await resumeApprovalReviewGraph({
      action: approved,
      decision: 'approved',
      reviewerId: interaction.user.id,
      resumeTraceId,
    });

    await logAdminAction({
      guildId: action.guildId,
      adminId: interaction.user.id,
      command: 'approval_review_approve',
      paramsHash: computeParamsHash({ actionId: action.id, kind: action.kind }),
    });
  } catch (error) {
    logger.warn({ error, actionId: action.id }, 'Approval review execution failed');
    const latest = await getApprovalReviewRequestById(action.id).catch(() => null);
    if (latest?.status === 'approved') {
      await refreshApprovalReviewSurfaces(latest, 'approval resume error').catch(() => {
        // Ignore refresh failures after resume errors.
      });
    }
  }

  return true;
}

export async function handleAdminActionRejectModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  const actionId = parseAdminActionRejectModalCustomId(interaction.customId);
  if (!actionId) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: buildApprovalGuildOnlyText(), ephemeral: true });
    return true;
  }

  if (!isAdminInteraction(interaction)) {
    await interaction.reply({ content: buildApprovalAdminOnlyText(), ephemeral: true });
    return true;
  }

  const action = await getApprovalReviewRequestById(actionId);
  if (!action) {
    await interaction.reply({ content: buildApprovalActionNotFoundText(), ephemeral: true });
    return true;
  }

  if (action.guildId !== interaction.guildId) {
    await interaction.reply({ content: buildApprovalWrongGuildText(), ephemeral: true });
    return true;
  }

  if (action.status !== 'pending') {
    await interaction.reply({ content: buildApprovalAlreadyResolvedText(action.status), ephemeral: true });
    return true;
  }

  const rejectionReason = interaction.fields.getTextInputValue(ADMIN_ACTION_REJECT_REASON_FIELD_ID)?.trim();
  if (!rejectionReason) {
    await interaction.reply({ content: buildApprovalReasonRequiredText(), ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  const resumeTraceId = generateTraceId();

  const rejected = await markApprovalReviewRequestDecisionIfPending({
    id: action.id,
    decidedBy: interaction.user.id,
    status: 'rejected',
    decisionReasonText: rejectionReason,
    resumeTraceId,
  });
  if (!rejected) {
    const latest = await getApprovalReviewRequestById(action.id).catch(() => null);
    await interaction.editReply(buildApprovalAlreadyResolvedText(latest?.status ?? 'resolved'));
    return true;
  }
  await logAdminAction({
    guildId: action.guildId,
    adminId: interaction.user.id,
    command: 'admin_action_reject',
    paramsHash: computeParamsHash({ actionId: action.id, kind: action.kind, rejectionReason }),
  });

  await refreshApprovalReviewSurfaces(rejected, 'admin action rejection');
  const resumeResult = await resumeApprovalReviewGraph({
    action: rejected,
    decision: 'rejected',
    reviewerId: interaction.user.id,
    decisionReasonText: rejectionReason,
    resumeTraceId,
  }).catch((error) => {
    logger.warn({ error, actionId: rejected.id }, 'Failed to resume rejected approval review graph');
    return error;
  });
  if (resumeResult instanceof Error) {
    await interaction.editReply(buildApprovalFollowUpPostFailureText());
    return true;
  }

  await interaction.deleteReply().catch((error) => {
    logger.warn({ error, actionId: rejected.id }, 'Failed to clear reject modal acknowledgement after posting resume reply');
  });
  return true;
}

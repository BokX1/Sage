import { z } from 'zod';
import { ChannelType, PermissionsBitField, type VoiceChannel } from 'discord.js';

import type { ToolExecutionContext } from '../toolRegistry';
import {
  type DiscordComponentsV2Message,
  type DiscordMessageFileInput,
  discordMessageFileInputSchema,
} from '../../discord/messageContract';
import {
  lookupUserMemory,
  lookupChannelMemory,
  searchChannelArchives,
  searchChannelMessages,
  searchGuildMessages,
  lookupChannelMessage,
  lookupChannelFileCache,
  lookupServerFileCache,
  readIngestedAttachmentText,
  sendCachedAttachment,
  searchAttachmentChunksInChannel,
  searchAttachmentChunksInGuild,
  lookupSocialGraph,
  lookupTopSocialGraphEdges,
  lookupVoiceAnalytics,
  lookupVoiceSessionSummaries,
  lookupUserMessageTimeline,
} from '../toolIntegrations';
import {
  type DiscordModerationActionRequest,
  type ServerInstructionsUpdateRequest,
  requestDiscordAdminActionForTool,
  requestDiscordInteractionForTool,
  lookupServerInstructionsForTool,
  requestServerInstructionsUpdateForTool,
  requestDiscordRestWriteForTool,
  type DiscordRestWriteRequest,
} from '../../admin/adminActionService';
import {
  discordRestRequestGuildScoped,
} from '../../../platform/discord/discordRestPolicy';
import { filterChannelIdsByMemberAccess } from '../../../platform/discord/channel-access';
import { client } from '../../../platform/discord/client';
import { config } from '../../../platform/config/env';
import { VoiceManager } from '../../voice/voiceManager';
import { isLoggingEnabled } from '../../settings/guildChannelSettings';
import { buildGuildApiKeySetupCardContent, buildGuildApiKeyWelcomeActions } from '../../discord/byopBootstrap';
import { clearGuildApiKey, getGuildApiKeyStatus } from '../../settings/guildApiKeyService';
import { getGuildApprovalReviewChannelId, setGuildApprovalReviewChannelId } from '../../settings/guildSettingsRepo';

export const discordRestFileInputSchema = z.object({
  fieldName: z.string().trim().min(1).max(120).optional(),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200).optional(),
  source: discordMessageFileInputSchema.shape.source,
});

export const discordPollAnswerSchema = z.string().trim().min(1).max(55);
export const discordPollDurationHoursSchema = z.number().int().min(1).max(768);
export const discordThreadAutoArchiveDurationSchema = z.union([
  z.literal(60),
  z.literal(1_440),
  z.literal(4_320),
  z.literal(10_080),
]);
export const discordOauthScopeSchema = z.enum(['bot']);
export const discordEmojiSchema = z.string().trim().min(1).max(128);
export const discordRestPathSchema = z.string().trim().min(1).max(2_000);

export function addSinceVariantValidation<T extends z.ZodObject<z.ZodRawShape>>(schema: T): T {
  return schema.superRefine((value, ctx) => {
    const record = value as Record<string, unknown>;
    const sinceVariants = ['sinceIso', 'sinceHours', 'sinceDays'].filter(
      (key) => record[key] !== undefined,
    ).length;
    if (sinceVariants > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at most one of sinceIso, sinceHours, or sinceDays.',
        path: ['sinceIso'],
      });
    }
  }) as T;
}

type DiscordActionArgs = Record<string, unknown> & { action: string };
type DiscordRestFileInput = z.infer<typeof discordRestFileInputSchema>;
type JsonRecord = Record<string, unknown>;
type DiscordRestResult = Record<string, unknown> & {
  ok?: boolean;
  status?: number;
  statusText?: string;
  data?: unknown;
};

const VIEW_CHANNEL_REQUIREMENTS = [
  { flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' },
];

function asAction<T>(args: DiscordActionArgs): T {
  return args as unknown as T;
}

function requireGuildContext(guildId?: string | null): string {
  if (!guildId) {
    throw new Error('This Discord action requires a guild context.');
  }
  return guildId;
}

function isGuildVoiceChannel(
  channel: { type?: number } | null | undefined,
): channel is VoiceChannel {
  return !!channel && channel.type === ChannelType.GuildVoice;
}

function assertNotAutopilot(invokedBy: string | undefined, actionLabel: string): void {
  if (invokedBy === 'autopilot') {
    throw new Error(`${actionLabel} is disabled in autopilot turns.`);
  }
}

function assertAdmin(invokerIsAdmin: boolean | undefined): void {
  if (!invokerIsAdmin) {
    throw new Error('Admin privileges are required for this action.');
  }
}

function normalizeDiscordPermissions(permissions: string | number | undefined): string {
  if (permissions === undefined) return '0';
  if (typeof permissions === 'number') {
    if (!Number.isFinite(permissions) || permissions < 0) {
      throw new Error('permissions must be a non-negative integer.');
    }
    return String(Math.trunc(permissions));
  }
  return permissions.trim();
}

function buildDiscordBotInviteUrl(params: {
  clientId: string;
  permissions: string;
  scopes: string[];
  guildId?: string;
  disableGuildSelect?: boolean;
}): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('scope', params.scopes.join(' '));
  if (params.scopes.includes('bot')) {
    url.searchParams.set('permissions', params.permissions);
  }
  if (params.guildId) {
    url.searchParams.set('guild_id', params.guildId);
  }
  if (params.disableGuildSelect === true) {
    url.searchParams.set('disable_guild_select', 'true');
  }
  return url.toString();
}

function parseHexColor(value: string): number {
  const normalized = value.trim().replace(/^#/, '');
  const parsed = Number.parseInt(normalized, 16);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error('colorHex must be a valid hex color (RRGGBB).');
  }
  if (parsed < 0 || parsed > 0xffffff) {
    throw new Error('colorHex must be between 000000 and FFFFFF.');
  }
  return parsed;
}

function deriveSinceIso(params: {
  sinceIso?: string;
  sinceHours?: number;
  sinceDays?: number;
}): string | undefined {
  const sinceIso = params.sinceIso?.trim();
  if (sinceIso) return sinceIso;
  if (typeof params.sinceHours === 'number' && Number.isFinite(params.sinceHours)) {
    return new Date(Date.now() - params.sinceHours * 60 * 60 * 1000).toISOString();
  }
  if (typeof params.sinceDays === 'number' && Number.isFinite(params.sinceDays)) {
    return new Date(Date.now() - params.sinceDays * 24 * 60 * 60 * 1000).toISOString();
  }
  return undefined;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toJsonRecord(value: unknown): JsonRecord {
  if (!isJsonRecord(value)) {
    throw new Error('Discord API returned an unexpected object shape.');
  }
  return value;
}

function toJsonRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Discord API returned an unexpected list shape.');
  }
  return value.filter((item): item is JsonRecord => isJsonRecord(item));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function discordTypeLabel(rawType: unknown): string {
  switch (rawType) {
    case 0:
      return 'text';
    case 2:
      return 'voice';
    case 4:
      return 'category';
    case 5:
      return 'announcement';
    case 10:
      return 'announcement_thread';
    case 11:
      return 'public_thread';
    case 12:
      return 'private_thread';
    case 13:
      return 'stage';
    case 15:
      return 'forum';
    case 16:
      return 'media';
    default:
      return 'unknown';
  }
}

function summarizePermissions(value: unknown): {
  bitfield: string | null;
  isAdministrator: boolean;
  names: string[];
} {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { bitfield: null, isAdministrator: false, names: [] };
  }

  try {
    const permissions = new PermissionsBitField(
      typeof value === 'string'
        ? BigInt(value)
        : BigInt(Math.trunc(value)),
    );
    return {
      bitfield: permissions.bitfield.toString(),
      isAdministrator: permissions.has(PermissionsBitField.Flags.Administrator),
      names: permissions.toArray().slice(0, 32),
    };
  } catch {
    return {
      bitfield: typeof value === 'string' ? value : String(value),
      isAdministrator: false,
      names: [],
    };
  }
}

function shapePermissionOverwrites(value: unknown): Array<Record<string, unknown>> {
  return toJsonRecordArray(value).map((overwrite) => ({
    id: optionalString(overwrite.id) ?? null,
    type: overwrite.type === 0 ? 'role' : overwrite.type === 1 ? 'member' : String(overwrite.type ?? 'unknown'),
    allow: summarizePermissions(overwrite.allow),
    deny: summarizePermissions(overwrite.deny),
  }));
}

function shapeChannelRecord(channel: JsonRecord): Record<string, unknown> {
  const permissionOverwrites = Array.isArray(channel.permission_overwrites)
    ? shapePermissionOverwrites(channel.permission_overwrites)
    : [];
  const type = discordTypeLabel(channel.type);
  const threadMetadata = isJsonRecord(channel.thread_metadata) ? channel.thread_metadata : null;
  const availableTags = Array.isArray(channel.available_tags)
    ? channel.available_tags
      .filter((tag): tag is JsonRecord => isJsonRecord(tag))
      .map((tag) => ({
        id: optionalString(tag.id) ?? null,
        name: optionalString(tag.name) ?? null,
        moderated: optionalBoolean(tag.moderated) ?? false,
        emojiId: optionalString(tag.emoji_id) ?? null,
        emojiName: optionalString(tag.emoji_name) ?? null,
      }))
    : [];

  return {
    id: optionalString(channel.id) ?? null,
    guildId: optionalString(channel.guild_id) ?? null,
    parentId: optionalString(channel.parent_id) ?? null,
    name: optionalString(channel.name) ?? null,
    type,
    position: optionalNumber(channel.position) ?? null,
    topic: optionalString(channel.topic) ?? null,
    nsfw: optionalBoolean(channel.nsfw) ?? false,
    rateLimitPerUser: optionalNumber(channel.rate_limit_per_user) ?? null,
    defaultAutoArchiveDurationMinutes: optionalNumber(channel.default_auto_archive_duration) ?? null,
    defaultThreadRateLimitPerUser: optionalNumber(channel.default_thread_rate_limit_per_user) ?? null,
    isThread: threadMetadata !== null,
    threadMetadata: threadMetadata
      ? {
        archived: optionalBoolean(threadMetadata.archived) ?? false,
        locked: optionalBoolean(threadMetadata.locked) ?? false,
        autoArchiveDurationMinutes: optionalNumber(threadMetadata.auto_archive_duration) ?? null,
        archiveTimestamp: optionalString(threadMetadata.archive_timestamp) ?? null,
        createTimestamp: optionalString(threadMetadata.create_timestamp) ?? null,
        invitable: optionalBoolean(threadMetadata.invitable) ?? null,
      }
      : null,
    messageCount: optionalNumber(channel.message_count) ?? null,
    memberCount: optionalNumber(channel.member_count) ?? null,
    totalMessageSent: optionalNumber(channel.total_message_sent) ?? null,
    lastMessageId: optionalString(channel.last_message_id) ?? null,
    lastPinTimestamp: optionalString(channel.last_pin_timestamp) ?? null,
    permissions: summarizePermissions(channel.permissions),
    flags: optionalNumber(channel.flags) ?? null,
    availableTags,
    appliedTags: optionalStringArray(channel.applied_tags) ?? [],
    permissionOverwrites,
  };
}

function shapeRoleRecord(role: JsonRecord): Record<string, unknown> {
  return {
    id: optionalString(role.id) ?? null,
    name: optionalString(role.name) ?? null,
    color: optionalNumber(role.color) ?? null,
    colorHex:
      typeof role.color === 'number'
        ? `#${role.color.toString(16).padStart(6, '0')}`
        : null,
    hoist: optionalBoolean(role.hoist) ?? false,
    managed: optionalBoolean(role.managed) ?? false,
    mentionable: optionalBoolean(role.mentionable) ?? false,
    position: optionalNumber(role.position) ?? null,
    permissions: summarizePermissions(role.permissions),
  };
}

function shapeScheduledEventRecord(event: JsonRecord): Record<string, unknown> {
  const entityMetadata = isJsonRecord(event.entity_metadata) ? event.entity_metadata : null;
  return {
    id: optionalString(event.id) ?? null,
    name: optionalString(event.name) ?? null,
    description: optionalString(event.description) ?? null,
    status: optionalNumber(event.status) ?? null,
    entityType: optionalNumber(event.entity_type) ?? null,
    privacyLevel: optionalNumber(event.privacy_level) ?? null,
    scheduledStartTime: optionalString(event.scheduled_start_time) ?? null,
    scheduledEndTime: optionalString(event.scheduled_end_time) ?? null,
    channelId: optionalString(event.channel_id) ?? null,
    creatorId: optionalString(event.creator_id) ?? null,
    userCount: optionalNumber(event.user_count) ?? null,
    location: entityMetadata ? optionalString(entityMetadata.location) ?? null : null,
  };
}

function shapeMemberRecord(member: JsonRecord): Record<string, unknown> {
  const user = isJsonRecord(member.user) ? member.user : null;
  const roles = optionalStringArray(member.roles) ?? [];
  return {
    userId: user ? optionalString(user.id) ?? null : null,
    username: user ? optionalString(user.username) ?? null : null,
    globalName: user ? optionalString(user.global_name) ?? null : null,
    discriminator: user ? optionalString(user.discriminator) ?? null : null,
    bot: user ? optionalBoolean(user.bot) ?? false : false,
    nick: optionalString(member.nick) ?? null,
    joinedAt: optionalString(member.joined_at) ?? null,
    premiumSince: optionalString(member.premium_since) ?? null,
    pending: optionalBoolean(member.pending) ?? false,
    communicationDisabledUntil: optionalString(member.communication_disabled_until) ?? null,
    roleIds: roles,
  };
}

function shapeAutomodRuleRecord(rule: JsonRecord): Record<string, unknown> {
  return {
    id: optionalString(rule.id) ?? null,
    name: optionalString(rule.name) ?? null,
    creatorId: optionalString(rule.creator_id) ?? null,
    enabled: optionalBoolean(rule.enabled) ?? false,
    eventType: optionalNumber(rule.event_type) ?? null,
    triggerType: optionalNumber(rule.trigger_type) ?? null,
    exemptChannels: optionalStringArray(rule.exempt_channels) ?? [],
    exemptRoles: optionalStringArray(rule.exempt_roles) ?? [],
    actionCount: Array.isArray(rule.actions) ? rule.actions.length : 0,
  };
}

async function readDiscordGuildResource(params: {
  ctx: ToolExecutionContext;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  maxResponseChars?: number;
}): Promise<unknown> {
  const guildId = requireGuildContext(params.ctx.guildId);
  const result = await discordRestRequestGuildScoped({
    guildId,
    method: 'GET',
    path: params.path,
    query: params.query,
    maxResponseChars: params.maxResponseChars,
    signal: params.ctx.signal,
  }) as DiscordRestResult;

  if (result.ok !== true) {
    throw new Error(
      `Discord API request failed (${String(result.status ?? 'unknown')} ${String(result.statusText ?? '').trim()}).`,
    );
  }

  return result.data;
}

async function assertRequesterCanViewChannel(ctx: ToolExecutionContext, channelId: string): Promise<void> {
  const guildId = requireGuildContext(ctx.guildId);
  const allowed = await filterChannelIdsByMemberAccess({
    guildId,
    userId: ctx.userId,
    channelIds: [channelId],
    requirements: VIEW_CHANNEL_REQUIREMENTS,
  });
  if (!allowed.has(channelId)) {
    throw new Error('You do not have access to that channel.');
  }
}

async function filterAccessibleChannels(
  ctx: ToolExecutionContext,
  channels: JsonRecord[],
): Promise<JsonRecord[]> {
  if (!ctx.guildId) return [];
  const channelIds = channels
    .map((channel) => optionalString(channel.id))
    .filter((id): id is string => !!id);
  const allowedIds = await filterChannelIdsByMemberAccess({
    guildId: ctx.guildId,
    userId: ctx.userId,
    channelIds,
    requirements: VIEW_CHANNEL_REQUIREMENTS,
  });
  return channels.filter((channel) => {
    const channelId = optionalString(channel.id);
    return !!channelId && allowedIds.has(channelId);
  });
}

function queueDiscordRestWrite(params: {
  ctx: ToolExecutionContext;
  actionLabel: string;
  request: DiscordRestWriteRequest;
}): Promise<Record<string, unknown>> {
  assertAdmin(params.ctx.invokerIsAdmin);
  assertNotAutopilot(params.ctx.invokedBy, params.actionLabel);
  const guildId = requireGuildContext(params.ctx.guildId);
  return requestDiscordRestWriteForTool({
    guildId,
    channelId: params.ctx.channelId,
    requestedBy: params.ctx.userId,
    request: params.request,
  });
}

export async function executeDiscordContextAction(
  args: DiscordActionArgs,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  switch (args.action) {
    case 'get_user_profile': {
      const data = asAction<{
        userId?: string;
        maxChars?: number;
        maxItemsPerSection?: number;
      }>(args);
      return lookupUserMemory({
        userId: data.userId?.trim() || ctx.userId,
        maxChars: data.maxChars,
        maxItemsPerSection: data.maxItemsPerSection,
      });
    }
    case 'get_channel_summary': {
      const data = asAction<{
        maxChars?: number;
        maxItemsPerList?: number;
        maxRecentFiles?: number;
      }>(args);
      return lookupChannelMemory({
        guildId: ctx.guildId ?? null,
        channelId: ctx.channelId,
        maxChars: data.maxChars,
        maxItemsPerList: data.maxItemsPerList,
        maxRecentFiles: data.maxRecentFiles,
      });
    }
    case 'search_channel_summary_archives': {
      const data = asAction<{ query: string; topK?: number; maxChars?: number }>(args);
      return searchChannelArchives({
        guildId: ctx.guildId ?? null,
        channelId: ctx.channelId,
        query: data.query,
        topK: data.topK,
        maxChars: data.maxChars,
      });
    }
    case 'get_server_instructions': {
      const data = asAction<{ maxChars?: number }>(args);
      return lookupServerInstructionsForTool({
        guildId: requireGuildContext(ctx.guildId),
        maxChars: data.maxChars,
      });
    }
    case 'get_social_graph': {
      const data = asAction<{ userId?: string; maxEdges?: number; maxChars?: number }>(args);
      return lookupSocialGraph({
        guildId: ctx.guildId ?? null,
        userId: data.userId?.trim() || ctx.userId,
        maxEdges: data.maxEdges,
        maxChars: data.maxChars,
      });
    }
    case 'get_top_relationships': {
      const data = asAction<{ limit?: number; maxChars?: number }>(args);
      assertNotAutopilot(ctx.invokedBy, 'get_top_relationships');
      return lookupTopSocialGraphEdges({
        guildId: ctx.guildId ?? null,
        limit: data.limit,
        maxChars: data.maxChars,
      });
    }
    case 'get_voice_analytics': {
      const data = asAction<{ userId?: string; maxChars?: number }>(args);
      return lookupVoiceAnalytics({
        guildId: ctx.guildId ?? null,
        userId: data.userId?.trim() || ctx.userId,
        maxChars: data.maxChars,
      });
    }
    case 'get_voice_summaries': {
      const data = asAction<{
        voiceChannelId?: string;
        sinceHours?: number;
        limit?: number;
        maxChars?: number;
      }>(args);
      return lookupVoiceSessionSummaries({
        guildId: ctx.guildId ?? null,
        voiceChannelId: data.voiceChannelId?.trim() || undefined,
        sinceHours: data.sinceHours,
        limit: data.limit,
        maxChars: data.maxChars,
      });
    }
    default:
      throw new Error(`Unsupported discord_context action: ${args.action}`);
  }
}

export async function executeDiscordFilesAction(
  args: DiscordActionArgs,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  switch (args.action) {
    case 'list_channel': {
      const data = asAction<{
        query?: string;
        messageId?: string;
        filename?: string;
        limit?: number;
        includeContent?: boolean;
        maxChars?: number;
      }>(args);
      return lookupChannelFileCache({
        guildId: ctx.guildId ?? null,
        channelId: ctx.channelId,
        query: data.query,
        messageId: data.messageId,
        filename: data.filename,
        limit: data.limit,
        includeContent: data.includeContent,
        maxChars: data.maxChars,
      });
    }
    case 'list_server': {
      const data = asAction<{
        query?: string;
        messageId?: string;
        filename?: string;
        limit?: number;
        includeContent?: boolean;
        maxChars?: number;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'list_server');
      return lookupServerFileCache({
        guildId: ctx.guildId ?? null,
        requesterUserId: ctx.userId,
        query: data.query,
        messageId: data.messageId,
        filename: data.filename,
        limit: data.limit,
        includeContent: data.includeContent,
        maxChars: data.maxChars,
      });
    }
    case 'find_channel': {
      const data = asAction<{ query: string; topK?: number; maxChars?: number }>(args);
      return searchAttachmentChunksInChannel({
        guildId: ctx.guildId ?? null,
        channelId: ctx.channelId,
        query: data.query,
        topK: data.topK,
        maxChars: data.maxChars,
      });
    }
    case 'find_server': {
      const data = asAction<{ query: string; topK?: number; maxChars?: number }>(args);
      assertNotAutopilot(ctx.invokedBy, 'find_server');
      return searchAttachmentChunksInGuild({
        guildId: ctx.guildId ?? null,
        requesterUserId: ctx.userId,
        query: data.query,
        topK: data.topK,
        maxChars: data.maxChars,
      });
    }
    case 'read_attachment': {
      const data = asAction<{ attachmentId: string; startChar?: number; maxChars?: number }>(args);
      assertNotAutopilot(ctx.invokedBy, 'read_attachment');
      return readIngestedAttachmentText({
        guildId: ctx.guildId ?? null,
        requesterUserId: ctx.userId,
        attachmentId: data.attachmentId,
        startChar: data.startChar,
        maxChars: data.maxChars,
      });
    }
    case 'send_attachment': {
      const data = asAction<{
        attachmentId: string;
        channelId?: string;
        content?: string;
        reason?: string;
        startChar?: number;
        maxChars?: number;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'send_attachment');
      return sendCachedAttachment({
        guildId: ctx.guildId ?? null,
        requesterUserId: ctx.userId,
        requesterChannelId: ctx.channelId,
        invokedBy: ctx.invokedBy,
        attachmentId: data.attachmentId,
        channelId: data.channelId,
        content: data.content,
        reason: data.reason,
        startChar: data.startChar,
        maxChars: data.maxChars,
      });
    }
    default:
      throw new Error(`Unsupported discord_files action: ${args.action}`);
  }
}

export async function executeDiscordServerAction(
  args: DiscordActionArgs,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  switch (args.action) {
    case 'list_channels': {
      const data = asAction<{
        type?: 'text' | 'voice' | 'category' | 'announcement' | 'forum' | 'media' | 'stage';
        limit?: number;
      }>(args);
      const channels = toJsonRecordArray(
        await readDiscordGuildResource({
          ctx,
          path: `/guilds/${requireGuildContext(ctx.guildId)}/channels`,
          maxResponseChars: 50_000,
        }),
      );
      const accessible = await filterAccessibleChannels(ctx, channels);
      const filtered = accessible
        .map((channel) => shapeChannelRecord(channel))
        .filter((channel) => !data.type || channel.type === data.type)
        .slice(0, data.limit ?? 50);
      return {
        ok: true,
        action: 'list_channels',
        guildId: requireGuildContext(ctx.guildId),
        totalChannels: channels.length,
        accessibleCount: accessible.length,
        items: filtered,
      };
    }
    case 'get_channel': {
      const data = asAction<{ channelId: string }>(args);
      await assertRequesterCanViewChannel(ctx, data.channelId);
      const channel = toJsonRecord(
        await readDiscordGuildResource({
          ctx,
          path: `/channels/${data.channelId}`,
          maxResponseChars: 20_000,
        }),
      );
      return {
        ok: true,
        action: 'get_channel',
        channel: shapeChannelRecord(channel),
      };
    }
    case 'list_roles': {
      const data = asAction<{ limit?: number }>(args);
      const roles = toJsonRecordArray(
        await readDiscordGuildResource({
          ctx,
          path: `/guilds/${requireGuildContext(ctx.guildId)}/roles`,
          maxResponseChars: 50_000,
        }),
      );
      return {
        ok: true,
        action: 'list_roles',
        guildId: requireGuildContext(ctx.guildId),
        items: roles
          .sort((left, right) => (optionalNumber(right.position) ?? 0) - (optionalNumber(left.position) ?? 0))
          .slice(0, data.limit ?? 50)
          .map((role) => shapeRoleRecord(role)),
      };
    }
    case 'list_threads': {
      const data = asAction<{
        parentChannelId?: string;
        includeArchived?: boolean;
        limit?: number;
      }>(args);
      if (data.includeArchived && !data.parentChannelId) {
        throw new Error('includeArchived requires parentChannelId.');
      }

      if (data.parentChannelId) {
        await assertRequesterCanViewChannel(ctx, data.parentChannelId);
      }

      const activeThreadsPayload = toJsonRecord(
        await readDiscordGuildResource({
          ctx,
          path: `/guilds/${requireGuildContext(ctx.guildId)}/threads/active`,
          maxResponseChars: 50_000,
        }),
      );

      const activeThreads = toJsonRecordArray(activeThreadsPayload.threads);
      let threads = activeThreads;

      if (data.parentChannelId) {
        threads = threads.filter((thread) => optionalString(thread.parent_id) === data.parentChannelId);
      }

      if (data.includeArchived && data.parentChannelId) {
        const archivedSources = [
          `/channels/${data.parentChannelId}/threads/archived/public`,
          `/channels/${data.parentChannelId}/users/@me/threads/archived/private`,
        ];

        for (const path of archivedSources) {
          try {
            const archivedPayload = await readDiscordGuildResource({
              ctx,
              path,
              maxResponseChars: 50_000,
            });
            if (isJsonRecord(archivedPayload) && Array.isArray(archivedPayload.threads)) {
              threads = [...threads, ...toJsonRecordArray(archivedPayload.threads)];
            }
          } catch {
            // Some thread archives are permission-gated. Active results remain valid.
          }
        }
      }

      const accessible = await filterAccessibleChannels(ctx, threads);
      const deduped = new Map<string, JsonRecord>();
      for (const thread of accessible) {
        const threadId = optionalString(thread.id);
        if (!threadId || deduped.has(threadId)) continue;
        deduped.set(threadId, thread);
      }

      return {
        ok: true,
        action: 'list_threads',
        guildId: requireGuildContext(ctx.guildId),
        parentChannelId: data.parentChannelId ?? null,
        includeArchived: data.includeArchived ?? false,
        items: Array.from(deduped.values())
          .slice(0, data.limit ?? 50)
          .map((thread) => shapeChannelRecord(thread)),
      };
    }
    case 'get_thread': {
      const data = asAction<{ threadId: string }>(args);
      await assertRequesterCanViewChannel(ctx, data.threadId);
      const thread = toJsonRecord(
        await readDiscordGuildResource({
          ctx,
          path: `/channels/${data.threadId}`,
          maxResponseChars: 20_000,
        }),
      );
      return {
        ok: true,
        action: 'get_thread',
        thread: shapeChannelRecord(thread),
      };
    }
    case 'list_scheduled_events': {
      const data = asAction<{ includeCompleted?: boolean; limit?: number }>(args);
      const events = toJsonRecordArray(
        await readDiscordGuildResource({
          ctx,
          path: `/guilds/${requireGuildContext(ctx.guildId)}/scheduled-events`,
          query: { with_user_count: true },
          maxResponseChars: 50_000,
        }),
      );
      const filtered = data.includeCompleted
        ? events
        : events.filter((event) => {
          const status = optionalNumber(event.status);
          return status === 1 || status === 2;
        });
      return {
        ok: true,
        action: 'list_scheduled_events',
        guildId: requireGuildContext(ctx.guildId),
        items: filtered.slice(0, data.limit ?? 50).map((event) => shapeScheduledEventRecord(event)),
      };
    }
    case 'get_scheduled_event': {
      const data = asAction<{ eventId: string }>(args);
      const event = toJsonRecord(
        await readDiscordGuildResource({
          ctx,
          path: `/guilds/${requireGuildContext(ctx.guildId)}/scheduled-events/${data.eventId}`,
          query: { with_user_count: true },
          maxResponseChars: 20_000,
        }),
      );
      return {
        ok: true,
        action: 'get_scheduled_event',
        event: shapeScheduledEventRecord(event),
      };
    }
    case 'list_members': {
      const data = asAction<{ query?: string; roleId?: string; limit?: number }>(args);
      assertAdmin(ctx.invokerIsAdmin);
      const limit = data.limit ?? 25;
      const path = data.query?.trim()
        ? `/guilds/${requireGuildContext(ctx.guildId)}/members/search`
        : `/guilds/${requireGuildContext(ctx.guildId)}/members`;
      const members = toJsonRecordArray(
        await readDiscordGuildResource({
          ctx,
          path,
          query: data.query?.trim()
            ? { query: data.query.trim(), limit }
            : { limit },
          maxResponseChars: 50_000,
        }),
      );
      const filtered = data.roleId
        ? members.filter((member) => (optionalStringArray(member.roles) ?? []).includes(data.roleId!))
        : members;
      return {
        ok: true,
        action: 'list_members',
        guildId: requireGuildContext(ctx.guildId),
        items: filtered.slice(0, limit).map((member) => shapeMemberRecord(member)),
      };
    }
    case 'get_member': {
      const data = asAction<{ userId: string }>(args);
      assertAdmin(ctx.invokerIsAdmin);
      const member = toJsonRecord(
        await readDiscordGuildResource({
          ctx,
          path: `/guilds/${requireGuildContext(ctx.guildId)}/members/${data.userId}`,
          maxResponseChars: 20_000,
        }),
      );
      return {
        ok: true,
        action: 'get_member',
        member: shapeMemberRecord(member),
      };
    }
    case 'get_permission_snapshot': {
      const data = asAction<{ channelId: string; userId?: string; roleId?: string }>(args);
      assertAdmin(ctx.invokerIsAdmin);
      const guild = await client.guilds.fetch(requireGuildContext(ctx.guildId));
      const channel = await guild.channels.fetch(data.channelId);
      if (!channel || channel.isDMBased() || !('permissionsFor' in channel)) {
        throw new Error('Target channel is unavailable or does not support permission snapshots.');
      }

      const target = data.userId
        ? await guild.members.fetch(data.userId)
        : await guild.roles.fetch(data.roleId!);
      if (!target) {
        throw new Error('Target user or role was not found.');
      }

      const permissions = channel.permissionsFor(target);
      if (!permissions) {
        throw new Error('Unable to resolve permissions for the requested target.');
      }

      return {
        ok: true,
        action: 'get_permission_snapshot',
        guildId: guild.id,
        channelId: channel.id,
        targetType: data.userId ? 'member' : 'role',
        targetId: data.userId ?? data.roleId ?? null,
        permissions: summarizePermissions(permissions.bitfield.toString()),
      };
    }
    case 'list_automod_rules': {
      const data = asAction<{ limit?: number }>(args);
      assertAdmin(ctx.invokerIsAdmin);
      const rules = toJsonRecordArray(
        await readDiscordGuildResource({
          ctx,
          path: `/guilds/${requireGuildContext(ctx.guildId)}/auto-moderation/rules`,
          maxResponseChars: 50_000,
        }),
      );
      return {
        ok: true,
        action: 'list_automod_rules',
        guildId: requireGuildContext(ctx.guildId),
        items: rules.slice(0, data.limit ?? 50).map((rule) => shapeAutomodRuleRecord(rule)),
      };
    }
    case 'create_thread': {
      const data = asAction<{
        name: string;
        messageId?: string;
        channelId?: string;
        autoArchiveDurationMinutes?: 60 | 1440 | 4320 | 10080;
        reason?: string;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'create_thread');
      return requestDiscordInteractionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        invokedBy: ctx.invokedBy,
        request: {
          action: 'create_thread',
          name: data.name,
          messageId: data.messageId,
          channelId: data.channelId?.trim() || undefined,
          autoArchiveDurationMinutes: data.autoArchiveDurationMinutes,
          reason: data.reason,
        },
      });
    }
    case 'update_thread': {
      const data = asAction<{
        threadId: string;
        name?: string;
        archived?: boolean;
        locked?: boolean;
        autoArchiveDurationMinutes?: 60 | 1440 | 4320 | 10080;
        reason?: string;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'update_thread');
      return requestDiscordInteractionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        invokedBy: ctx.invokedBy,
        request: {
          action: 'update_thread',
          threadId: data.threadId,
          name: data.name,
          archived: data.archived,
          locked: data.locked,
          autoArchiveDurationMinutes: data.autoArchiveDurationMinutes,
          reason: data.reason,
        },
      });
    }
    case 'join_thread':
    case 'leave_thread': {
      const data = asAction<{ threadId: string; reason?: string }>(args);
      assertNotAutopilot(ctx.invokedBy, args.action);
      return requestDiscordInteractionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        invokedBy: ctx.invokedBy,
        request: {
          action: args.action,
          threadId: data.threadId,
          reason: data.reason,
        },
      });
    }
    case 'add_thread_member':
    case 'remove_thread_member': {
      const data = asAction<{ threadId: string; userId: string; reason?: string }>(args);
      assertNotAutopilot(ctx.invokedBy, args.action);
      return requestDiscordInteractionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        invokedBy: ctx.invokedBy,
        request: {
          action: args.action,
          threadId: data.threadId,
          userId: data.userId,
          reason: data.reason,
        },
      });
    }
    default:
      throw new Error(`Unsupported discord_server action: ${args.action}`);
  }
}

export async function executeDiscordVoiceAction(
  args: DiscordActionArgs,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  const guildId = requireGuildContext(ctx.guildId);

  switch (args.action) {
    case 'get_status': {
      const voiceManager = VoiceManager.getInstance();
      const connection = voiceManager.getConnection(guildId);
      const channelId = connection?.joinConfig.channelId ?? null;
      const guild = await client.guilds.fetch(guildId);
      const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;

      return {
        ok: true,
        action: 'get_status',
        guildId,
        connected: !!connection,
        channelId,
        channelName: channel && 'name' in channel ? channel.name : null,
        transcriptionActive:
          !!channelId && config.VOICE_STT_ENABLED && isLoggingEnabled(guildId, channelId),
      };
    }
    case 'join_current_channel': {
      assertNotAutopilot(ctx.invokedBy, 'join_current_channel');
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(ctx.userId).catch(() => null);
      if (!member) {
        throw new Error('Could not resolve the invoking member for voice join.');
      }

      const channel = member.voice.channel;
      if (!isGuildVoiceChannel(channel)) {
        throw new Error('You must be in a standard voice channel to use this action. Stage channels are not supported.');
      }

      const voiceManager = VoiceManager.getInstance();
      await voiceManager.joinChannel({ channel, initiatedByUserId: ctx.userId });

      return {
        ok: true,
        action: 'join_current_channel',
        guildId,
        channelId: channel.id,
        channelName: channel.name,
        transcriptionActive: config.VOICE_STT_ENABLED && isLoggingEnabled(guildId, channel.id),
      };
    }
    case 'leave': {
      assertNotAutopilot(ctx.invokedBy, 'leave');
      const voiceManager = VoiceManager.getInstance();
      const connection = voiceManager.getConnection(guildId);
      if (!connection) {
        return {
          ok: true,
          action: 'leave',
          guildId,
          connected: false,
          message: 'Sage is not currently in a voice channel.',
        };
      }

      await voiceManager.leaveChannel(guildId);
      return {
        ok: true,
        action: 'leave',
        guildId,
        connected: false,
        message: 'Left the active voice channel.',
      };
    }
    default:
      throw new Error(`Unsupported discord_voice action: ${args.action}`);
  }
}

export async function executeDiscordMessagesAction(
  args: DiscordActionArgs,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  switch (args.action) {
    case 'search_history': {
      const data = asAction<{
        channelId?: string;
        query: string;
        topK?: number;
        maxChars?: number;
        mode?: 'hybrid' | 'semantic' | 'lexical' | 'regex';
        regexPattern?: string;
        sinceIso?: string;
        untilIso?: string;
        sinceHours?: number;
        sinceDays?: number;
      }>(args);
      const targetChannelId = (data.channelId?.trim() || ctx.channelId).trim();
      if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
        throw new Error('Cross-channel message history search is disabled in autopilot turns.');
      }
      return searchChannelMessages({
        guildId: ctx.guildId ?? null,
        channelId: targetChannelId,
        requesterUserId: ctx.userId,
        query: data.query,
        topK: data.topK,
        maxChars: data.maxChars,
        mode: data.mode,
        regexPattern: data.regexPattern,
        sinceIso: deriveSinceIso(data),
        untilIso: data.untilIso,
      });
    }
    case 'search_with_context': {
      const data = asAction<{
        channelId?: string;
        query: string;
        topK?: number;
        maxChars?: number;
        mode?: 'hybrid' | 'semantic' | 'lexical' | 'regex';
        regexPattern?: string;
        sinceIso?: string;
        untilIso?: string;
        sinceHours?: number;
        sinceDays?: number;
        before?: number;
        after?: number;
        contextMaxChars?: number;
      }>(args);
      const targetChannelId = (data.channelId?.trim() || ctx.channelId).trim();
      if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
        throw new Error('Cross-channel message history search is disabled in autopilot turns.');
      }
      const search = await searchChannelMessages({
        guildId: ctx.guildId ?? null,
        channelId: targetChannelId,
        requesterUserId: ctx.userId,
        query: data.query,
        topK: data.topK,
        maxChars: data.maxChars,
        mode: data.mode,
        regexPattern: data.regexPattern,
        sinceIso: deriveSinceIso(data),
        untilIso: data.untilIso,
      });

      const items = search.items;
      const bestMessageId =
        Array.isArray(items) && items.length > 0 && items[0] && typeof items[0] === 'object'
          ? ((items[0] as Record<string, unknown>).messageId as string | undefined)
          : undefined;

      if (!bestMessageId) {
        return {
          ...search,
          context: null,
        };
      }

      const context = await lookupChannelMessage({
        guildId: ctx.guildId ?? null,
        channelId: targetChannelId,
        requesterUserId: ctx.userId,
        messageId: bestMessageId,
        before: data.before ?? 5,
        after: data.after ?? 5,
        maxChars: data.contextMaxChars ?? data.maxChars,
      });

      return {
        found: true,
        action: 'search_with_context',
        channelId: targetChannelId,
        query: data.query,
        search,
        context,
      };
    }
    case 'get_context': {
      const data = asAction<{
        channelId?: string;
        messageId: string;
        before?: number;
        after?: number;
        maxChars?: number;
      }>(args);
      const targetChannelId = (data.channelId?.trim() || ctx.channelId).trim();
      if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
        throw new Error('Cross-channel message history lookup is disabled in autopilot turns.');
      }
      return lookupChannelMessage({
        guildId: ctx.guildId ?? null,
        channelId: targetChannelId,
        requesterUserId: ctx.userId,
        messageId: data.messageId,
        before: data.before,
        after: data.after,
        maxChars: data.maxChars,
      });
    }
    case 'search_guild': {
      const data = asAction<{
        query: string;
        topK?: number;
        maxChars?: number;
        mode?: 'hybrid' | 'semantic' | 'lexical' | 'regex';
        regexPattern?: string;
        sinceIso?: string;
        untilIso?: string;
        sinceHours?: number;
        sinceDays?: number;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'search_guild');
      return searchGuildMessages({
        guildId: ctx.guildId ?? null,
        requesterUserId: ctx.userId,
        query: data.query,
        topK: data.topK,
        maxChars: data.maxChars,
        mode: data.mode,
        regexPattern: data.regexPattern,
        sinceIso: deriveSinceIso(data),
        untilIso: data.untilIso,
      });
    }
    case 'get_user_timeline': {
      const data = asAction<{
        userId?: string;
        limit?: number;
        maxChars?: number;
        sinceIso?: string;
        untilIso?: string;
        sinceHours?: number;
        sinceDays?: number;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'get_user_timeline');
      return lookupUserMessageTimeline({
        guildId: ctx.guildId ?? null,
        requesterUserId: ctx.userId,
        userId: data.userId?.trim() || ctx.userId,
        limit: data.limit,
        maxChars: data.maxChars,
        sinceIso: deriveSinceIso(data),
        untilIso: data.untilIso,
      });
    }
    case 'send': {
      const data = asAction<{
        channelId?: string;
        presentation?: 'plain' | 'components_v2';
        content?: string;
        files?: DiscordMessageFileInput[];
        componentsV2?: DiscordComponentsV2Message;
        reason?: string;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'send');
      return requestDiscordInteractionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        invokedBy: ctx.invokedBy,
        request: {
          action: 'send_message',
          channelId: data.channelId?.trim() || ctx.channelId,
          presentation: data.presentation,
          content: data.content,
          files: data.files,
          componentsV2: data.componentsV2,
          reason: data.reason,
        },
      });
    }
    case 'create_poll': {
      const data = asAction<{
        question: string;
        answers: string[];
        durationHours?: number;
        allowMultiselect?: boolean;
        channelId?: string;
        reason?: string;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'create_poll');
      return requestDiscordInteractionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        invokedBy: ctx.invokedBy,
        request: {
          action: 'create_poll',
          question: data.question,
          answers: data.answers,
          durationHours: data.durationHours ?? 24,
          allowMultiselect: data.allowMultiselect,
          channelId: data.channelId?.trim() || undefined,
          reason: data.reason,
        },
      });
    }
    case 'add_reaction': {
      const data = asAction<{
        messageId: string;
        channelId?: string;
        emoji: string;
        reason?: string;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'add_reaction');
      return requestDiscordInteractionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        invokedBy: ctx.invokedBy,
        request: {
          action: 'add_reaction',
          messageId: data.messageId,
          channelId: data.channelId?.trim() || undefined,
          emoji: data.emoji,
          reason: data.reason,
        },
      });
    }
    case 'remove_self_reaction': {
      const data = asAction<{
        messageId: string;
        channelId?: string;
        emoji: string;
        reason?: string;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'remove_self_reaction');
      return requestDiscordInteractionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        invokedBy: ctx.invokedBy,
        request: {
          action: 'remove_bot_reaction',
          messageId: data.messageId,
          channelId: data.channelId?.trim() || undefined,
          emoji: data.emoji,
          reason: data.reason,
        },
      });
    }
    default:
      throw new Error(`Unsupported discord_messages action: ${args.action}`);
  }
}

export async function executeDiscordAdminAction(
  args: DiscordActionArgs,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  switch (args.action) {
    case 'update_server_instructions': {
      const data = asAction<{ request: ServerInstructionsUpdateRequest }>(args);
      assertAdmin(ctx.invokerIsAdmin);
      assertNotAutopilot(ctx.invokedBy, 'update_server_instructions');
      return requestServerInstructionsUpdateForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        request: data.request,
      });
    }
    case 'submit_moderation': {
      const data = asAction<{ request: DiscordModerationActionRequest }>(args);
      assertAdmin(ctx.invokerIsAdmin);
      assertNotAutopilot(ctx.invokedBy, 'submit_moderation');
      return requestDiscordAdminActionForTool({
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        request: data.request,
        currentTurn: ctx.currentTurn,
        replyTarget: ctx.replyTarget,
      });
    }
    case 'edit_message': {
      const data = asAction<{
        channelId?: string;
        messageId: string;
        content: string;
        reason?: string;
      }>(args);
      return queueDiscordRestWrite({
        ctx,
        actionLabel: 'edit_message',
        request: {
          method: 'PATCH',
          path: `/channels/${(data.channelId?.trim() || ctx.channelId).trim()}/messages/${data.messageId}`,
          body: {
            content: data.content,
            allowed_mentions: { parse: [] },
          },
          reason: data.reason,
        },
      });
    }
    case 'delete_message':
    case 'pin_message':
    case 'unpin_message': {
      const data = asAction<{
        channelId?: string;
        messageId: string;
        reason?: string;
      }>(args);
      const channelId = (data.channelId?.trim() || ctx.channelId).trim();
      const request =
        args.action === 'delete_message'
          ? { method: 'DELETE' as const, path: `/channels/${channelId}/messages/${data.messageId}` }
          : args.action === 'pin_message'
            ? { method: 'PUT' as const, path: `/channels/${channelId}/pins/${data.messageId}` }
            : { method: 'DELETE' as const, path: `/channels/${channelId}/pins/${data.messageId}` };
      return queueDiscordRestWrite({
        ctx,
        actionLabel: args.action,
        request: {
          ...request,
          reason: data.reason,
        },
      });
    }
    case 'create_channel': {
      const data = asAction<{
        name: string;
        type?: 'text' | 'voice' | 'category';
        parentId?: string;
        topic?: string;
        nsfw?: boolean;
        rateLimitPerUser?: number;
        reason?: string;
      }>(args);
      const type = data.type ?? 'text';
      const typeId = type === 'voice' ? 2 : type === 'category' ? 4 : 0;
      const body: Record<string, unknown> = {
        name: data.name,
        type: typeId,
      };
      if (data.parentId) body.parent_id = data.parentId;
      if (data.nsfw !== undefined) body.nsfw = data.nsfw;
      if (type === 'text') {
        if (data.topic !== undefined) body.topic = data.topic;
        if (data.rateLimitPerUser !== undefined) body.rate_limit_per_user = data.rateLimitPerUser;
      }
      return queueDiscordRestWrite({
        ctx,
        actionLabel: 'create_channel',
        request: {
          method: 'POST',
          path: `/guilds/${requireGuildContext(ctx.guildId)}/channels`,
          body,
          reason: data.reason,
        },
      });
    }
    case 'edit_channel': {
      const data = asAction<{
        channelId: string;
        name?: string;
        parentId?: string;
        topic?: string;
        nsfw?: boolean;
        rateLimitPerUser?: number;
        reason?: string;
      }>(args);
      const body: Record<string, unknown> = {};
      if (data.name !== undefined) body.name = data.name;
      if (data.parentId !== undefined) body.parent_id = data.parentId;
      if (data.topic !== undefined) body.topic = data.topic;
      if (data.nsfw !== undefined) body.nsfw = data.nsfw;
      if (data.rateLimitPerUser !== undefined) body.rate_limit_per_user = data.rateLimitPerUser;
      return queueDiscordRestWrite({
        ctx,
        actionLabel: 'edit_channel',
        request: {
          method: 'PATCH',
          path: `/channels/${data.channelId}`,
          body,
          reason: data.reason,
        },
      });
    }
    case 'create_role': {
      const data = asAction<{
        name: string;
        colorHex?: string;
        hoist?: boolean;
        mentionable?: boolean;
        permissions?: string | number;
        reason?: string;
      }>(args);
      const body: Record<string, unknown> = { name: data.name };
      if (data.colorHex) body.color = parseHexColor(data.colorHex);
      if (data.hoist !== undefined) body.hoist = data.hoist;
      if (data.mentionable !== undefined) body.mentionable = data.mentionable;
      if (data.permissions !== undefined) body.permissions = data.permissions;
      return queueDiscordRestWrite({
        ctx,
        actionLabel: 'create_role',
        request: {
          method: 'POST',
          path: `/guilds/${requireGuildContext(ctx.guildId)}/roles`,
          body,
          reason: data.reason,
        },
      });
    }
    case 'edit_role': {
      const data = asAction<{
        roleId: string;
        name?: string;
        colorHex?: string;
        hoist?: boolean;
        mentionable?: boolean;
        permissions?: string | number;
        reason?: string;
      }>(args);
      const body: Record<string, unknown> = {};
      if (data.name !== undefined) body.name = data.name;
      if (data.colorHex !== undefined) body.color = parseHexColor(data.colorHex);
      if (data.hoist !== undefined) body.hoist = data.hoist;
      if (data.mentionable !== undefined) body.mentionable = data.mentionable;
      if (data.permissions !== undefined) body.permissions = data.permissions;
      return queueDiscordRestWrite({
        ctx,
        actionLabel: 'edit_role',
        request: {
          method: 'PATCH',
          path: `/guilds/${requireGuildContext(ctx.guildId)}/roles/${data.roleId}`,
          body,
          reason: data.reason,
        },
      });
    }
    case 'delete_role': {
      const data = asAction<{ roleId: string; reason?: string }>(args);
      return queueDiscordRestWrite({
        ctx,
        actionLabel: 'delete_role',
        request: {
          method: 'DELETE',
          path: `/guilds/${requireGuildContext(ctx.guildId)}/roles/${data.roleId}`,
          reason: data.reason,
        },
      });
    }
    case 'add_member_role':
    case 'remove_member_role': {
      const data = asAction<{ userId: string; roleId: string; reason?: string }>(args);
      return queueDiscordRestWrite({
        ctx,
        actionLabel: args.action,
        request: {
          method: args.action === 'add_member_role' ? 'PUT' : 'DELETE',
          path: `/guilds/${requireGuildContext(ctx.guildId)}/members/${data.userId}/roles/${data.roleId}`,
          reason: data.reason,
        },
      });
    }
    case 'get_server_key_status': {
      assertAdmin(ctx.invokerIsAdmin);
      const status = await getGuildApiKeyStatus(requireGuildContext(ctx.guildId));
      return {
        ok: true,
        action: 'get_server_key_status',
        guildId: requireGuildContext(ctx.guildId),
        status,
      };
    }
    case 'get_governance_review_status': {
      assertAdmin(ctx.invokerIsAdmin);
      const guildId = requireGuildContext(ctx.guildId);
      const reviewChannelId = await getGuildApprovalReviewChannelId(guildId);
      return {
        ok: true,
        action: 'get_governance_review_status',
        guildId,
        approvalReviewChannelId: reviewChannelId,
        effectiveReviewChannelId: reviewChannelId ?? ctx.channelId,
        routingMode: reviewChannelId === null ? 'source_channel' : 'dedicated_review_channel',
      };
    }
    case 'clear_server_api_key': {
      assertAdmin(ctx.invokerIsAdmin);
      assertNotAutopilot(ctx.invokedBy, 'clear_server_api_key');
      await clearGuildApiKey(requireGuildContext(ctx.guildId));
      return {
        ok: true,
        action: 'clear_server_api_key',
        guildId: requireGuildContext(ctx.guildId),
        message: 'Server-wide API key removed.',
      };
    }
    case 'set_governance_review_channel': {
      assertAdmin(ctx.invokerIsAdmin);
      assertNotAutopilot(ctx.invokedBy, 'set_governance_review_channel');
      const data = asAction<{ channelId: string }>(args);
      const guildId = requireGuildContext(ctx.guildId);
      const channel = await client.channels.fetch(data.channelId);
      if (!channel || channel.isDMBased() || !('guildId' in channel) || channel.guildId !== guildId) {
        throw new Error('Review channel must be a guild channel in the active server.');
      }
      if (typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
        throw new Error('Review channel must support text messages.');
      }
      await setGuildApprovalReviewChannelId(guildId, data.channelId);
      return {
        ok: true,
        action: 'set_governance_review_channel',
        guildId,
        approvalReviewChannelId: data.channelId,
        message: 'Governance reviews will now land in the selected review channel.',
      };
    }
    case 'clear_governance_review_channel': {
      assertAdmin(ctx.invokerIsAdmin);
      assertNotAutopilot(ctx.invokedBy, 'clear_governance_review_channel');
      const guildId = requireGuildContext(ctx.guildId);
      await setGuildApprovalReviewChannelId(guildId, null);
      return {
        ok: true,
        action: 'clear_governance_review_channel',
        guildId,
        message: 'Governance reviews will now render in the source channel by default.',
      };
    }
    case 'send_key_setup_card': {
      assertAdmin(ctx.invokerIsAdmin);
      assertNotAutopilot(ctx.invokedBy, 'send_key_setup_card');
      const result = await discordRestRequestGuildScoped({
        guildId: requireGuildContext(ctx.guildId),
        method: 'POST',
        path: `/channels/${ctx.channelId}/messages`,
        body: {
          content: buildGuildApiKeySetupCardContent(),
          components: buildGuildApiKeyWelcomeActions().map((row) => row.toJSON()),
          allowed_mentions: { parse: [] },
        },
        signal: ctx.signal,
      });
      return {
        ok: result.ok === true,
        action: 'send_key_setup_card',
        guildId: requireGuildContext(ctx.guildId),
        channelId: ctx.channelId,
        data: result.data,
      };
    }
    case 'get_invite_url': {
      const data = asAction<{
        permissions?: string | number;
        scopes?: string[];
        guildId?: string;
        disableGuildSelect?: boolean;
      }>(args);
      const clientId = config.DISCORD_APP_ID.trim();
      if (!clientId) {
        throw new Error('DISCORD_APP_ID is required to generate an OAuth2 invite URL.');
      }
      const scopes = data.scopes?.length ? data.scopes : ['bot'];
      const permissions = normalizeDiscordPermissions(data.permissions);
      return {
        ok: true,
        action: 'get_invite_url',
        clientId,
        scopes,
        permissions: scopes.includes('bot') ? permissions : undefined,
        url: buildDiscordBotInviteUrl({
          clientId,
          permissions,
          scopes,
          guildId: data.guildId?.trim() || undefined,
          disableGuildSelect: data.disableGuildSelect,
        }),
      };
    }
    case 'api': {
      const data = asAction<{
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        path: string;
        query?: Record<string, string | number | boolean | null>;
        body?: unknown;
        multipartBodyMode?: 'payload_json' | 'fields';
        files?: DiscordRestFileInput[];
        reason?: string;
        maxResponseChars?: number;
      }>(args);
      assertNotAutopilot(ctx.invokedBy, 'api');
      requireGuildContext(ctx.guildId);
      assertAdmin(ctx.invokerIsAdmin);

      if (data.method === 'GET') {
        if (data.files?.length) {
          throw new Error('api GET requests cannot include files.');
        }
        return discordRestRequestGuildScoped({
          guildId: ctx.guildId!,
          method: data.method,
          path: data.path,
          query: data.query,
          maxResponseChars: data.maxResponseChars,
          reason: data.reason,
          signal: ctx.signal,
        });
      }

      return requestDiscordRestWriteForTool({
        guildId: ctx.guildId!,
        channelId: ctx.channelId,
        requestedBy: ctx.userId,
        request: {
          method: data.method,
          path: data.path,
          query: data.query,
          body: data.body,
          multipartBodyMode: data.multipartBodyMode,
          files: data.files,
          reason: data.reason,
          maxResponseChars: data.maxResponseChars,
        },
      });
    }
    default:
      throw new Error(`Unsupported discord_admin action: ${args.action}`);
  }
}

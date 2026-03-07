import { z } from 'zod';

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
import { config } from '../../../platform/config/env';

export const discordThinkField = z
  .string()
  .describe(
    'Optional internal reasoning explaining why you are generating this payload and how it fulfills the active goal.',
  )
  .optional();

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
export const discordOauthScopeSchema = z.enum(['bot', 'applications.commands']);
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

function asAction<T>(args: DiscordActionArgs): T {
  return args as unknown as T;
}

function requireGuildContext(guildId?: string | null): string {
  if (!guildId) {
    throw new Error('This Discord action requires a guild context.');
  }
  return guildId;
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
      const scopes = data.scopes?.length ? data.scopes : ['bot', 'applications.commands'];
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

import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from './toolRegistry';
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
  searchAttachmentChunksInChannel,
  searchAttachmentChunksInGuild,
  lookupSocialGraph,
  lookupTopSocialGraphEdges,
  lookupVoiceAnalytics,
  lookupVoiceSessionSummaries,
  lookupUserMessageTimeline,
} from './toolIntegrations';
import {
  discordModerationActionRequestSchema,
  requestDiscordAdminActionForTool,
  requestDiscordInteractionForTool,
  lookupServerMemoryForTool,
  requestServerMemoryUpdateForTool,
  serverMemoryUpdateRequestSchema,
  requestDiscordRestWriteForTool,
  type DiscordRestWriteRequest,
} from '../../bot/admin/adminActionService';
import { discordRestRequestGuildScoped } from '../discord/discordRestPolicy';
import { config } from '../../config';
import {
  DISCORD_ACTION_CATALOG,
  DISCORD_GUARDRAILS,
  getAllDiscordActions,
} from './discordToolCatalog';

const requiredThinkField = z
  .string()
  .describe(
    'Optional internal reasoning explaining why you are generating this payload and how it fulfills the active goal.',
  )
  .optional();

const discordFileSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('url'),
    url: z.string().trim().url().max(2_048),
  }),
  z.object({
    type: z.literal('text'),
    text: z.string().max(20_000),
  }),
  z.object({
    type: z.literal('base64'),
    base64: z.string().max(50_000),
  }),
]);

const discordMessageFileInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200).optional(),
  source: discordFileSourceSchema,
});

const discordRestFileInputSchema = z.object({
  fieldName: z.string().trim().min(1).max(120).optional(),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200).optional(),
  source: discordFileSourceSchema,
});

const discordToolSchema = z.discriminatedUnion('action', [
  z.object({
    think: requiredThinkField,
    action: z.literal('help').describe('Get a list of all available Discord actions and their required access levels.'),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.get_user').describe('Fetch the comprehensive memory profile for a specific user.'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxChars: z.number().int().min(200).max(8_000).optional(),
    maxItemsPerSection: z.number().int().min(1).max(10).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.get_channel').describe('Fetch the memory profile for a specific channel.'),
    maxChars: z.number().int().min(200).max(12_000).optional(),
    maxItemsPerList: z.number().int().min(1).max(12).optional(),
    maxRecentFiles: z.number().int().min(1).max(20).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.channel_archives').describe('Search through long-term channel archives via text query.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.get_server').describe('Fetch the overall memory profile for the current server.'),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.update_server').describe('Submit an admin request to update the core server configuration/memory.'),
    request: serverMemoryUpdateRequestSchema,
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.list_channel').describe('List recently cached files in a specific channel.'),
    query: z.string().trim().min(1).max(200).optional(),
    messageId: z.string().trim().min(1).max(64).optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    includeContent: z.boolean().optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.list_server').describe('List recently cached files across the entire server.'),
    query: z.string().trim().min(1).max(200).optional(),
    messageId: z.string().trim().min(1).max(64).optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    includeContent: z.boolean().optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.find_channel').describe('Search for specific file content or attachments within a channel using a text query.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.find_server').describe('Search for specific file content or attachments across the entire server using a text query.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.read_attachment').describe('Read cached attachment text content in pages (no streaming; use continuation fields).'),
    attachmentId: z.string().trim().min(1).max(64),
    startChar: z.number().int().min(0).max(50_000_000).optional(),
    maxChars: z.number().int().min(200).max(20_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.search_history').describe('Search via hybrid, semantic, lexical, or regex patterns through channel message history.'),
    channelId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('Optional target channelId. Defaults to the current channel.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
    mode: z.enum(['hybrid', 'semantic', 'lexical', 'regex']).optional(),
    regexPattern: z.string().trim().min(1).max(500).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
  }).superRefine((value, ctx) => {
    const hasSinceIso = value.sinceIso !== undefined;
    const hasSinceHours = value.sinceHours !== undefined;
    const hasSinceDays = value.sinceDays !== undefined;
    const sinceVariants = [hasSinceIso, hasSinceHours, hasSinceDays].filter(Boolean).length;
    if (sinceVariants > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at most one of sinceIso, sinceHours, or sinceDays.',
        path: ['sinceIso'],
      });
    }
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.search_with_context').describe('Search channel history and immediately expand context around the best match.'),
    channelId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('Optional target channelId. Defaults to the current channel.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
    mode: z.enum(['hybrid', 'semantic', 'lexical', 'regex']).optional(),
    regexPattern: z.string().trim().min(1).max(500).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
    before: z.number().int().min(0).max(20).optional(),
    after: z.number().int().min(0).max(20).optional(),
    contextMaxChars: z.number().int().min(300).max(12_000).optional(),
  }).superRefine((value, ctx) => {
    const hasSinceIso = value.sinceIso !== undefined;
    const hasSinceHours = value.sinceHours !== undefined;
    const hasSinceDays = value.sinceDays !== undefined;
    const sinceVariants = [hasSinceIso, hasSinceHours, hasSinceDays].filter(Boolean).length;
    if (sinceVariants > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at most one of sinceIso, sinceHours, or sinceDays.',
        path: ['sinceIso'],
      });
    }
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.get_context').describe('Retrieve specific messages before and after a given message ID.'),
    channelId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('Optional target channelId. Defaults to the current channel.'),
    messageId: z.string().trim().min(1).max(64),
    before: z.number().int().min(0).max(20).optional(),
    after: z.number().int().min(0).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.search_guild').describe('Search raw message history across the entire server (results are permission-filtered).'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
    mode: z.enum(['hybrid', 'semantic', 'lexical', 'regex']).optional(),
    regexPattern: z.string().trim().min(1).max(500).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
  }).superRefine((value, ctx) => {
    const hasSinceIso = value.sinceIso !== undefined;
    const hasSinceHours = value.sinceHours !== undefined;
    const hasSinceDays = value.sinceDays !== undefined;
    const sinceVariants = [hasSinceIso, hasSinceHours, hasSinceDays].filter(Boolean).length;
    if (sinceVariants > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at most one of sinceIso, sinceHours, or sinceDays.',
        path: ['sinceIso'],
      });
    }
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.user_timeline').describe('Show recent messages from a user across the server (results are permission-filtered).'),
    userId: z.string().trim().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    maxChars: z.number().int().min(200).max(6_000).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
  }).superRefine((value, ctx) => {
    const hasSinceIso = value.sinceIso !== undefined;
    const hasSinceHours = value.sinceHours !== undefined;
    const hasSinceDays = value.sinceDays !== undefined;
    const sinceVariants = [hasSinceIso, hasSinceHours, hasSinceDays].filter(Boolean).length;
    if (sinceVariants > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at most one of sinceIso, sinceHours, or sinceDays.',
        path: ['sinceIso'],
      });
    }
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('analytics.get_social_graph').describe('Retrieve the social graph relationships for a specific user.'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxEdges: z.number().int().min(1).max(30).optional(),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('analytics.top_relationships').describe('Show the top interaction pairs in this server (who hangs out with whom).'),
    limit: z.number().int().min(1).max(30).optional(),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('analytics.get_voice_analytics').describe('Retrieve voice connection and usage analytics.'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('analytics.voice_summaries').describe('Retrieve summary transcripts for recent voice sessions.'),
    voiceChannelId: z.string().trim().min(1).max(64).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.send').describe('Send a new message with text or files to a channel.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    content: z.string().trim().min(1).max(8_000).optional(),
    files: z.array(discordMessageFileInputSchema).min(1).max(4).optional(),
    reason: z.string().trim().max(500).optional(),
  }).superRefine((value, ctx) => {
    const hasContent = value.content !== undefined;
    const hasFiles = Boolean(value.files?.length);
    if (!hasContent && !hasFiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'messages.send requires content or files.',
      });
    }
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.edit').describe('Edit the content of an existing message.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    content: z.string().trim().min(1).max(2_000),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.delete').describe('Delete an existing message.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.pin').describe('Pin a message to the channel.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.unpin').describe('Unpin a message from the channel.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('channels.create').describe('Create a new Discord channel or category.'),
    name: z.string().trim().min(1).max(100),
    type: z.enum(['text', 'voice', 'category']).optional(),
    parentId: z.string().trim().min(1).max(64).optional(),
    topic: z.string().trim().max(1_024).optional(),
    nsfw: z.boolean().optional(),
    rateLimitPerUser: z.number().int().min(0).max(21_600).optional(),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('channels.edit').describe('Edit the settings of an existing channel.'),
    channelId: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(100).optional(),
    parentId: z.string().trim().min(1).max(64).optional(),
    topic: z.string().trim().max(1_024).optional(),
    nsfw: z.boolean().optional(),
    rateLimitPerUser: z.number().int().min(0).max(21_600).optional(),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('roles.create').describe('Create a new server role.'),
    name: z.string().trim().min(1).max(100),
    colorHex: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    permissions: z.string().trim().regex(/^\d+$/).optional(),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('roles.edit').describe('Edit the settings of an existing role.'),
    roleId: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(100).optional(),
    colorHex: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    permissions: z.string().trim().regex(/^\d+$/).optional(),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('roles.delete').describe('Delete a server role.'),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('members.add_role').describe('Give a user a specific role.'),
    userId: z.string().trim().min(1).max(64),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('members.remove_role').describe('Remove a role from a user.'),
    userId: z.string().trim().min(1).max(64),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('oauth2.invite_url').describe('Generate a bot invite URL dynamically.'),
    permissions: z.union([z.string().trim().regex(/^\d+$/), z.number().int().min(0)]).optional(),
    scopes: z.array(z.enum(['bot', 'applications.commands'])).min(1).max(4).optional(),
    guildId: z.string().trim().min(1).max(64).optional(),
    disableGuildSelect: z.boolean().optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('polls.create').describe('Create a new poll in a channel.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    question: z.string().trim().min(1).max(300),
    answers: z.array(z.string().trim().min(1).max(55)).min(2).max(10),
    durationHours: z.number().int().min(1).max(768).optional(),
    allowMultiselect: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('threads.create').describe('Start a new thread off a message.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(100),
    messageId: z.string().trim().min(1).max(64).optional(),
    autoArchiveDurationMinutes: z.union([
      z.literal(60),
      z.literal(1_440),
      z.literal(4_320),
      z.literal(10_080),
    ]).optional(),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('reactions.add').describe('Add an emoji reaction to a message.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    emoji: z.string().trim().min(1).max(128),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('reactions.remove_self').describe('Remove your own emoji reaction from a message.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    emoji: z.string().trim().min(1).max(128),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('moderation.submit').describe('Submit a moderation action (kick/ban/timeout) for admin approval.'),
    request: discordModerationActionRequestSchema,
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('discord.api').describe('Execute raw REST API calls against the Discord API.'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().trim().min(1).max(2_000),
    query: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional(),
    body: z.unknown().optional(),
    multipartBodyMode: z.enum(['payload_json', 'fields']).optional(),
    files: z
      .array(
        discordRestFileInputSchema,
      )
      .min(1)
      .max(10)
      .optional(),
    reason: z.string().trim().max(500).optional(),
    maxResponseChars: z.number().int().min(500).max(50_000).optional(),
  }),
]);

/**
 * Represents the DiscordToolArgs type.
 */
export type DiscordToolArgs = z.infer<typeof discordToolSchema>;

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

function isReadOnlyDiscordToolCall(args: unknown): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const action = (args as Record<string, unknown>).action;
  if (typeof action !== 'string') return false;

  switch (action) {
    case 'help':
    case 'memory.get_user':
    case 'memory.get_channel':
    case 'memory.channel_archives':
    case 'memory.get_server':
    case 'files.list_channel':
    case 'files.list_server':
    case 'files.find_channel':
    case 'files.find_server':
    case 'files.read_attachment':
    case 'messages.search_history':
    case 'messages.search_with_context':
    case 'messages.get_context':
    case 'messages.search_guild':
    case 'messages.user_timeline':
    case 'analytics.get_social_graph':
    case 'analytics.top_relationships':
    case 'analytics.get_voice_analytics':
    case 'analytics.voice_summaries':
    case 'oauth2.invite_url':
      return true;
    case 'discord.api': {
      const method = (args as Record<string, unknown>).method;
      return typeof method === 'string' && method.toUpperCase() === 'GET';
    }
    default:
      return false;
  }
}

/**
 * Declares exported bindings: discordTool.
 */
export const discordTool: ToolDefinition<DiscordToolArgs> = {
  name: 'discord',
  description:
    [
      'Unified Discord tool for Sage: memory, retrieval, safe interactions, moderation queue, and admin-only API passthrough.',
      '<USE_ONLY_WHEN> You need to read or change Discord state, or query Sage’s Discord-backed memory (summaries/files/messages/social graph/voice analytics). </USE_ONLY_WHEN>',
      'Safety: See <execution_rules> for full guardrails. If unsure which action or fields to use, call discord action help.',
    ].join('\n'),
  schema: discordToolSchema,
  metadata: {
    readOnlyPredicate: (args) => isReadOnlyDiscordToolCall(args),
  },
  execute: async (args, ctx) => {
    switch (args.action) {
      case 'help': {
        const actions = getAllDiscordActions();
        return {
          tool: 'discord',
          actions,
          read_only_actions: [...DISCORD_ACTION_CATALOG.read_only],
          write_actions: [...DISCORD_ACTION_CATALOG.writes],
          admin_only_actions: [...DISCORD_ACTION_CATALOG.admin_only],
          guardrails: [...DISCORD_GUARDRAILS],
          notes: [
            'Some actions require a guild context.',
            'Time-windowed message search: use sinceHours/sinceDays (relative) or sinceIso/untilIso (absolute) on messages.search_* actions.',
            'Server-wide file actions and API calls are disabled in autopilot turns.',
            'API passthrough is guild-scoped (active guild only).',
            'Non-GET API requests require admin approval.',
            'Direct /webhooks/* routes and bot-wide endpoints (for example /users/@me) are blocked.',
            'API results redact sensitive fields (tokens/secrets).',
            'The think field is optional; omit it to reduce tool-call verbosity.',
          ],
        };
      }

      case 'memory.get_user': {
        return lookupUserMemory({
          userId: args.userId?.trim() || ctx.userId,
          maxChars: args.maxChars,
          maxItemsPerSection: args.maxItemsPerSection,
        });
      }

      case 'memory.get_channel': {
        return lookupChannelMemory({
          guildId: ctx.guildId ?? null,
          channelId: ctx.channelId,
          maxChars: args.maxChars,
          maxItemsPerList: args.maxItemsPerList,
          maxRecentFiles: args.maxRecentFiles,
        });
      }

      case 'memory.channel_archives': {
        return searchChannelArchives({
          guildId: ctx.guildId ?? null,
          channelId: ctx.channelId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
        });
      }

      case 'memory.get_server': {
        const guildId = requireGuildContext(ctx.guildId);
        return lookupServerMemoryForTool({
          guildId,
          maxChars: args.maxChars,
        });
      }

      case 'memory.update_server': {
        assertAdmin(ctx.invokerIsAdmin);
        assertNotAutopilot(ctx.invokedBy, 'memory.update_server');
        const guildId = requireGuildContext(ctx.guildId);
        return requestServerMemoryUpdateForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          request: args.request,
        });
      }

      case 'files.list_channel': {
        return lookupChannelFileCache({
          guildId: ctx.guildId ?? null,
          channelId: ctx.channelId,
          query: args.query,
          messageId: args.messageId,
          filename: args.filename,
          limit: args.limit,
          includeContent: args.includeContent,
          maxChars: args.maxChars,
        });
      }

      case 'files.list_server': {
        assertNotAutopilot(ctx.invokedBy, 'files.list_server');
        return lookupServerFileCache({
          guildId: ctx.guildId ?? null,
          requesterUserId: ctx.userId,
          query: args.query,
          messageId: args.messageId,
          filename: args.filename,
          limit: args.limit,
          includeContent: args.includeContent,
          maxChars: args.maxChars,
        });
      }

      case 'files.find_channel': {
        return searchAttachmentChunksInChannel({
          guildId: ctx.guildId ?? null,
          channelId: ctx.channelId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
        });
      }

      case 'files.find_server': {
        assertNotAutopilot(ctx.invokedBy, 'files.find_server');
        return searchAttachmentChunksInGuild({
          guildId: ctx.guildId ?? null,
          requesterUserId: ctx.userId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
        });
      }

      case 'files.read_attachment': {
        assertNotAutopilot(ctx.invokedBy, 'files.read_attachment');
        return readIngestedAttachmentText({
          guildId: ctx.guildId ?? null,
          requesterUserId: ctx.userId,
          attachmentId: args.attachmentId,
          startChar: args.startChar,
          maxChars: args.maxChars,
        });
      }

      case 'messages.search_history': {
        const targetChannelId = (args.channelId?.trim() || ctx.channelId).trim();
        if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
          throw new Error('Cross-channel message history search is disabled in autopilot turns.');
        }
        const sinceIso = deriveSinceIso({
          sinceIso: args.sinceIso,
          sinceHours: args.sinceHours,
          sinceDays: args.sinceDays,
        });
        return searchChannelMessages({
          guildId: ctx.guildId ?? null,
          channelId: targetChannelId,
          requesterUserId: ctx.userId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
          mode: args.mode,
          regexPattern: args.regexPattern,
          sinceIso,
          untilIso: args.untilIso,
        });
      }

      case 'messages.search_with_context': {
        const targetChannelId = (args.channelId?.trim() || ctx.channelId).trim();
        if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
          throw new Error('Cross-channel message history search is disabled in autopilot turns.');
        }
        const sinceIso = deriveSinceIso({
          sinceIso: args.sinceIso,
          sinceHours: args.sinceHours,
          sinceDays: args.sinceDays,
        });
        const search = await searchChannelMessages({
          guildId: ctx.guildId ?? null,
          channelId: targetChannelId,
          requesterUserId: ctx.userId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
          mode: args.mode,
          regexPattern: args.regexPattern,
          sinceIso,
          untilIso: args.untilIso,
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
          before: args.before ?? 5,
          after: args.after ?? 5,
          maxChars: args.contextMaxChars ?? args.maxChars,
        });

        return {
          found: true,
          action: 'messages.search_with_context',
          channelId: targetChannelId,
          query: args.query,
          search,
          context,
        };
      }

      case 'messages.get_context': {
        const targetChannelId = (args.channelId?.trim() || ctx.channelId).trim();
        if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
          throw new Error('Cross-channel message history lookup is disabled in autopilot turns.');
        }
        return lookupChannelMessage({
          guildId: ctx.guildId ?? null,
          channelId: targetChannelId,
          requesterUserId: ctx.userId,
          messageId: args.messageId,
          before: args.before,
          after: args.after,
          maxChars: args.maxChars,
        });
      }

      case 'messages.search_guild': {
        assertNotAutopilot(ctx.invokedBy, 'messages.search_guild');
        const sinceIso = deriveSinceIso({
          sinceIso: args.sinceIso,
          sinceHours: args.sinceHours,
          sinceDays: args.sinceDays,
        });
        return searchGuildMessages({
          guildId: ctx.guildId ?? null,
          requesterUserId: ctx.userId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
          mode: args.mode,
          regexPattern: args.regexPattern,
          sinceIso,
          untilIso: args.untilIso,
        });
      }

      case 'messages.user_timeline': {
        assertNotAutopilot(ctx.invokedBy, 'messages.user_timeline');
        const userId = args.userId?.trim() || ctx.userId;
        const sinceIso = deriveSinceIso({
          sinceIso: args.sinceIso,
          sinceHours: args.sinceHours,
          sinceDays: args.sinceDays,
        });
        return lookupUserMessageTimeline({
          guildId: ctx.guildId ?? null,
          requesterUserId: ctx.userId,
          userId,
          limit: args.limit,
          maxChars: args.maxChars,
          sinceIso,
          untilIso: args.untilIso,
        });
      }

      case 'analytics.get_social_graph': {
        return lookupSocialGraph({
          guildId: ctx.guildId ?? null,
          userId: args.userId?.trim() || ctx.userId,
          maxEdges: args.maxEdges,
          maxChars: args.maxChars,
        });
      }

      case 'analytics.top_relationships': {
        assertNotAutopilot(ctx.invokedBy, 'analytics.top_relationships');
        return lookupTopSocialGraphEdges({
          guildId: ctx.guildId ?? null,
          limit: args.limit,
          maxChars: args.maxChars,
        });
      }

      case 'analytics.get_voice_analytics': {
        return lookupVoiceAnalytics({
          guildId: ctx.guildId ?? null,
          userId: args.userId?.trim() || ctx.userId,
          maxChars: args.maxChars,
        });
      }

      case 'analytics.voice_summaries': {
        return lookupVoiceSessionSummaries({
          guildId: ctx.guildId ?? null,
          voiceChannelId: args.voiceChannelId?.trim() || undefined,
          sinceHours: args.sinceHours,
          limit: args.limit,
          maxChars: args.maxChars,
        });
      }

      case 'messages.send': {
        assertNotAutopilot(ctx.invokedBy, 'messages.send');
        const guildId = requireGuildContext(ctx.guildId);
        const channelId = args.channelId?.trim() || ctx.channelId;
        return requestDiscordInteractionForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          invokedBy: ctx.invokedBy,
          request: {
            action: 'send_message',
            channelId,
            content: args.content,
            files: args.files,
            reason: args.reason,
          },
        });
      }

      case 'messages.edit': {
        const targetChannelId = (args.channelId?.trim() || ctx.channelId).trim();
        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'messages.edit',
          request: {
            method: 'PATCH',
            path: `/channels/${targetChannelId}/messages/${args.messageId}`,
            body: {
              content: args.content,
              allowed_mentions: { parse: [] },
            },
            reason: args.reason,
          },
        });
      }

      case 'messages.delete': {
        const targetChannelId = (args.channelId?.trim() || ctx.channelId).trim();
        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'messages.delete',
          request: {
            method: 'DELETE',
            path: `/channels/${targetChannelId}/messages/${args.messageId}`,
            reason: args.reason,
          },
        });
      }

      case 'messages.pin': {
        const targetChannelId = (args.channelId?.trim() || ctx.channelId).trim();
        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'messages.pin',
          request: {
            method: 'PUT',
            path: `/channels/${targetChannelId}/pins/${args.messageId}`,
            reason: args.reason,
          },
        });
      }

      case 'messages.unpin': {
        const targetChannelId = (args.channelId?.trim() || ctx.channelId).trim();
        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'messages.unpin',
          request: {
            method: 'DELETE',
            path: `/channels/${targetChannelId}/pins/${args.messageId}`,
            reason: args.reason,
          },
        });
      }

      case 'channels.create': {
        const type = args.type ?? 'text';
        const typeId = type === 'voice' ? 2 : type === 'category' ? 4 : 0;
        const body: Record<string, unknown> = {
          name: args.name,
          type: typeId,
        };
        if (args.parentId) {
          body.parent_id = args.parentId;
        }
        if (args.nsfw !== undefined) {
          body.nsfw = args.nsfw;
        }
        if (type === 'text') {
          if (args.topic !== undefined) {
            body.topic = args.topic;
          }
          if (args.rateLimitPerUser !== undefined) {
            body.rate_limit_per_user = args.rateLimitPerUser;
          }
        }

        const guildId = requireGuildContext(ctx.guildId);
        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'channels.create',
          request: {
            method: 'POST',
            path: `/guilds/${guildId}/channels`,
            body,
            reason: args.reason,
          },
        });
      }

      case 'channels.edit': {
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) {
          body.name = args.name;
        }
        if (args.parentId !== undefined) {
          body.parent_id = args.parentId;
        }
        if (args.topic !== undefined) {
          body.topic = args.topic;
        }
        if (args.nsfw !== undefined) {
          body.nsfw = args.nsfw;
        }
        if (args.rateLimitPerUser !== undefined) {
          body.rate_limit_per_user = args.rateLimitPerUser;
        }

        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'channels.edit',
          request: {
            method: 'PATCH',
            path: `/channels/${args.channelId}`,
            body,
            reason: args.reason,
          },
        });
      }

      case 'roles.create': {
        const guildId = requireGuildContext(ctx.guildId);
        const body: Record<string, unknown> = { name: args.name };
        if (args.colorHex) {
          body.color = parseHexColor(args.colorHex);
        }
        if (args.hoist !== undefined) {
          body.hoist = args.hoist;
        }
        if (args.mentionable !== undefined) {
          body.mentionable = args.mentionable;
        }
        if (args.permissions) {
          body.permissions = args.permissions;
        }

        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'roles.create',
          request: {
            method: 'POST',
            path: `/guilds/${guildId}/roles`,
            body,
            reason: args.reason,
          },
        });
      }

      case 'roles.edit': {
        const guildId = requireGuildContext(ctx.guildId);
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) {
          body.name = args.name;
        }
        if (args.colorHex !== undefined) {
          body.color = parseHexColor(args.colorHex);
        }
        if (args.hoist !== undefined) {
          body.hoist = args.hoist;
        }
        if (args.mentionable !== undefined) {
          body.mentionable = args.mentionable;
        }
        if (args.permissions !== undefined) {
          body.permissions = args.permissions;
        }

        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'roles.edit',
          request: {
            method: 'PATCH',
            path: `/guilds/${guildId}/roles/${args.roleId}`,
            body,
            reason: args.reason,
          },
        });
      }

      case 'roles.delete': {
        const guildId = requireGuildContext(ctx.guildId);
        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'roles.delete',
          request: {
            method: 'DELETE',
            path: `/guilds/${guildId}/roles/${args.roleId}`,
            reason: args.reason,
          },
        });
      }

      case 'members.add_role': {
        const guildId = requireGuildContext(ctx.guildId);
        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'members.add_role',
          request: {
            method: 'PUT',
            path: `/guilds/${guildId}/members/${args.userId}/roles/${args.roleId}`,
            reason: args.reason,
          },
        });
      }

      case 'members.remove_role': {
        const guildId = requireGuildContext(ctx.guildId);
        return queueDiscordRestWrite({
          ctx,
          actionLabel: 'members.remove_role',
          request: {
            method: 'DELETE',
            path: `/guilds/${guildId}/members/${args.userId}/roles/${args.roleId}`,
            reason: args.reason,
          },
        });
      }

      case 'oauth2.invite_url': {
        const clientId = config.DISCORD_APP_ID.trim();
        if (!clientId) {
          throw new Error('DISCORD_APP_ID is required to generate an OAuth2 invite URL.');
        }
        const permissions = normalizeDiscordPermissions(args.permissions);
        const scopes = args.scopes?.length ? args.scopes : ['bot', 'applications.commands'];
        const url = buildDiscordBotInviteUrl({
          clientId,
          permissions,
          scopes,
          guildId: args.guildId?.trim() || undefined,
          disableGuildSelect: args.disableGuildSelect,
        });
        return {
          ok: true,
          action: 'oauth2.invite_url',
          clientId,
          scopes,
          permissions: scopes.includes('bot') ? permissions : undefined,
          url,
        };
      }

      case 'polls.create': {
        assertNotAutopilot(ctx.invokedBy, 'polls.create');
        const guildId = requireGuildContext(ctx.guildId);
        return requestDiscordInteractionForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          invokedBy: ctx.invokedBy,
          request: {
            action: 'create_poll',
            question: args.question,
            answers: args.answers,
            durationHours: args.durationHours ?? 24,
            allowMultiselect: args.allowMultiselect,
            channelId: args.channelId?.trim() || undefined,
            reason: args.reason,
          },
        });
      }

      case 'threads.create': {
        assertNotAutopilot(ctx.invokedBy, 'threads.create');
        const guildId = requireGuildContext(ctx.guildId);
        return requestDiscordInteractionForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          invokedBy: ctx.invokedBy,
          request: {
            action: 'create_thread',
            name: args.name,
            messageId: args.messageId,
            channelId: args.channelId?.trim() || undefined,
            autoArchiveDurationMinutes: args.autoArchiveDurationMinutes,
            reason: args.reason,
          },
        });
      }

      case 'reactions.add': {
        assertNotAutopilot(ctx.invokedBy, 'reactions.add');
        const guildId = requireGuildContext(ctx.guildId);
        return requestDiscordInteractionForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          invokedBy: ctx.invokedBy,
          request: {
            action: 'add_reaction',
            messageId: args.messageId,
            channelId: args.channelId?.trim() || undefined,
            emoji: args.emoji,
            reason: args.reason,
          },
        });
      }

      case 'reactions.remove_self': {
        assertNotAutopilot(ctx.invokedBy, 'reactions.remove_self');
        const guildId = requireGuildContext(ctx.guildId);
        return requestDiscordInteractionForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          invokedBy: ctx.invokedBy,
          request: {
            action: 'remove_bot_reaction',
            messageId: args.messageId,
            channelId: args.channelId?.trim() || undefined,
            emoji: args.emoji,
            reason: args.reason,
          },
        });
      }

      case 'moderation.submit': {
        assertAdmin(ctx.invokerIsAdmin);
        assertNotAutopilot(ctx.invokedBy, 'moderation.submit');
        const guildId = requireGuildContext(ctx.guildId);
        return requestDiscordAdminActionForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          request: args.request,
        });
      }

      case 'discord.api': {
        assertAdmin(ctx.invokerIsAdmin);
        assertNotAutopilot(ctx.invokedBy, 'discord.api');
        requireGuildContext(ctx.guildId);

        if (args.method === 'GET') {
          if (args.files?.length) {
            throw new Error('discord.api GET requests cannot include files.');
          }
          return discordRestRequestGuildScoped({
            guildId: ctx.guildId!,
            method: args.method,
            path: args.path,
            query: args.query,
            maxResponseChars: args.maxResponseChars,
            reason: args.reason,
            signal: ctx.signal,
          });
        }

        return requestDiscordRestWriteForTool({
          guildId: ctx.guildId!,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          request: {
            method: args.method,
            path: args.path,
            query: args.query,
            body: args.body,
            multipartBodyMode: args.multipartBodyMode,
            files: args.files,
            reason: args.reason,
            maxResponseChars: args.maxResponseChars,
          },
        });
      }
    }
  },
};

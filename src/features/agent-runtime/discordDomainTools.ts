import { z } from 'zod';

import {
  discordModerationActionRequestSchema,
  serverInstructionsUpdateRequestSchema,
} from '../../features/admin/adminActionService';
import {
  discordComponentsV2MessageSchema,
  discordMessageFileInputSchema,
  discordMessagePresentationSchema,
  validateDiscordSendMessagePayload,
} from '../discord/messageContract';
import {
  addSinceVariantValidation,
  discordEmojiSchema,
  discordOauthScopeSchema,
  discordPollAnswerSchema,
  discordPollDurationHoursSchema,
  discordRestFileInputSchema,
  discordRestPathSchema,
  discordThinkField,
  discordThreadAutoArchiveDurationSchema,
  executeDiscordAdminAction,
  executeDiscordContextAction,
  executeDiscordFilesAction,
  executeDiscordMessagesAction,
} from './discord/core';
import type { ToolDefinition } from './toolRegistry';
import {
  DISCORD_GUARDRAILS,
  DISCORD_TOOL_ACTION_CATALOG,
  getDiscordActionCatalogForTool,
} from './discordToolCatalog';
import { buildRoutedToolHelp } from './toolDocs';

const helpActionSchema = z.object({
  think: discordThinkField,
  action: z.literal('help').describe('Show action contracts and examples for this routed Discord tool.'),
  includeExamples: z.boolean().optional(),
});

function buildDiscordHelpPayload(toolName: keyof typeof DISCORD_TOOL_ACTION_CATALOG, includeExamples?: boolean) {
  const catalog = getDiscordActionCatalogForTool(toolName);
  return {
    ...buildRoutedToolHelp(toolName, { includeExamples }),
    read_only_actions: catalog ? [...catalog.read_only] : [],
    write_actions: catalog ? [...catalog.writes] : [],
    admin_only_actions: catalog ? [...catalog.admin_only] : [],
    guardrails: [...DISCORD_GUARDRAILS],
  };
}

function isReadOnlyDiscordDomainCall(
  toolName: keyof typeof DISCORD_TOOL_ACTION_CATALOG,
  args: unknown,
): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const action = (args as Record<string, unknown>).action;
  if (typeof action !== 'string') return false;

  const catalog = getDiscordActionCatalogForTool(toolName);
  if (!catalog) return false;

  if (catalog.read_only.includes(action)) {
    return true;
  }

  if (action === 'api') {
    const method = (args as Record<string, unknown>).method;
    return typeof method === 'string' && method.toUpperCase() === 'GET';
  }

  return false;
}

const profileGetUserSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_user_profile').describe('Fetch the best-effort personalization profile for a user.'),
  userId: z.string().trim().min(1).max(64).optional(),
  maxChars: z.number().int().min(200).max(8_000).optional(),
  maxItemsPerSection: z.number().int().min(1).max(10).optional(),
});

const summaryGetChannelSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_channel_summary').describe('Fetch rolling and long-term summary context for the current channel only.'),
  maxChars: z.number().int().min(200).max(12_000).optional(),
  maxItemsPerList: z.number().int().min(1).max(12).optional(),
  maxRecentFiles: z.number().int().min(1).max(20).optional(),
});

const summarySearchChannelArchivesSchema = z.object({
  think: discordThinkField,
  action: z.literal('search_channel_summary_archives').describe('Search archived summary context for the current channel.'),
  query: z.string().trim().min(2).max(500),
  topK: z.number().int().min(1).max(20).optional(),
  maxChars: z.number().int().min(300).max(12_000).optional(),
});

const instructionsGetServerSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_server_instructions').describe('Fetch the current admin-authored server instructions for this guild.'),
  maxChars: z.number().int().min(200).max(12_000).optional(),
});

const analyticsGetSocialGraphSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_social_graph').describe('Retrieve social graph relationships for a user.'),
  userId: z.string().trim().min(1).max(64).optional(),
  maxEdges: z.number().int().min(1).max(30).optional(),
  maxChars: z.number().int().min(200).max(12_000).optional(),
});

const analyticsTopRelationshipsSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_top_relationships').describe('Show the top interaction pairs in this server.'),
  limit: z.number().int().min(1).max(30).optional(),
  maxChars: z.number().int().min(200).max(12_000).optional(),
});

const analyticsGetVoiceAnalyticsSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_voice_analytics').describe('Retrieve voice participation analytics.'),
  userId: z.string().trim().min(1).max(64).optional(),
  maxChars: z.number().int().min(200).max(12_000).optional(),
});

const analyticsVoiceSummariesSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_voice_summaries').describe('Retrieve recent voice session summaries.'),
  voiceChannelId: z.string().trim().min(1).max(64).optional(),
  sinceHours: z.number().int().min(1).max(2_160).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  maxChars: z.number().int().min(300).max(12_000).optional(),
});

const discordContextToolSchema = z.discriminatedUnion('action', [
  helpActionSchema,
  profileGetUserSchema,
  summaryGetChannelSchema,
  summarySearchChannelArchivesSchema,
  instructionsGetServerSchema,
  analyticsGetSocialGraphSchema,
  analyticsTopRelationshipsSchema,
  analyticsGetVoiceAnalyticsSchema,
  analyticsVoiceSummariesSchema,
]);

export const discordContextTool: ToolDefinition<z.infer<typeof discordContextToolSchema>> = {
  name: 'discord_context',
  description:
    'Discord context tool for profiles, channel summaries, server instructions reads, and social/voice analytics.\n<USE_ONLY_WHEN> You need Discord-native context rather than exact message history, files, or admin writes. </USE_ONLY_WHEN>',
  schema: discordContextToolSchema,
  metadata: {
    readOnlyPredicate: (args) => isReadOnlyDiscordDomainCall('discord_context', args),
  },
  execute: async (args, ctx) => {
    if (args.action === 'help') {
      return buildDiscordHelpPayload('discord_context', args.includeExamples);
    }
    return executeDiscordContextAction(args as Record<string, unknown> & { action: string }, ctx);
  },
};

const messagesSearchHistorySchema = addSinceVariantValidation(
  z.object({
    think: discordThinkField,
    action: z.literal('search_history').describe('Search channel message history. channelId defaults to the current channel.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
    mode: z.enum(['hybrid', 'semantic', 'lexical', 'regex']).optional(),
    regexPattern: z.string().trim().min(1).max(500).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
  }),
);

const messagesSearchWithContextSchema = addSinceVariantValidation(
  z.object({
    think: discordThinkField,
    action: z.literal('search_with_context').describe('Search channel history and expand context around the best match.'),
    channelId: z.string().trim().min(1).max(64).optional(),
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
  }),
);

const messagesGetContextSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_context').describe('Retrieve messages before and after a given message ID. channelId defaults to the current channel.'),
  channelId: z.string().trim().min(1).max(64).optional(),
  messageId: z.string().trim().min(1).max(64),
  before: z.number().int().min(0).max(20).optional(),
  after: z.number().int().min(0).max(20).optional(),
  maxChars: z.number().int().min(300).max(12_000).optional(),
});

const messagesSearchGuildSchema = addSinceVariantValidation(
  z.object({
    think: discordThinkField,
    action: z.literal('search_guild').describe('Search raw message history across the guild. Disabled in autopilot turns.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
    mode: z.enum(['hybrid', 'semantic', 'lexical', 'regex']).optional(),
    regexPattern: z.string().trim().min(1).max(500).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
  }),
);

const messagesUserTimelineSchema = addSinceVariantValidation(
  z.object({
    think: discordThinkField,
    action: z.literal('get_user_timeline').describe('Show recent messages from a user across the guild. Disabled in autopilot turns.'),
    userId: z.string().trim().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    maxChars: z.number().int().min(200).max(6_000).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
  }),
);

const messagesSendSchema = z.object({
  think: discordThinkField,
  action: z.literal('send').describe('Send a new message using plain text or Components V2 presentation.'),
  channelId: z.string().trim().min(1).max(64).optional(),
  presentation: discordMessagePresentationSchema.optional(),
  content: z.string().trim().min(1).max(8_000).optional(),
  files: z.array(discordMessageFileInputSchema).min(1).max(4).optional(),
  componentsV2: discordComponentsV2MessageSchema.optional(),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine((value, ctx) => {
  validateDiscordSendMessagePayload(value, ctx, { actionLabel: 'send' });
});

const pollsCreateSchema = z.object({
  think: discordThinkField,
  action: z.literal('create_poll').describe('Create a poll. Disabled in autopilot turns.'),
  question: z.string().trim().min(1).max(300),
  answers: z.array(discordPollAnswerSchema).min(2).max(10),
  durationHours: discordPollDurationHoursSchema.optional(),
  allowMultiselect: z.boolean().optional(),
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const threadsCreateSchema = z.object({
  think: discordThinkField,
  action: z.literal('create_thread').describe('Create a thread. Disabled in autopilot turns.'),
  name: z.string().trim().min(1).max(100),
  messageId: z.string().trim().min(1).max(64).optional(),
  channelId: z.string().trim().min(1).max(64).optional(),
  autoArchiveDurationMinutes: discordThreadAutoArchiveDurationSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

const reactionsAddSchema = z.object({
  think: discordThinkField,
  action: z.literal('add_reaction').describe('Add a reaction to a message. Disabled in autopilot turns.'),
  messageId: z.string().trim().min(1).max(64),
  emoji: discordEmojiSchema,
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const reactionsRemoveSelfSchema = z.object({
  think: discordThinkField,
  action: z.literal('remove_self_reaction').describe('Remove Sage’s own reaction from a message. Disabled in autopilot turns.'),
  messageId: z.string().trim().min(1).max(64),
  emoji: discordEmojiSchema,
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const discordMessagesToolSchema = z.discriminatedUnion('action', [
  helpActionSchema,
  messagesSearchHistorySchema,
  messagesSearchWithContextSchema,
  messagesGetContextSchema,
  messagesSearchGuildSchema,
  messagesUserTimelineSchema,
  messagesSendSchema,
  pollsCreateSchema,
  threadsCreateSchema,
  reactionsAddSchema,
  reactionsRemoveSelfSchema,
]);

export const discordMessagesTool: ToolDefinition<z.infer<typeof discordMessagesToolSchema>> = {
  name: 'discord_messages',
  description:
    'Discord messages tool for exact message history, in-channel delivery, reactions, polls, and threads.\n<USE_ONLY_WHEN> You need exact message evidence or message-level actions. </USE_ONLY_WHEN>',
  schema: discordMessagesToolSchema,
  metadata: {
    readOnlyPredicate: (args) => isReadOnlyDiscordDomainCall('discord_messages', args),
  },
  execute: async (args, ctx) => {
    if (args.action === 'help') {
      return buildDiscordHelpPayload('discord_messages', args.includeExamples);
    }
    return executeDiscordMessagesAction(args as Record<string, unknown> & { action: string }, ctx);
  },
};

const filesListChannelSchema = z.object({
  think: discordThinkField,
  action: z.literal('list_channel').describe('List cached attachments in the current channel only.'),
  query: z.string().trim().min(1).max(200).optional(),
  messageId: z.string().trim().min(1).max(64).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  includeContent: z.boolean().optional(),
  maxChars: z.number().int().min(500).max(50_000).optional(),
});

const filesListServerSchema = z.object({
  think: discordThinkField,
  action: z.literal('list_server').describe('List cached attachments across the guild. Disabled in autopilot turns.'),
  query: z.string().trim().min(1).max(200).optional(),
  messageId: z.string().trim().min(1).max(64).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  includeContent: z.boolean().optional(),
  maxChars: z.number().int().min(500).max(50_000).optional(),
});

const filesFindChannelSchema = z.object({
  think: discordThinkField,
  action: z.literal('find_channel').describe('Search attachment text in the current channel only.'),
  query: z.string().trim().min(2).max(500),
  topK: z.number().int().min(1).max(20).optional(),
  maxChars: z.number().int().min(300).max(12_000).optional(),
});

const filesFindServerSchema = z.object({
  think: discordThinkField,
  action: z.literal('find_server').describe('Search attachment text across the guild. Disabled in autopilot turns.'),
  query: z.string().trim().min(2).max(500),
  topK: z.number().int().min(1).max(20).optional(),
  maxChars: z.number().int().min(300).max(12_000).optional(),
});

const filesReadAttachmentSchema = z.object({
  think: discordThinkField,
  action: z.literal('read_attachment').describe('Read cached attachment text in pages. Disabled in autopilot turns.'),
  attachmentId: z.string().trim().min(1).max(64),
  startChar: z.number().int().min(0).max(50_000_000).optional(),
  maxChars: z.number().int().min(200).max(20_000).optional(),
});

const filesSendAttachmentSchema = z.object({
  think: discordThinkField,
  action: z.literal('send_attachment').describe('Resend a cached attachment and return its stored content. Disabled in autopilot turns.'),
  attachmentId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  content: z.string().trim().min(1).max(8_000).optional(),
  reason: z.string().trim().max(500).optional(),
  startChar: z.number().int().min(0).max(50_000_000).optional(),
  maxChars: z.number().int().min(200).max(20_000).optional(),
});

const discordFilesToolSchema = z.discriminatedUnion('action', [
  helpActionSchema,
  filesListChannelSchema,
  filesListServerSchema,
  filesFindChannelSchema,
  filesFindServerSchema,
  filesReadAttachmentSchema,
  filesSendAttachmentSchema,
]);

export const discordFilesTool: ToolDefinition<z.infer<typeof discordFilesToolSchema>> = {
  name: 'discord_files',
  description:
    'Discord files tool for attachment discovery, paged attachment reads, and attachment resend flows.\n<USE_ONLY_WHEN> You need cached Discord attachments or attachment-derived text. </USE_ONLY_WHEN>',
  schema: discordFilesToolSchema,
  metadata: {
    readOnlyPredicate: (args) => isReadOnlyDiscordDomainCall('discord_files', args),
  },
  execute: async (args, ctx) => {
    if (args.action === 'help') {
      return buildDiscordHelpPayload('discord_files', args.includeExamples);
    }
    return executeDiscordFilesAction(args as Record<string, unknown> & { action: string }, ctx);
  },
};

const instructionsUpdateServerSchema = z.object({
  think: discordThinkField,
  action: z.literal('update_server_instructions').describe('Submit an admin request to update guild server instructions.'),
  request: serverInstructionsUpdateRequestSchema,
});

const messagesEditSchema = z.object({
  think: discordThinkField,
  action: z.literal('edit_message').describe('Edit a message. Requires admin context and approval.'),
  channelId: z.string().trim().min(1).max(64).optional(),
  messageId: z.string().trim().min(1).max(64),
  content: z.string().trim().min(1).max(2_000),
  reason: z.string().trim().max(500).optional(),
});

const messageIdActionSchema = (action: 'delete_message' | 'pin_message' | 'unpin_message', description: string) =>
  z.object({
    think: discordThinkField,
    action: z.literal(action).describe(description),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  });

const channelsCreateSchema = z.object({
  think: discordThinkField,
  action: z.literal('create_channel').describe('Create a new channel or category. Requires admin context and approval.'),
  name: z.string().trim().min(1).max(100),
  type: z.enum(['text', 'voice', 'category']).optional(),
  parentId: z.string().trim().min(1).max(64).optional(),
  topic: z.string().trim().max(1_024).optional(),
  nsfw: z.boolean().optional(),
  rateLimitPerUser: z.number().int().min(0).max(21_600).optional(),
  reason: z.string().trim().max(500).optional(),
});

const channelsEditSchema = z.object({
  think: discordThinkField,
  action: z.literal('edit_channel').describe('Edit an existing channel. Requires admin context and approval.'),
  channelId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100).optional(),
  parentId: z.string().trim().min(1).max(64).optional(),
  topic: z.string().trim().max(1_024).optional(),
  nsfw: z.boolean().optional(),
  rateLimitPerUser: z.number().int().min(0).max(21_600).optional(),
  reason: z.string().trim().max(500).optional(),
});

const rolesCreateSchema = z.object({
  think: discordThinkField,
  action: z.literal('create_role').describe('Create a new role. Requires admin context and approval.'),
  name: z.string().trim().min(1).max(100),
  colorHex: z.string().trim().min(1).max(7).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  permissions: z.union([z.string(), z.number()]).optional(),
  reason: z.string().trim().max(500).optional(),
});

const rolesEditSchema = z.object({
  think: discordThinkField,
  action: z.literal('edit_role').describe('Edit an existing role. Requires admin context and approval.'),
  roleId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100).optional(),
  colorHex: z.string().trim().min(1).max(7).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  permissions: z.union([z.string(), z.number()]).optional(),
  reason: z.string().trim().max(500).optional(),
});

const roleIdActionSchema = (action: 'delete_role', description: string) =>
  z.object({
    think: discordThinkField,
    action: z.literal(action).describe(description),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  });

const memberRoleActionSchema = (action: 'add_member_role' | 'remove_member_role', description: string) =>
  z.object({
    think: discordThinkField,
    action: z.literal(action).describe(description),
    userId: z.string().trim().min(1).max(64),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  });

const oauthInviteUrlSchema = z.object({
  think: discordThinkField,
  action: z.literal('get_invite_url').describe('Generate an OAuth2 invite URL for the bot.'),
  permissions: z.union([z.string(), z.number()]).optional(),
  scopes: z.array(discordOauthScopeSchema).min(1).max(4).optional(),
  guildId: z.string().trim().min(1).max(64).optional(),
  disableGuildSelect: z.boolean().optional(),
});

const discordApiSchema = z.object({
  think: discordThinkField,
  action: z.literal('api').describe('Guild-scoped raw Discord API fallback for admin use only. Non-GET requests require approval.'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: discordRestPathSchema,
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  body: z.unknown().optional(),
  multipartBodyMode: z.enum(['payload_json', 'fields']).optional(),
  files: z.array(discordRestFileInputSchema).min(1).max(10).optional(),
  reason: z.string().trim().max(500).optional(),
  maxResponseChars: z.number().int().min(500).max(50_000).optional(),
});

const discordAdminToolSchema = z.discriminatedUnion('action', [
  helpActionSchema,
  instructionsUpdateServerSchema,
  z.object({
    think: discordThinkField,
    action: z.literal('submit_moderation').describe('Submit a moderation request. Requires admin context and approval.'),
    request: discordModerationActionRequestSchema,
  }),
  messagesEditSchema,
  messageIdActionSchema('delete_message', 'Delete a message. Requires admin context and approval.'),
  messageIdActionSchema('pin_message', 'Pin a message. Requires admin context and approval.'),
  messageIdActionSchema('unpin_message', 'Unpin a message. Requires admin context and approval.'),
  channelsCreateSchema,
  channelsEditSchema,
  rolesCreateSchema,
  rolesEditSchema,
  roleIdActionSchema('delete_role', 'Delete a role. Requires admin context and approval.'),
  memberRoleActionSchema('add_member_role', 'Add a role to a member. Requires admin context and approval.'),
  memberRoleActionSchema('remove_member_role', 'Remove a role from a member. Requires admin context and approval.'),
  oauthInviteUrlSchema,
  discordApiSchema,
]);

export const discordAdminTool: ToolDefinition<z.infer<typeof discordAdminToolSchema>> = {
  name: 'discord_admin',
  description:
    'Discord admin tool for server instruction writes, moderation, message/channel/role/member admin operations, invite URLs, and Discord API fallback.\n<USE_ONLY_WHEN> You need admin-grade Discord actions or raw Discord API fallback. </USE_ONLY_WHEN>',
  schema: discordAdminToolSchema,
  metadata: {
    readOnlyPredicate: (args) => isReadOnlyDiscordDomainCall('discord_admin', args),
  },
  execute: async (args, ctx) => {
    if (args.action === 'help') {
      return buildDiscordHelpPayload('discord_admin', args.includeExamples);
    }
    return executeDiscordAdminAction(args as Record<string, unknown> & { action: string }, ctx);
  },
};

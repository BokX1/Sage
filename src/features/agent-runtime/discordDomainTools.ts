import { z } from 'zod';

import {
  discordModerationActionRequestSchema,
  sagePersonaUpdateRequestSchema,
} from '../../features/admin/adminActionService';
import {
  addSinceVariantValidation,
  discordEmojiSchema,
  discordOauthScopeSchema,
  discordPollAnswerSchema,
  discordPollDurationHoursSchema,
  discordRestFileInputSchema,
  discordRestPathSchema,
  discordThreadAutoArchiveDurationSchema,
  executeDiscordAdminAction,
  prepareDiscordAdminActionApproval,
  executeDiscordContextAction,
  executeDiscordFilesAction,
  executeDiscordMessagesAction,
  executeDiscordServerAction,
  executeDiscordVoiceAction,
} from './discord/core';
import { defineToolSpecV2, type ToolExecutionContext } from './toolRegistry';
import {
  DISCORD_TOOL_ACTION_CATALOG,
  getDiscordActionCatalogForTool,
} from './discordToolCatalog';

const DISCORD_SERVER_ADMIN_READ_ACTIONS = new Set([
  'list_members',
  'get_member',
  'get_permission_snapshot',
  'list_automod_rules',
]);

const DISCORD_ADMIN_READ_ACTIONS = new Set([
  'get_server_key_status',
  'get_governance_review_status',
]);

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

  if (
    (toolName === 'discord_server' && DISCORD_SERVER_ADMIN_READ_ACTIONS.has(action)) ||
    (toolName === 'discord_admin' && DISCORD_ADMIN_READ_ACTIONS.has(action))
  ) {
    return true;
  }

  if (action === 'api') {
    const method = (args as Record<string, unknown>).method;
    return typeof method === 'string' && method.toUpperCase() === 'GET';
  }

  return false;
}

function buildDiscordDomainActionPolicy(
  toolName: keyof typeof DISCORD_TOOL_ACTION_CATALOG,
  args: unknown,
) {
  return {
    mutability: isReadOnlyDiscordDomainCall(toolName, args) ? ('read' as const) : ('write' as const),
    approvalMode: 'none' as const,
  };
}

async function resolveDiscordDomainActionPolicy(
  toolName: keyof typeof DISCORD_TOOL_ACTION_CATALOG,
  args: unknown,
  ctx: ToolExecutionContext,
) {
  void ctx;
  return buildDiscordDomainActionPolicy(toolName, args);
}

async function resolveDiscordAdminActionPolicy(args: unknown, ctx: ToolExecutionContext) {
  if (isReadOnlyDiscordDomainCall('discord_admin', args)) {
    return buildDiscordDomainActionPolicy('discord_admin', args);
  }

  const approval = await prepareDiscordAdminActionApproval(
    args as Record<string, unknown> & { action: string },
    ctx,
  );
  if (!approval) {
    return buildDiscordDomainActionPolicy('discord_admin', args);
  }

  return {
    mutability: 'write' as const,
    approvalMode: 'required' as const,
    approvalGroupKey: approval.approvalGroupKey,
    prepareApproval: async (_validatedArgs: unknown, _toolCtx: ToolExecutionContext) => {
      void _validatedArgs;
      void _toolCtx;
      return approval.payload;
    },
  };
}

function defineDiscordActionTool<
  TAction extends string,
  TShape extends z.ZodRawShape & { action: z.ZodLiteral<TAction> },
>(params: {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject<TShape>;
  modelInputSchema?: z.ZodTypeAny;
  domain: keyof typeof DISCORD_TOOL_ACTION_CATALOG;
  executeDomain: (args: Record<string, unknown> & { action: string }, ctx: ToolExecutionContext) => Promise<unknown>;
  readOnly: boolean;
  access?: 'public' | 'admin';
  observationPolicy?: 'tiny' | 'default' | 'large' | 'streaming' | 'artifact-only';
  capabilityTags?: string[];
  smoke?: { mode: 'required' | 'optional' | 'skip'; args?: Record<string, unknown>; reason?: string };
  promptSummary: string;
}) {
  const actionName = params.schema.shape.action.value;
  const { action: _actionShape, ...modelShape } = params.schema.shape;
  void _actionShape;
  const withAction = (args: unknown): Record<string, unknown> & { action: string } => ({
    ...(args as Record<string, unknown>),
    action: actionName,
  });
  const modelInputSchema =
    params.modelInputSchema ??
    z.object(modelShape).superRefine((value, ctx) => {
      const parsed = params.schema.safeParse({
        ...withAction(value),
      });
      if (parsed.success) {
        return;
      }
      for (const issue of parsed.error.issues) {
        const normalizedPath = issue.path.filter((segment, index) => !(index === 0 && segment === 'action'));
        if (issue.code === 'unrecognized_keys' && normalizedPath.length === 0) {
          const keys = 'keys' in issue && Array.isArray(issue.keys) ? issue.keys : [];
          if (keys.length === 1 && keys[0] === 'action') {
            continue;
          }
        }
        ctx.addIssue({
          ...issue,
          path: normalizedPath,
        });
      }
    });

  return defineToolSpecV2({
    name: params.name,
    title: params.title,
    description: params.description,
    input: modelInputSchema,
    annotations: params.readOnly
      ? {
          readOnlyHint: true,
        }
      : undefined,
    runtime: {
      class: params.readOnly ? 'query' : 'mutation',
      access: params.access ?? 'public',
      observationPolicy: params.observationPolicy ?? (params.readOnly ? 'large' : 'default'),
      readOnly: params.readOnly,
      readOnlyPredicate: () => params.readOnly,
      actionPolicy:
        params.domain === 'discord_admin'
          ? (args, ctx) => resolveDiscordAdminActionPolicy(withAction(args), ctx)
          : (args, ctx) => resolveDiscordDomainActionPolicy(params.domain, withAction(args), ctx),
      capabilityTags: ['discord', ...(params.capabilityTags ?? [])],
    },
    prompt: {
      summary: params.promptSummary,
    },
    smoke: params.smoke
      ? {
          ...params.smoke,
          args: params.smoke.args
            ? Object.fromEntries(
                Object.entries(params.smoke.args).filter(([key]) => key !== 'action'),
              )
            : undefined,
        }
      : undefined,
    execute: async (args, ctx) =>
      params.executeDomain(withAction(args), ctx),
  });
}

const profileGetUserSchema = z.object({
  action: z.literal('get_user_profile').describe('Fetch the best-effort personalization profile for a user.'),
  userId: z.string().trim().min(1).max(64).optional(),
  maxItemsPerSection: z.number().int().min(1).max(10).optional(),
});

const summaryGetChannelSchema = z.object({
  action: z.literal('get_channel_summary').describe('Fetch rolling and long-term summary context for the current channel only.'),
  maxItemsPerList: z.number().int().min(1).max(12).optional(),
  maxRecentFiles: z.number().int().min(1).max(20).optional(),
});

const summarySearchChannelArchivesSchema = z.object({
  action: z.literal('search_channel_summary_archives').describe('Search archived summary context for the current channel.'),
  query: z.string().trim().min(2).max(500),
  topK: z.number().int().min(1).max(20).optional(),
});

const instructionsGetServerSchema = z.object({
  action: z.literal('get_server_instructions').describe('Fetch the current admin-authored Sage Persona for this guild. Read-only guild behavior/persona config; not an admin write or memory surface.'),
});

const analyticsGetSocialGraphSchema = z.object({
  action: z.literal('get_social_graph').describe('Retrieve social graph relationships for a user.'),
  userId: z.string().trim().min(1).max(64).optional(),
  maxEdges: z.number().int().min(1).max(30).optional(),
});

const analyticsTopRelationshipsSchema = z.object({
  action: z.literal('get_top_relationships').describe('Show the top interaction pairs in this server.'),
  limit: z.number().int().min(1).max(30).optional(),
});

const analyticsGetVoiceAnalyticsSchema = z.object({
  action: z.literal('get_voice_analytics').describe('Retrieve voice participation analytics. Use discord_voice_get_status, discord_voice_join_current_channel, or discord_voice_leave for live voice control.'),
  userId: z.string().trim().min(1).max(64).optional(),
});

const analyticsVoiceSummariesSchema = z.object({
  action: z.literal('get_voice_summaries').describe('Retrieve recent voice session summaries. Use discord_voice_get_status, discord_voice_join_current_channel, or discord_voice_leave for live voice control.'),
  voiceChannelId: z.string().trim().min(1).max(64).optional(),
  sinceHours: z.number().int().min(1).max(2_160).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const messagesSearchHistorySchema = addSinceVariantValidation(
  z.object({
    action: z.literal('search_history').describe('Search channel message history. channelId defaults to the current channel.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
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
    action: z.literal('search_with_context').describe('Search channel history and expand context around the best match.'),
    channelId: z.string().trim().min(1).max(64).optional(),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    mode: z.enum(['hybrid', 'semantic', 'lexical', 'regex']).optional(),
    regexPattern: z.string().trim().min(1).max(500).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
    before: z.number().int().min(0).max(20).optional(),
    after: z.number().int().min(0).max(20).optional(),
  }),
);

const messagesGetContextSchema = z.object({
  action: z.literal('get_context').describe('Retrieve messages before and after a given message ID. This is a message-window lookup, not a rolling channel summary. channelId defaults to the current channel.'),
  channelId: z.string().trim().min(1).max(64).optional(),
  messageId: z.string().trim().min(1).max(64),
  before: z.number().int().min(0).max(20).optional(),
  after: z.number().int().min(0).max(20).optional(),
});

const messagesSearchGuildSchema = addSinceVariantValidation(
  z.object({
    action: z.literal('search_guild').describe('Search raw message history across the guild. Disabled in autopilot turns.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
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
    action: z.literal('get_user_timeline').describe('Show recent messages from a user across the guild. Disabled in autopilot turns.'),
    userId: z.string().trim().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
  }),
);

const pollsCreateSchema = z.object({
  action: z.literal('create_poll').describe('Create a poll. Disabled in autopilot turns.'),
  question: z.string().trim().min(1).max(300),
  answers: z.array(discordPollAnswerSchema).min(2).max(10),
  durationHours: discordPollDurationHoursSchema.optional(),
  allowMultiselect: z.boolean().optional(),
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const threadsCreateSchema = z.object({
  action: z.literal('create_thread').describe('Create a thread. Disabled in autopilot turns.'),
  name: z.string().trim().min(1).max(100),
  messageId: z.string().trim().min(1).max(64).optional(),
  channelId: z.string().trim().min(1).max(64).optional(),
  autoArchiveDurationMinutes: discordThreadAutoArchiveDurationSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

const reactionsAddSchema = z.object({
  action: z.literal('add_reaction').describe('Add a reaction to a message. Disabled in autopilot turns.'),
  messageId: z.string().trim().min(1).max(64),
  emoji: discordEmojiSchema,
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const reactionsRemoveSelfSchema = z.object({
  action: z.literal('remove_self_reaction').describe('Remove Sage’s own reaction from a message. Disabled in autopilot turns.'),
  messageId: z.string().trim().min(1).max(64),
  emoji: discordEmojiSchema,
  channelId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const filesListChannelSchema = z.object({
  action: z.literal('list_channel').describe('List cached attachments in the current channel only. This enumerates files, not channels.'),
  query: z.string().trim().min(1).max(200).optional(),
  messageId: z.string().trim().min(1).max(64).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  includeContent: z.boolean().optional(),
});

const filesListServerSchema = z.object({
  action: z.literal('list_server').describe('List cached attachments across the guild. This enumerates files, not guild resources. Disabled in autopilot turns.'),
  query: z.string().trim().min(1).max(200).optional(),
  messageId: z.string().trim().min(1).max(64).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  includeContent: z.boolean().optional(),
});

const filesFindChannelSchema = z.object({
  action: z.literal('find_channel').describe('Search attachment text in the current channel only. This searches files, not messages.'),
  query: z.string().trim().min(2).max(500),
  topK: z.number().int().min(1).max(20).optional(),
});

const filesFindServerSchema = z.object({
  action: z.literal('find_server').describe('Search attachment text across the guild. This searches files, not messages. Disabled in autopilot turns.'),
  query: z.string().trim().min(2).max(500),
  topK: z.number().int().min(1).max(20).optional(),
});

const filesReadAttachmentSchema = z.object({
  action: z.literal('read_attachment').describe('Read cached attachment text in pages. Disabled in autopilot turns.'),
  attachmentId: z.string().trim().min(1).max(64),
  startChar: z.number().int().min(0).max(50_000_000).optional(),
});

const filesSendAttachmentSchema = z.object({
  action: z.literal('send_attachment').describe('Resend a cached attachment and return its stored content. Disabled in autopilot turns.'),
  attachmentId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  content: z.string().trim().min(1).max(8_000).optional(),
  reason: z.string().trim().max(500).optional(),
  startChar: z.number().int().min(0).max(50_000_000).optional(),
});

const serverListChannelsSchema = z.object({
  action: z.literal('list_channels').describe('List accessible guild channels and categories.'),
  type: z.enum(['text', 'voice', 'category', 'announcement', 'forum', 'media', 'stage']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const serverGetChannelSchema = z.object({
  action: z.literal('get_channel').describe('Retrieve detailed metadata for one guild channel.'),
  channelId: z.string().trim().min(1).max(64),
});

const serverListRolesSchema = z.object({
  action: z.literal('list_roles').describe('List guild roles with compact permission summaries.'),
  limit: z.number().int().min(1).max(100).optional(),
});

const serverListThreadsSchema = z.object({
  action: z.literal('list_threads').describe('List active guild threads; archived lookup requires parentChannelId.'),
  parentChannelId: z.string().trim().min(1).max(64).optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).superRefine((value, ctx) => {
  if (value.includeArchived === true && !value.parentChannelId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'parentChannelId is required when includeArchived is true.',
      path: ['parentChannelId'],
    });
  }
});

const serverListThreadsInputSchema = z.object({
  parentChannelId: z.string().trim().min(1).max(64).optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).superRefine((value, ctx) => {
  if (value.includeArchived === true && !value.parentChannelId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'parentChannelId is required when includeArchived is true.',
      path: ['parentChannelId'],
    });
  }
});

const serverGetThreadSchema = z.object({
  action: z.literal('get_thread').describe('Retrieve detailed metadata for one thread.'),
  threadId: z.string().trim().min(1).max(64),
});

const serverListScheduledEventsSchema = z.object({
  action: z.literal('list_scheduled_events').describe('List scheduled events for the active guild.'),
  includeCompleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const serverGetScheduledEventSchema = z.object({
  action: z.literal('get_scheduled_event').describe('Retrieve one scheduled event for the active guild.'),
  eventId: z.string().trim().min(1).max(64),
});

const serverListMembersSchema = z.object({
  action: z.literal('list_members').describe('List guild members. Admin-only read; distinct from public guild-resource reads like channels, roles, threads, or events.'),
  query: z.string().trim().min(1).max(120).optional(),
  roleId: z.string().trim().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const serverGetMemberSchema = z.object({
  action: z.literal('get_member').describe('Retrieve one guild member. Admin-only read; use discord_context_get_user_profile for best-effort personalization context instead.'),
  userId: z.string().trim().min(1).max(64),
});

const serverPermissionSnapshotSchema = z.object({
  action: z.literal('get_permission_snapshot').describe('Resolve permissions for a user or role in a specific channel. Admin-only read.'),
  channelId: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(64).optional(),
  roleId: z.string().trim().min(1).max(64).optional(),
}).superRefine((value, ctx) => {
  const selected = Number(value.userId !== undefined) + Number(value.roleId !== undefined);
  if (selected !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one of userId or roleId.',
      path: ['userId'],
    });
  }
});

const serverPermissionSnapshotInputSchema = z.object({
  channelId: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(64).optional(),
  roleId: z.string().trim().min(1).max(64).optional(),
}).superRefine((value, ctx) => {
  const selected = Number(value.userId !== undefined) + Number(value.roleId !== undefined);
  if (selected !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one of userId or roleId.',
      path: ['userId'],
    });
  }
});

const serverListAutomodRulesSchema = z.object({
  action: z.literal('list_automod_rules').describe('List AutoMod rules for the active guild. Admin-only read.'),
  limit: z.number().int().min(1).max(100).optional(),
});

const serverUpdateThreadSchema = z.object({
  action: z.literal('update_thread').describe('Rename or change archive/lock settings for a thread. Disabled in autopilot turns.'),
  threadId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100).optional(),
  archived: z.boolean().optional(),
  locked: z.boolean().optional(),
  autoArchiveDurationMinutes: discordThreadAutoArchiveDurationSchema.optional(),
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
      message: 'Provide at least one mutable field.',
      path: ['name'],
    });
  }
});

const serverUpdateThreadInputSchema = z.object({
  threadId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100).optional(),
  archived: z.boolean().optional(),
  locked: z.boolean().optional(),
  autoArchiveDurationMinutes: discordThreadAutoArchiveDurationSchema.optional(),
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
      message: 'Provide at least one mutable field.',
      path: ['name'],
    });
  }
});

const serverThreadMembershipSchema = (action: 'join_thread' | 'leave_thread', description: string) =>
  z.object({
    action: z.literal(action).describe(description),
    threadId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  });

const serverThreadMemberActionSchema = (
  action: 'add_thread_member' | 'remove_thread_member',
  description: string,
) =>
  z.object({
    action: z.literal(action).describe(description),
    threadId: z.string().trim().min(1).max(64),
    userId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  });

const instructionsUpdateServerSchema = z.object({
  action: z.literal('update_server_instructions').describe('Submit an admin request to update the guild Sage Persona. This changes Sage behavior, persona, or policy config, not moderation or enforcement; use discord_context_get_server_instructions to read the current text.'),
  request: sagePersonaUpdateRequestSchema,
});

const messagesEditSchema = z.object({
  action: z.literal('edit_message').describe('Edit a message. Requires admin context and approval.'),
  channelId: z.string().trim().min(1).max(64).optional(),
  messageId: z.string().trim().min(1).max(64),
  content: z.string().trim().min(1).max(2_000),
  reason: z.string().trim().max(500).optional(),
});

const messageIdActionSchema = (action: 'delete_message' | 'pin_message' | 'unpin_message', description: string) =>
  z.object({
    action: z.literal(action).describe(description),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  });

const channelsCreateSchema = z.object({
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
  action: z.literal('create_role').describe('Create a new role. Requires admin context and approval.'),
  name: z.string().trim().min(1).max(100),
  colorHex: z.string().trim().min(1).max(7).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  permissions: z.union([z.string(), z.number()]).optional(),
  reason: z.string().trim().max(500).optional(),
});

const rolesEditSchema = z.object({
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
    action: z.literal(action).describe(description),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  });

const memberRoleActionSchema = (action: 'add_member_role' | 'remove_member_role', description: string) =>
  z.object({
    action: z.literal(action).describe(description),
    userId: z.string().trim().min(1).max(64),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  });

const oauthInviteUrlSchema = z.object({
  action: z.literal('get_invite_url').describe('Generate an OAuth2 invite URL for the bot.'),
  permissions: z.union([z.string(), z.number()]).optional(),
  scopes: z.array(discordOauthScopeSchema).min(1).max(4).optional(),
  guildId: z.string().trim().min(1).max(64).optional(),
  disableGuildSelect: z.boolean().optional(),
});

const adminGetServerKeyStatusSchema = z.object({
  action: z.literal('get_server_key_status').describe('Check the current server-wide API key status. Admin-only read.'),
});

const adminGetGovernanceReviewStatusSchema = z.object({
  action: z.literal('get_governance_review_status').describe('Inspect where governance review cards are routed for this server. Admin-only read.'),
});

const adminClearServerApiKeySchema = z.object({
  action: z.literal('clear_server_api_key').describe('Clear the current server-wide API key immediately. Admin-only write. Disabled in autopilot turns.'),
});

const adminSetGovernanceReviewChannelSchema = z.object({
  action: z.literal('set_governance_review_channel').describe('Route governance review cards to a specific text channel. Admin-only write. Disabled in autopilot turns.'),
  channelId: z.string().trim().min(1).max(64),
});

const adminClearGovernanceReviewChannelSchema = z.object({
  action: z.literal('clear_governance_review_channel').describe('Clear the dedicated governance review channel so reviews render in the source channel by default. Admin-only write. Disabled in autopilot turns.'),
});

const adminSendKeySetupCardSchema = z.object({
  action: z.literal('send_key_setup_card').describe('Send an interactive server-key setup card in the current channel. Admin-only write. Disabled in autopilot turns.'),
});

const discordApiSchema = z.object({
  action: z.literal('api').describe('Guild-scoped raw Discord API fallback for admin use only. Prefer typed granular Discord tools first. Non-GET requests require approval.'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: discordRestPathSchema,
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  body: z.unknown().optional(),
  multipartBodyMode: z.enum(['payload_json', 'fields']).optional(),
  files: z.array(discordRestFileInputSchema).min(1).max(10).optional(),
  reason: z.string().trim().max(500).optional(),
  maxResponseChars: z.number().int().min(500).max(50_000).optional(),
});

const voiceGetStatusSchema = z.object({
  action: z.literal('get_status').describe('Show the bot voice connection status for this guild.'),
});

const voiceJoinCurrentChannelSchema = z.object({
  action: z.literal('join_current_channel').describe('Join the invoker’s current voice channel. Disabled in autopilot turns.'),
});

const voiceLeaveSchema = z.object({
  action: z.literal('leave').describe('Leave the active guild voice channel. Disabled in autopilot turns.'),
});

export const discordContextTools = [
  defineDiscordActionTool({
    name: 'discord_context_get_user_profile',
    title: 'Discord Context Get User Profile',
    description: 'Fetch the best-effort personalization profile for a user.',
    schema: profileGetUserSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'memory', 'profiles'],
    promptSummary: 'Use for best-effort personalization context about one user.',
  }),
  defineDiscordActionTool({
    name: 'discord_context_get_channel_summary',
    title: 'Discord Context Get Channel Summary',
    description: 'Fetch rolling and long-term summary context for the current channel.',
    schema: summaryGetChannelSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'summaries'],
    promptSummary: 'Use for recap and continuity, not exact message proof.',
  }),
  defineDiscordActionTool({
    name: 'discord_context_search_channel_summary_archives',
    title: 'Discord Context Search Channel Summary Archives',
    description: 'Search archived summary context for the current channel.',
    schema: summarySearchChannelArchivesSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'summaries', 'search'],
    promptSummary: 'Use for archived summary recall when current summary is not enough.',
  }),
  defineDiscordActionTool({
    name: 'discord_context_get_server_instructions',
    title: 'Discord Context Get Server Instructions',
    description: 'Read the current guild Sage Persona instructions.',
    schema: instructionsGetServerSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'persona'],
    promptSummary: 'Use to read the current guild persona or behavior overlay.',
  }),
  defineDiscordActionTool({
    name: 'discord_context_get_social_graph',
    title: 'Discord Context Get Social Graph',
    description: 'Retrieve social graph relationships for a user.',
    schema: analyticsGetSocialGraphSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'relationships'],
    promptSummary: 'Use for relationship and interaction context around one user.',
  }),
  defineDiscordActionTool({
    name: 'discord_context_get_top_relationships',
    title: 'Discord Context Get Top Relationships',
    description: 'Show the top interaction pairs in this server.',
    schema: analyticsTopRelationshipsSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'relationships'],
    promptSummary: 'Use for broad social-graph relationship summaries.',
  }),
  defineDiscordActionTool({
    name: 'discord_context_get_voice_analytics',
    title: 'Discord Context Get Voice Analytics',
    description: 'Retrieve voice participation analytics.',
    schema: analyticsGetVoiceAnalyticsSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'voice'],
    promptSummary: 'Use for voice analytics, not live voice control.',
  }),
  defineDiscordActionTool({
    name: 'discord_context_get_voice_summaries',
    title: 'Discord Context Get Voice Summaries',
    description: 'Retrieve recent voice session summaries.',
    schema: analyticsVoiceSummariesSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'voice'],
    promptSummary: 'Use for recent voice session summaries and history.',
  }),
] as const;

export const discordMessageTools = [
  defineDiscordActionTool({
    name: 'discord_messages_search_history',
    title: 'Discord Messages Search History',
    description: 'Search channel message history.',
    schema: messagesSearchHistorySchema,
    domain: 'discord_messages',
    executeDomain: executeDiscordMessagesAction,
    readOnly: true,
    capabilityTags: ['messages', 'search'],
    promptSummary: 'Use for exact message-history evidence in one channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_messages_search_with_context',
    title: 'Discord Messages Search With Context',
    description: 'Search channel history and expand context around the best match.',
    schema: messagesSearchWithContextSchema,
    domain: 'discord_messages',
    executeDomain: executeDiscordMessagesAction,
    readOnly: true,
    capabilityTags: ['messages', 'search'],
    promptSummary: 'Use for exact message evidence plus surrounding context.',
  }),
  defineDiscordActionTool({
    name: 'discord_messages_get_context',
    title: 'Discord Messages Get Context',
    description: 'Retrieve messages before and after a given message ID.',
    schema: messagesGetContextSchema,
    domain: 'discord_messages',
    executeDomain: executeDiscordMessagesAction,
    readOnly: true,
    capabilityTags: ['messages', 'search'],
    promptSummary: 'Use for a bounded message window around one exact message.',
  }),
  defineDiscordActionTool({
    name: 'discord_messages_search_guild',
    title: 'Discord Messages Search Guild',
    description: 'Search raw message history across the guild.',
    schema: messagesSearchGuildSchema,
    domain: 'discord_messages',
    executeDomain: executeDiscordMessagesAction,
    readOnly: true,
    capabilityTags: ['messages', 'search'],
    promptSummary: 'Use for guild-wide exact message search when one channel is not enough.',
  }),
  defineDiscordActionTool({
    name: 'discord_messages_get_user_timeline',
    title: 'Discord Messages Get User Timeline',
    description: 'Show recent messages from a user across the guild.',
    schema: messagesUserTimelineSchema,
    domain: 'discord_messages',
    executeDomain: executeDiscordMessagesAction,
    readOnly: true,
    capabilityTags: ['messages', 'search'],
    promptSummary: 'Use for recent cross-guild message activity from one user.',
  }),
  defineDiscordActionTool({
    name: 'discord_messages_create_poll',
    title: 'Discord Messages Create Poll',
    description: 'Create a poll in Discord.',
    schema: pollsCreateSchema,
    domain: 'discord_messages',
    executeDomain: executeDiscordMessagesAction,
    readOnly: false,
    observationPolicy: 'artifact-only',
    capabilityTags: ['messages', 'artifact', 'poll'],
    promptSummary: 'Use to create a Discord poll artifact.',
  }),
  defineDiscordActionTool({
    name: 'discord_messages_add_reaction',
    title: 'Discord Messages Add Reaction',
    description: 'Add a reaction to a Discord message.',
    schema: reactionsAddSchema,
    domain: 'discord_messages',
    executeDomain: executeDiscordMessagesAction,
    readOnly: false,
    capabilityTags: ['messages', 'reactions'],
    promptSummary: 'Use to add a reaction to one message.',
  }),
  defineDiscordActionTool({
    name: 'discord_messages_remove_self_reaction',
    title: 'Discord Messages Remove Self Reaction',
    description: 'Remove Sage’s own reaction from a Discord message.',
    schema: reactionsRemoveSelfSchema,
    domain: 'discord_messages',
    executeDomain: executeDiscordMessagesAction,
    readOnly: false,
    capabilityTags: ['messages', 'reactions'],
    promptSummary: 'Use to remove Sage’s own reaction from one message.',
  }),
] as const;

export const discordFileTools = [
  defineDiscordActionTool({
    name: 'discord_files_list_channel',
    title: 'Discord Files List Channel',
    description: 'List cached attachments in the current channel.',
    schema: filesListChannelSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: true,
    capabilityTags: ['files', 'attachments'],
    promptSummary: 'Use to list cached attachments in the current channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_files_list_server',
    title: 'Discord Files List Server',
    description: 'List cached attachments across the guild.',
    schema: filesListServerSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: true,
    capabilityTags: ['files', 'attachments'],
    promptSummary: 'Use to list cached attachments across the guild.',
  }),
  defineDiscordActionTool({
    name: 'discord_files_find_channel',
    title: 'Discord Files Find Channel',
    description: 'Search attachment text in the current channel.',
    schema: filesFindChannelSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: true,
    capabilityTags: ['files', 'attachments', 'search'],
    promptSummary: 'Use to search attachment-derived text in the current channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_files_find_server',
    title: 'Discord Files Find Server',
    description: 'Search attachment text across the guild.',
    schema: filesFindServerSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: true,
    capabilityTags: ['files', 'attachments', 'search'],
    promptSummary: 'Use to search attachment-derived text across the guild.',
  }),
  defineDiscordActionTool({
    name: 'discord_files_read_attachment',
    title: 'Discord Files Read Attachment',
    description: 'Read cached attachment text in pages.',
    schema: filesReadAttachmentSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: true,
    capabilityTags: ['files', 'attachments', 'paging'],
    promptSummary: 'Use to page through cached attachment text.',
  }),
  defineDiscordActionTool({
    name: 'discord_files_send_attachment',
    title: 'Discord Files Send Attachment',
    description: 'Resend a cached attachment as a distinct artifact.',
    schema: filesSendAttachmentSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: false,
    observationPolicy: 'artifact-only',
    capabilityTags: ['files', 'attachments', 'artifact'],
    promptSummary: 'Use to resend a cached attachment artifact.',
  }),
] as const;

export const discordServerTools = [
  defineDiscordActionTool({
    name: 'discord_server_list_channels',
    title: 'Discord Server List Channels',
    description: 'List accessible guild channels and categories.',
    schema: serverListChannelsSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    capabilityTags: ['server', 'channels'],
    smoke: { mode: 'optional', args: { action: 'list_channels', limit: 5 } },
    promptSummary: 'Use to inspect accessible guild channels and categories.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_get_channel',
    title: 'Discord Server Get Channel',
    description: 'Retrieve detailed metadata for one guild channel.',
    schema: serverGetChannelSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    capabilityTags: ['server', 'channels'],
    promptSummary: 'Use for detailed metadata about one channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_list_roles',
    title: 'Discord Server List Roles',
    description: 'List guild roles with compact permission summaries.',
    schema: serverListRolesSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    capabilityTags: ['server', 'roles'],
    promptSummary: 'Use to inspect guild roles.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_list_threads',
    title: 'Discord Server List Threads',
    description: 'List active or archived guild threads.',
    schema: serverListThreadsSchema,
    modelInputSchema: serverListThreadsInputSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to inspect threads in the guild.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_get_thread',
    title: 'Discord Server Get Thread',
    description: 'Retrieve detailed metadata for one thread.',
    schema: serverGetThreadSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use for one thread’s detailed metadata.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_list_scheduled_events',
    title: 'Discord Server List Scheduled Events',
    description: 'List scheduled events for the active guild.',
    schema: serverListScheduledEventsSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    capabilityTags: ['server', 'events'],
    promptSummary: 'Use to inspect scheduled events.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_get_scheduled_event',
    title: 'Discord Server Get Scheduled Event',
    description: 'Retrieve one scheduled event for the active guild.',
    schema: serverGetScheduledEventSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    capabilityTags: ['server', 'events'],
    promptSummary: 'Use for one scheduled event’s details.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_list_members',
    title: 'Discord Server List Members',
    description: 'List guild members for inspection, moderation context, or membership lookup.',
    schema: serverListMembersSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['server', 'members', 'moderation'],
    promptSummary: 'Use for guild member inspection.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_get_member',
    title: 'Discord Server Get Member',
    description: 'Retrieve one guild member.',
    schema: serverGetMemberSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['server', 'members', 'moderation'],
    promptSummary: 'Use for one guild member’s details.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_get_permission_snapshot',
    title: 'Discord Server Get Permission Snapshot',
    description: 'Resolve permissions for a user or role in a specific channel.',
    schema: serverPermissionSnapshotSchema,
    modelInputSchema: serverPermissionSnapshotInputSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['server', 'permissions', 'moderation'],
    promptSummary: 'Use for resolved permission snapshots in one channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_list_automod_rules',
    title: 'Discord Server List Automod Rules',
    description: 'List AutoMod rules for the active guild.',
    schema: serverListAutomodRulesSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['server', 'moderation'],
    promptSummary: 'Use to inspect AutoMod rules.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_create_thread',
    title: 'Discord Server Create Thread',
    description: 'Create a Discord thread.',
    schema: threadsCreateSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to create a thread.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_update_thread',
    title: 'Discord Server Update Thread',
    description: 'Rename or change archive or lock settings for a thread.',
    schema: serverUpdateThreadSchema,
    modelInputSchema: serverUpdateThreadInputSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to update thread settings.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_join_thread',
    title: 'Discord Server Join Thread',
    description: 'Join an existing Discord thread as Sage so later thread-scoped actions can proceed.',
    schema: serverThreadMembershipSchema('join_thread', 'Join a thread as Sage. Disabled in autopilot turns.'),
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to join a thread.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_leave_thread',
    title: 'Discord Server Leave Thread',
    description: 'Leave an existing Discord thread as Sage after thread-scoped work is complete.',
    schema: serverThreadMembershipSchema('leave_thread', 'Leave a thread as Sage. Disabled in autopilot turns.'),
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to leave a thread.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_add_thread_member',
    title: 'Discord Server Add Thread Member',
    description: 'Add a member to a thread.',
    schema: serverThreadMemberActionSchema('add_thread_member', 'Add a member to a thread. Disabled in autopilot turns.'),
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to add a member to a thread.',
  }),
  defineDiscordActionTool({
    name: 'discord_server_remove_thread_member',
    title: 'Discord Server Remove Thread Member',
    description: 'Remove a member from a thread.',
    schema: serverThreadMemberActionSchema('remove_thread_member', 'Remove a member from a thread. Disabled in autopilot turns.'),
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to remove a member from a thread.',
  }),
] as const;

export const discordAdminTools = [
  defineDiscordActionTool({
    name: 'discord_admin_get_server_key_status',
    title: 'Discord Admin Get Server Key Status',
    description: 'Check the current server-wide API key status.',
    schema: adminGetServerKeyStatusSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use to inspect the current server key status.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_get_governance_review_status',
    title: 'Discord Admin Get Governance Review Status',
    description: 'Inspect where governance review cards are routed.',
    schema: adminGetGovernanceReviewStatusSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['admin', 'governance'],
    promptSummary: 'Use to inspect governance review routing.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_get_invite_url',
    title: 'Discord Admin Get Invite Url',
    description: 'Generate an OAuth2 invite URL for the bot.',
    schema: oauthInviteUrlSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use to generate the bot invite URL.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_clear_server_api_key',
    title: 'Discord Admin Clear Server Api Key',
    description: 'Clear the current server-wide API key.',
    schema: adminClearServerApiKeySchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance'],
    promptSummary: 'Use to clear the server-wide API key.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_set_governance_review_channel',
    title: 'Discord Admin Set Governance Review Channel',
    description: 'Route governance review cards to a specific text channel.',
    schema: adminSetGovernanceReviewChannelSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance'],
    promptSummary: 'Use to configure the governance review channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_clear_governance_review_channel',
    title: 'Discord Admin Clear Governance Review Channel',
    description: 'Clear the dedicated governance review channel.',
    schema: adminClearGovernanceReviewChannelSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance'],
    promptSummary: 'Use to clear the governance review channel override.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_send_key_setup_card',
    title: 'Discord Admin Send Key Setup Card',
    description: 'Send an interactive server-key setup card.',
    schema: adminSendKeySetupCardSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    observationPolicy: 'artifact-only',
    capabilityTags: ['admin', 'artifact'],
    promptSummary: 'Use to send the server-key setup card artifact.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_update_server_instructions',
    title: 'Discord Admin Update Server Instructions',
    description: 'Submit an admin request to update the guild Sage Persona.',
    schema: instructionsUpdateServerSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance'],
    promptSummary: 'Use to change the guild persona or behavior instructions.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_submit_moderation',
    title: 'Discord Admin Submit Moderation',
    description: 'Submit a moderation or enforcement request.',
    schema: z.object({
      action: z.literal('submit_moderation').describe('Submit a moderation or enforcement request.'),
      request: discordModerationActionRequestSchema,
    }),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use for moderation or enforcement actions that need approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_edit_message',
    title: 'Discord Admin Edit Message',
    description: 'Edit a message with admin approval.',
    schema: messagesEditSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use to edit a message as an admin action.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_delete_message',
    title: 'Discord Admin Delete Message',
    description: 'Delete a message with admin approval.',
    schema: messageIdActionSchema('delete_message', 'Delete a message as a direct admin maintenance action.'),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use to delete a message as an admin action.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_pin_message',
    title: 'Discord Admin Pin Message',
    description: 'Pin a message with admin approval.',
    schema: messageIdActionSchema('pin_message', 'Pin a message. Requires admin context and approval.'),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use to pin a message.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_unpin_message',
    title: 'Discord Admin Unpin Message',
    description: 'Unpin a message with admin approval.',
    schema: messageIdActionSchema('unpin_message', 'Unpin a message. Requires admin context and approval.'),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use to unpin a message.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_create_channel',
    title: 'Discord Admin Create Channel',
    description: 'Create a new channel or category.',
    schema: channelsCreateSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use to create a guild channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_edit_channel',
    title: 'Discord Admin Edit Channel',
    description: 'Edit an existing channel.',
    schema: channelsEditSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use to edit a guild channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_create_role',
    title: 'Discord Admin Create Role',
    description: 'Create a new guild role with Discord admin approval and server context.',
    schema: rolesCreateSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'moderation'],
    smoke: { mode: 'skip', reason: 'Role creation is approval-gated and environment-specific.' },
    promptSummary: 'Use to create a role.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_edit_role',
    title: 'Discord Admin Edit Role',
    description: 'Edit an existing guild role, including name, color, or permissions, with approval.',
    schema: rolesEditSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to edit a role.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_delete_role',
    title: 'Discord Admin Delete Role',
    description: 'Delete an existing guild role with admin approval and guild context.',
    schema: roleIdActionSchema('delete_role', 'Delete a role. Requires admin context and approval.'),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to delete a role.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_add_member_role',
    title: 'Discord Admin Add Member Role',
    description: 'Add an existing guild role to a member with admin approval.',
    schema: memberRoleActionSchema('add_member_role', 'Add a role to a member. Requires admin context and approval.'),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to add a role to a member.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_remove_member_role',
    title: 'Discord Admin Remove Member Role',
    description: 'Remove a role from a member.',
    schema: memberRoleActionSchema('remove_member_role', 'Remove a role from a member. Requires admin context and approval.'),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to remove a role from a member.',
  }),
  defineDiscordActionTool({
    name: 'discord_admin_api',
    title: 'Discord Admin Api',
    description: 'Guild-scoped raw Discord API fallback.',
    schema: discordApiSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin'],
    promptSummary: 'Use raw Discord API fallback only after typed tools do not cover the task.',
  }),
] as const;

export const discordVoiceTools = [
  defineDiscordActionTool({
    name: 'discord_voice_get_status',
    title: 'Discord Voice Get Status',
    description: 'Show the bot voice connection status for this guild.',
    schema: voiceGetStatusSchema,
    domain: 'discord_voice',
    executeDomain: executeDiscordVoiceAction,
    readOnly: true,
    capabilityTags: ['voice'],
    promptSummary: 'Use for current voice connection status.',
  }),
  defineDiscordActionTool({
    name: 'discord_voice_join_current_channel',
    title: 'Discord Voice Join Current Channel',
    description: 'Join the invoker’s current voice channel.',
    schema: voiceJoinCurrentChannelSchema,
    domain: 'discord_voice',
    executeDomain: executeDiscordVoiceAction,
    readOnly: false,
    capabilityTags: ['voice'],
    promptSummary: 'Use to join the invoker’s voice channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_voice_leave',
    title: 'Discord Voice Leave',
    description: 'Leave the active guild voice channel.',
    schema: voiceLeaveSchema,
    domain: 'discord_voice',
    executeDomain: executeDiscordVoiceAction,
    readOnly: false,
    capabilityTags: ['voice'],
    promptSummary: 'Use to leave the current voice channel.',
  }),
] as const;

export const discordTools = [
  ...discordContextTools,
  ...discordMessageTools,
  ...discordFileTools,
  ...discordServerTools,
  ...discordAdminTools,
  ...discordVoiceTools,
] as const;

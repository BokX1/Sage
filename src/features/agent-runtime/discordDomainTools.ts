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
  discordThreadAutoArchiveDurationSchema,
  executeDiscordAdminAction,
  prepareDiscordAdminActionApproval,
  executeDiscordContextAction,
  executeDiscordFilesAction,
  executeDiscordMessagesAction,
  executeDiscordServerAction,
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
  'get_host_auth_status',
  'get_governance_review_status',
  'get_invoke_thread_status',
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
  access?: 'public' | 'moderator' | 'admin' | 'owner';
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

const artifactListSchema = z.object({
  action: z.literal('list_artifacts').describe('List stored Discord artifacts in the active guild or origin channel.'),
  channelId: z.string().trim().min(1).max(64).optional(),
  createdByUserId: z.string().trim().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const artifactGetSchema = z.object({
  action: z.literal('get_artifact').describe('Retrieve one Discord artifact and its latest revision metadata.'),
  artifactId: z.string().trim().min(1).max(64),
});

const artifactStageAttachmentSchema = z.object({
  action: z.literal('stage_attachment_artifact').describe('Turn an ingested Discord attachment into a durable Sage artifact revision. Disabled in autopilot turns.'),
  attachmentId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100).optional(),
  descriptionText: z.string().trim().max(500).optional(),
});

const artifactCreateTextSchema = z.object({
  action: z.literal('create_text_artifact').describe('Create a new text or structured-text artifact. Disabled in autopilot turns.'),
  name: z.string().trim().min(1).max(100),
  filename: z.string().trim().min(1).max(255).optional(),
  format: z.string().trim().min(1).max(40).optional(),
  descriptionText: z.string().trim().max(500).optional(),
  content: z.string().min(1).max(30_000),
});

const artifactReplaceSchema = z.object({
  action: z.literal('replace_artifact').describe('Create a new revision for an existing artifact from text or an existing attachment. Disabled in autopilot turns.'),
  artifactId: z.string().trim().min(1).max(64),
  filename: z.string().trim().min(1).max(255).optional(),
  format: z.string().trim().min(1).max(40).optional(),
  content: z.string().min(1).max(30_000).optional(),
  attachmentId: z.string().trim().min(1).max(64).optional(),
}).superRefine((value, ctx) => {
  if (!value.content && !value.attachmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide content or attachmentId.',
      path: ['content'],
    });
  }
});

const artifactPublishSchema = z.object({
  action: z.literal('publish_artifact').describe('Publish the latest artifact revision into a Discord channel or thread. Disabled in autopilot turns.'),
  artifactId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  content: z.string().trim().min(1).max(8_000).optional(),
});

const artifactListRevisionsSchema = z.object({
  action: z.literal('list_artifact_revisions').describe('List recent revisions for one artifact.'),
  artifactId: z.string().trim().min(1).max(64),
  limit: z.number().int().min(1).max(100).optional(),
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

const moderationActionSpecSchema = z.object({
  type: z.enum(['log_only', 'alert_mods', 'delete_or_block_message', 'timeout_member', 'open_review_case']),
  timeoutMinutes: z.number().int().min(1).max(40_320).optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'timeout_member' && value.timeoutMinutes === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'timeoutMinutes is required when type is timeout_member.',
      path: ['timeoutMinutes'],
    });
  }
});

const moderationEscalationSpecSchema = z.object({
  threshold: z.number().int().min(2).max(20),
  windowMinutes: z.number().int().min(1).max(10_080),
  action: moderationActionSpecSchema,
});

const moderationKeywordTriggerSchema = z.object({
  kind: z.literal('keyword_filter'),
  keywords: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
  allowList: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationRegexTriggerSchema = z.object({
  kind: z.literal('regex_filter'),
  patterns: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
  allowList: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationBlockedDomainsTriggerSchema = z.object({
  kind: z.literal('blocked_domains'),
  domains: z.array(z.string().trim().min(1).max(255)).min(1).max(50),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationInviteLinksTriggerSchema = z.object({
  kind: z.literal('invite_links'),
  allowInternalInvites: z.boolean().optional(),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationMentionSpamTriggerSchema = z.object({
  kind: z.literal('mention_spam'),
  mentionTotalLimit: z.number().int().min(1).max(50),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationGenericSpamTriggerSchema = z.object({
  kind: z.literal('generic_spam'),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationBurstSpamTriggerSchema = z.object({
  kind: z.literal('burst_spam'),
  maxMessages: z.number().int().min(2).max(50),
  windowSeconds: z.number().int().min(5).max(3_600),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationDuplicateMessagesTriggerSchema = z.object({
  kind: z.literal('duplicate_messages'),
  maxDuplicates: z.number().int().min(2).max(20),
  windowSeconds: z.number().int().min(5).max(3_600),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationCapsAbuseTriggerSchema = z.object({
  kind: z.literal('caps_abuse'),
  minLength: z.number().int().min(5).max(2_000),
  uppercaseRatio: z.number().min(0.5).max(1),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationAttachmentPolicyTriggerSchema = z.object({
  kind: z.literal('attachment_policy'),
  blockedExtensions: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
  blockedContentTypes: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  maxBytes: z.number().int().min(1).max(100_000_000).optional(),
  exemptChannelIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  exemptRoleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const moderationAccountAgeGateTriggerSchema = z.object({
  kind: z.literal('account_age_gate'),
  minAccountAgeMinutes: z.number().int().min(1).max(525_600),
});

const moderationUsernameFilterTriggerSchema = z.object({
  kind: z.literal('username_filter'),
  keywords: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  patterns: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
}).superRefine((value, ctx) => {
  if ((!value.keywords || value.keywords.length === 0) && (!value.patterns || value.patterns.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least one keyword or regex pattern.',
      path: ['keywords'],
    });
  }
});

const moderationJoinVelocityTriggerSchema = z.object({
  kind: z.literal('join_velocity'),
  maxJoins: z.number().int().min(2).max(100),
  windowSeconds: z.number().int().min(5).max(86_400),
});

const moderationPolicySpecSchema = z.object({
  family: z.enum(['content_filter', 'spam_filter', 'member_safety', 'attachment_policy']),
  trigger: z.discriminatedUnion('kind', [
    moderationKeywordTriggerSchema,
    moderationRegexTriggerSchema,
    moderationBlockedDomainsTriggerSchema,
    moderationInviteLinksTriggerSchema,
    moderationMentionSpamTriggerSchema,
    moderationGenericSpamTriggerSchema,
    moderationBurstSpamTriggerSchema,
    moderationDuplicateMessagesTriggerSchema,
    moderationCapsAbuseTriggerSchema,
    moderationAttachmentPolicyTriggerSchema,
    moderationAccountAgeGateTriggerSchema,
    moderationUsernameFilterTriggerSchema,
    moderationJoinVelocityTriggerSchema,
  ]),
  action: moderationActionSpecSchema,
  escalation: moderationEscalationSpecSchema.nullish(),
  notifyChannelId: z.string().trim().min(1).max(64).optional(),
}).superRefine((value, ctx) => {
  const needsNotifyChannel =
    value.action.type === 'alert_mods' ||
    value.action.type === 'open_review_case' ||
    value.escalation?.action.type === 'alert_mods' ||
    value.escalation?.action.type === 'open_review_case';

  if (needsNotifyChannel && !value.notifyChannelId?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'notifyChannelId is required when the policy or escalation action alerts moderators or opens review cases.',
      path: ['notifyChannelId'],
    });
  }
});

const serverListModerationPoliciesSchema = z.object({
  action: z.literal('list_moderation_policies').describe('List Sage moderation policies and imported external AutoMod inventory. Admin-only read.'),
});

const serverGetModerationPolicySchema = z.object({
  action: z.literal('get_moderation_policy').describe('Retrieve one moderation policy by id or name. Admin-only read.'),
  policyId: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(100).optional(),
}).superRefine((value, ctx) => {
  if (!value.policyId && !value.name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide policyId or name.',
      path: ['policyId'],
    });
  }
});

const serverListModerationCasesSchema = z.object({
  action: z.literal('list_moderation_cases').describe('List recent moderation cases for the guild. Moderator-or-admin read.'),
  limit: z.number().int().min(1).max(100).optional(),
  policyId: z.string().trim().min(1).max(64).optional(),
  targetUserId: z.string().trim().min(1).max(64).optional(),
});

const serverGetModerationCaseSchema = z.object({
  action: z.literal('get_moderation_case').describe('Retrieve one moderation case and its notes. Moderator-or-admin read.'),
  caseId: z.string().trim().min(1).max(64),
});

const serverGetModerationMemberHistorySchema = z.object({
  action: z.literal('get_moderation_member_history').describe('Retrieve moderation history for one guild member. Moderator-or-admin read.'),
  targetUserId: z.string().trim().min(1).max(64),
  limit: z.number().int().min(1).max(100).optional(),
});

const serverListScheduledTasksSchema = z.object({
  action: z.literal('list_scheduled_tasks').describe('List configured Sage scheduled tasks for the guild. Admin-only read.'),
});

const serverGetScheduledTaskSchema = z.object({
  action: z.literal('get_scheduled_task').describe('Retrieve one scheduled task and its recent runs. Admin-only read.'),
  taskId: z.string().trim().min(1).max(64),
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
  action: z.literal('update_server_instructions').describe('Submit an admin request to update the guild Sage Persona. This changes Sage behavior, persona, or policy config, not moderation or enforcement; use discord_governance_get_server_instructions to read the current text.'),
  request: sagePersonaUpdateRequestSchema,
});

const adminUpsertModerationPolicySchema = z.object({
  action: z.literal('upsert_moderation_policy').describe('Create or update an autonomous moderation policy. Admin-only write.'),
  policyId: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(100),
  descriptionText: z.string().trim().max(500).optional(),
  mode: z.enum(['dry_run', 'enforce', 'disabled']).default('dry_run'),
  spec: moderationPolicySpecSchema,
});

const adminDisableModerationPolicySchema = z.object({
  action: z.literal('disable_moderation_policy').describe('Disable a moderation policy by id or name. Admin-only write.'),
  policyId: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(100).optional(),
}).superRefine((value, ctx) => {
  if (!value.policyId && !value.name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide policyId or name.',
      path: ['policyId'],
    });
  }
});

const reminderTaskPayloadSchema = z.object({
  kind: z.literal('reminder_message'),
  content: z.string().trim().min(1).max(8_000),
  roleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  userIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});

const agentRunTaskPayloadSchema = z.object({
  kind: z.literal('agent_run'),
  prompt: z.string().trim().min(1).max(8_000),
  mentionedUserIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});

const scheduledTaskPayloadSchema = z.discriminatedUnion('kind', [
  reminderTaskPayloadSchema,
  agentRunTaskPayloadSchema,
]);

const adminUpsertScheduledTaskSchema = z.object({
  action: z.literal('upsert_scheduled_task').describe('Create or update a durable scheduled reminder or scheduled Sage run. Admin-only write.'),
  taskId: z.string().trim().min(1).max(64).optional(),
  kind: z.enum(['reminder_message', 'agent_run']),
  channelId: z.string().trim().min(1).max(64).optional(),
  timezone: z.string().trim().min(1).max(120).optional(),
  cronExpr: z.string().trim().min(1).max(120).optional(),
  runAtIso: z.string().trim().min(1).max(80).optional(),
  payload: scheduledTaskPayloadSchema,
}).superRefine((value, ctx) => {
  if (!value.cronExpr && !value.runAtIso) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide cronExpr or runAtIso.',
      path: ['cronExpr'],
    });
  }
  if (value.cronExpr && value.runAtIso) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide only one of cronExpr or runAtIso.',
      path: ['cronExpr'],
    });
  }
  if (value.payload.kind !== value.kind) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'payload.kind must match kind.',
      path: ['payload', 'kind'],
    });
  }
});

const adminCancelScheduledTaskSchema = z.object({
  action: z.literal('cancel_scheduled_task').describe('Cancel an existing scheduled task. Admin-only write.'),
  taskId: z.string().trim().min(1).max(64),
});

const moderationCaseIdSchema = (action: 'acknowledge_moderation_case', description: string) =>
  z.object({
    action: z.literal(action).describe(description),
    caseId: z.string().trim().min(1).max(64),
  });

const moderationResolveCaseSchema = z.object({
  action: z.literal('resolve_moderation_case').describe('Resolve or void a moderation case. Moderator-or-admin write. Disabled in autopilot turns.'),
  caseId: z.string().trim().min(1).max(64),
  outcome: z.enum(['executed', 'failed', 'noop']),
  reasonText: z.string().trim().max(1_000).optional(),
});

const moderationCaseNoteSchema = z.object({
  action: z.literal('add_moderation_case_note').describe('Add a moderator note to a moderation case. Moderator-or-admin write. Disabled in autopilot turns.'),
  caseId: z.string().trim().min(1).max(64),
  noteText: z.string().trim().min(1).max(2_000),
});

const schedulerTaskActionSchema = (
  action: 'pause_scheduled_task' | 'resume_scheduled_task' | 'run_scheduled_task_now' | 'skip_scheduled_task_next_run',
  description: string,
) => z.object({
  action: z.literal(action).describe(description),
  taskId: z.string().trim().min(1).max(64),
});

const schedulerCloneTaskSchema = z.object({
  action: z.literal('clone_scheduled_task').describe('Clone an existing scheduled task. Admin-only write. Disabled in autopilot turns.'),
  taskId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(64).optional(),
  timezone: z.string().trim().min(1).max(120).optional(),
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

const scheduledEventEntityTypeSchema = z.enum(['stage', 'voice', 'external']);

const adminCreateScheduledEventSchema = z.object({
  action: z.literal('create_scheduled_event').describe('Create a scheduled event. Requires admin context and approval.'),
  name: z.string().trim().min(1).max(100),
  entityType: scheduledEventEntityTypeSchema,
  scheduledStartTime: z.string().trim().min(1).max(80),
  scheduledEndTime: z.string().trim().min(1).max(80).optional(),
  channelId: z.string().trim().min(1).max(64).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if ((value.entityType === 'stage' || value.entityType === 'voice') && !value.channelId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['channelId'],
      message: 'Voice or stage scheduled events require channelId.',
    });
  }
  if (value.entityType === 'external') {
    if (!value.location) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['location'],
        message: 'External scheduled events require location.',
      });
    }
    if (!value.scheduledEndTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledEndTime'],
        message: 'External scheduled events require scheduledEndTime.',
      });
    }
  }
});

const adminUpdateScheduledEventSchema = z.object({
  action: z.literal('update_scheduled_event').describe('Update a scheduled event. Requires admin context and approval.'),
  eventId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100).optional(),
  entityType: scheduledEventEntityTypeSchema.optional(),
  scheduledStartTime: z.string().trim().min(1).max(80).optional(),
  scheduledEndTime: z.string().trim().min(1).max(80).nullable().optional(),
  channelId: z.string().trim().min(1).max(64).nullable().optional(),
  location: z.string().trim().min(1).max(200).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  reason: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (
    value.name === undefined &&
    value.entityType === undefined &&
    value.scheduledStartTime === undefined &&
    value.scheduledEndTime === undefined &&
    value.channelId === undefined &&
    value.location === undefined &&
    value.description === undefined &&
    value.status === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['name'],
      message: 'Provide at least one mutable scheduled-event field.',
    });
  }
});

const adminDeleteScheduledEventSchema = z.object({
  action: z.literal('delete_scheduled_event').describe('Delete a scheduled event. Requires admin context and approval.'),
  eventId: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(500).optional(),
});

const adminCreateForumPostSchema = z.object({
  action: z.literal('create_forum_post').describe('Create a forum post inside a forum channel. Requires admin context and approval.'),
  forumChannelId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(100).optional(),
  content: z.string().trim().min(1).max(2_000).optional(),
  artifactId: z.string().trim().min(1).max(64).optional(),
  appliedTagIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  autoArchiveDurationMinutes: discordThreadAutoArchiveDurationSchema.optional(),
  rateLimitPerUser: z.number().int().min(0).max(21_600).optional(),
  reason: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (!value.content && !value.artifactId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide content or artifactId.',
      path: ['content'],
    });
  }
});

const adminUpdateForumTagsSchema = z.object({
  action: z.literal('update_forum_tags').describe('Replace the applied tags on a forum thread. Requires admin context and approval.'),
  threadId: z.string().trim().min(1).max(64),
  appliedTagIds: z.array(z.string().trim().min(1).max(64)).max(20),
  reason: z.string().trim().max(500).optional(),
});

const adminArchiveThreadSchema = z.object({
  action: z.literal('archive_thread').describe('Archive a thread. Requires admin context and approval.'),
  threadId: z.string().trim().min(1).max(64),
  locked: z.boolean().optional(),
  resolutionNoteText: z.string().trim().min(1).max(2_000).optional(),
  resolutionArtifactId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const adminReopenThreadSchema = z.object({
  action: z.literal('reopen_thread').describe('Reopen an archived thread. Requires admin context and approval.'),
  threadId: z.string().trim().min(1).max(64),
  locked: z.boolean().optional(),
  resolutionNoteText: z.string().trim().min(1).max(2_000).optional(),
  resolutionArtifactId: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().max(500).optional(),
});

const adminListInvitesSchema = z.object({
  action: z.literal('list_invites').describe('List active invites for the current guild or one channel. Admin-only read.'),
  channelId: z.string().trim().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const adminCreateInviteSchema = z.object({
  action: z.literal('create_invite').describe('Create an invite for a channel. Requires admin context and approval.'),
  channelId: z.string().trim().min(1).max(64).optional(),
  maxAgeSeconds: z.number().int().min(0).max(604_800).optional(),
  maxUses: z.number().int().min(0).max(100).optional(),
  temporary: z.boolean().optional(),
  unique: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

const adminRevokeInviteSchema = z.object({
  action: z.literal('revoke_invite').describe('Revoke an invite by code. Requires admin context and approval.'),
  code: z.string().trim().min(1).max(128),
  reason: z.string().trim().max(500).optional(),
});

const adminGetServerKeyStatusSchema = z.object({
  action: z.literal('get_server_key_status').describe('Check the current server-wide API key status. Admin-only read.'),
});

const adminGetHostAuthStatusSchema = z.object({
  action: z.literal('get_host_auth_status').describe('Inspect the shared host-level Codex auth status and fallback behavior. Admin-only read.'),
});

const adminGetGovernanceReviewStatusSchema = z.object({
  action: z.literal('get_governance_review_status').describe('Inspect where governance review cards are routed for this server. Admin-only read.'),
});

const adminGetInvokeThreadStatusSchema = z.object({
  action: z.literal('get_invoke_thread_status').describe('Inspect which channels automatically route fresh Sage invokes into public message threads. Admin-only read.'),
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

const adminEnableInvokeThreadChannelSchema = z.object({
  action: z.literal('enable_invoke_thread_channel').describe('Route fresh Sage invokes in a text or announcement channel into a public message thread. Admin-only write. Disabled in autopilot turns.'),
  channelId: z.string().trim().min(1).max(64),
  autoArchiveDurationMinutes: discordThreadAutoArchiveDurationSchema.optional(),
});

const adminDisableInvokeThreadChannelSchema = z.object({
  action: z.literal('disable_invoke_thread_channel').describe('Disable automatic thread-on-invoke routing for a channel. Admin-only write. Disabled in autopilot turns.'),
  channelId: z.string().trim().min(1).max(64),
});

const adminGetArtifactVaultStatusSchema = z.object({
  action: z.literal('get_artifact_vault_status').describe('Inspect where Sage publishes default artifact vault posts for this server. Admin-only read.'),
});

const adminSetArtifactVaultChannelSchema = z.object({
  action: z.literal('set_artifact_vault_channel').describe('Route default artifact publications to a specific text channel or thread. Admin-only write. Disabled in autopilot turns.'),
  channelId: z.string().trim().min(1).max(64),
});

const adminClearArtifactVaultChannelSchema = z.object({
  action: z.literal('clear_artifact_vault_channel').describe('Clear the dedicated artifact vault channel so artifact publishes default to the active channel unless a target is provided. Admin-only write. Disabled in autopilot turns.'),
});

const adminGetModLogStatusSchema = z.object({
  action: z.literal('get_mod_log_status').describe('Inspect where Sage posts default moderation log alerts for this server. Admin-only read.'),
});

const adminSetModLogChannelSchema = z.object({
  action: z.literal('set_mod_log_channel').describe('Route default moderation log alerts to a specific text channel or thread. Admin-only write. Disabled in autopilot turns.'),
  channelId: z.string().trim().min(1).max(64),
});

const adminClearModLogChannelSchema = z.object({
  action: z.literal('clear_mod_log_channel').describe('Clear the dedicated moderation log channel so Sage only uses explicit policy notification channels. Admin-only write. Disabled in autopilot turns.'),
});

const adminSendKeySetupCardSchema = z.object({
  action: z.literal('send_key_setup_card').describe('Send an interactive server-key setup card in the current channel. Admin-only write. Disabled in autopilot turns.'),
});

const adminSendHostAuthStatusCardSchema = z.object({
  action: z.literal('send_host_auth_status_card').describe('Post a host-auth status card in the current channel. Admin-only write. Disabled in autopilot turns.'),
});

const discordContextToolDefs = [
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
    name: 'discord_governance_get_server_instructions',
    title: 'Discord Context Get Server Instructions',
    description: 'Read the current guild Sage Persona instructions.',
    schema: instructionsGetServerSchema,
    domain: 'discord_context',
    executeDomain: executeDiscordContextAction,
    readOnly: true,
    capabilityTags: ['context', 'persona'],
    promptSummary: 'Use to read the current guild persona or behavior overlay.',
  }),
] as const;

const discordMessageTools = [
  defineDiscordActionTool({
    name: 'discord_history_search_history',
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
    name: 'discord_history_search_with_context',
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
    name: 'discord_history_get_context',
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
    name: 'discord_history_search_guild',
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
    name: 'discord_history_get_user_timeline',
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
    name: 'discord_spaces_create_poll',
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
    name: 'discord_spaces_add_reaction',
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
    name: 'discord_spaces_remove_self_reaction',
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

const discordFileTools = [
  defineDiscordActionTool({
    name: 'discord_artifact_list_channel_attachments',
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
    name: 'discord_artifact_list_guild_attachments',
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
    name: 'discord_artifact_find_channel_attachments',
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
    name: 'discord_artifact_find_guild_attachments',
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
    name: 'discord_artifact_read_attachment',
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
    name: 'discord_artifact_list',
    title: 'Discord Artifact List',
    description: 'List stored Discord artifacts in the active guild or origin channel.',
    schema: artifactListSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: true,
    capabilityTags: ['artifact'],
    promptSummary: 'Use to inspect the durable Discord artifact inventory.',
  }),
  defineDiscordActionTool({
    name: 'discord_artifact_get',
    title: 'Discord Artifact Get',
    description: 'Retrieve one Discord artifact and its latest revision metadata.',
    schema: artifactGetSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: true,
    capabilityTags: ['artifact'],
    promptSummary: 'Use to inspect one artifact and its latest revision.',
  }),
  defineDiscordActionTool({
    name: 'discord_artifact_stage_attachment',
    title: 'Discord Artifact Stage Attachment',
    description: 'Turn an ingested Discord attachment into a durable Sage artifact revision.',
    schema: artifactStageAttachmentSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    access: 'admin',
    readOnly: false,
    observationPolicy: 'artifact-only',
    capabilityTags: ['artifact', 'attachments'],
    promptSummary: 'Use to stage a known ingested attachment into the artifact lifecycle.',
  }),
  defineDiscordActionTool({
    name: 'discord_artifact_create_text',
    title: 'Discord Artifact Create Text',
    description: 'Create a new text or structured-text artifact.',
    schema: artifactCreateTextSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    access: 'admin',
    readOnly: false,
    observationPolicy: 'artifact-only',
    capabilityTags: ['artifact'],
    promptSummary: 'Use to create a new durable text-first Discord artifact.',
  }),
  defineDiscordActionTool({
    name: 'discord_artifact_replace',
    title: 'Discord Artifact Replace',
    description: 'Create a new revision for an existing artifact from text or an existing attachment.',
    schema: artifactReplaceSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    access: 'admin',
    readOnly: false,
    observationPolicy: 'artifact-only',
    capabilityTags: ['artifact'],
    promptSummary: 'Use to add a new revision to an existing artifact.',
  }),
  defineDiscordActionTool({
    name: 'discord_artifact_publish',
    title: 'Discord Artifact Publish',
    description: 'Publish the latest artifact revision into a Discord channel or thread.',
    schema: artifactPublishSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    access: 'admin',
    readOnly: false,
    observationPolicy: 'artifact-only',
    capabilityTags: ['artifact'],
    promptSummary: 'Use to publish the latest artifact revision to Discord.',
  }),
  defineDiscordActionTool({
    name: 'discord_artifact_list_revisions',
    title: 'Discord Artifact List Revisions',
    description: 'List recent revisions for one artifact.',
    schema: artifactListRevisionsSchema,
    domain: 'discord_files',
    executeDomain: executeDiscordFilesAction,
    readOnly: true,
    capabilityTags: ['artifact'],
    promptSummary: 'Use to inspect revision history for a durable artifact.',
  }),
] as const;

const discordServerTools = [
  defineDiscordActionTool({
    name: 'discord_spaces_list_channels',
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
    name: 'discord_spaces_get_channel',
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
    name: 'discord_spaces_list_roles',
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
    name: 'discord_spaces_list_threads',
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
    name: 'discord_spaces_get_thread',
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
    name: 'discord_spaces_list_scheduled_events',
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
    name: 'discord_spaces_get_scheduled_event',
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
    name: 'discord_moderation_list_members',
    title: 'Discord Server List Members',
    description: 'List guild members for inspection, moderation context, or membership lookup.',
    schema: serverListMembersSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'members', 'moderation'],
    promptSummary: 'Use for guild member inspection.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_get_member',
    title: 'Discord Server Get Member',
    description: 'Retrieve one guild member.',
    schema: serverGetMemberSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'members', 'moderation'],
    promptSummary: 'Use for one guild member’s details.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_get_permission_snapshot',
    title: 'Discord Server Get Permission Snapshot',
    description: 'Resolve permissions for a user or role in a specific channel.',
    schema: serverPermissionSnapshotSchema,
    modelInputSchema: serverPermissionSnapshotInputSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'permissions', 'moderation'],
    promptSummary: 'Use for resolved permission snapshots in one channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_list_automod_rules',
    title: 'Discord Server List Automod Rules',
    description: 'List AutoMod rules for the active guild.',
    schema: serverListAutomodRulesSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'moderation'],
    promptSummary: 'Use to inspect AutoMod rules.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_list_policies',
    title: 'Discord Server List Moderation Policies',
    description: 'List Sage moderation policies and imported external AutoMod inventory.',
    schema: serverListModerationPoliciesSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'moderation'],
    promptSummary: 'Use to inspect moderation policy inventory.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_get_policy',
    title: 'Discord Server Get Moderation Policy',
    description: 'Retrieve one moderation policy by id or name.',
    schema: serverGetModerationPolicySchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'moderation'],
    promptSummary: 'Use to inspect one moderation policy.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_list_cases',
    title: 'Discord Server List Moderation Cases',
    description: 'List recent moderation cases for the guild.',
    schema: serverListModerationCasesSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'moderation'],
    promptSummary: 'Use to inspect autonomous and manual moderation case history.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_get_case',
    title: 'Discord Moderation Get Case',
    description: 'Retrieve one moderation case and its notes.',
    schema: serverGetModerationCaseSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'moderation'],
    promptSummary: 'Use to inspect one moderation case and its notes.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_get_member_history',
    title: 'Discord Moderation Get Member History',
    description: 'Retrieve moderation history for one guild member.',
    schema: serverGetModerationMemberHistorySchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'moderator',
    capabilityTags: ['server', 'moderation'],
    promptSummary: 'Use to inspect strike and case history for one member.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_list_tasks',
    title: 'Discord Server List Scheduled Tasks',
    description: 'List configured scheduled reminders and scheduled Sage jobs.',
    schema: serverListScheduledTasksSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['server', 'scheduler'],
    promptSummary: 'Use to inspect scheduled tasks for the guild.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_get_task',
    title: 'Discord Server Get Scheduled Task',
    description: 'Retrieve one scheduled task and its recent execution history.',
    schema: serverGetScheduledTaskSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['server', 'scheduler'],
    promptSummary: 'Use to inspect one scheduled task in detail.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_create_thread',
    title: 'Discord Server Create Thread',
    description: 'Create a Discord thread.',
    schema: threadsCreateSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    access: 'admin',
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to create a thread.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_update_thread',
    title: 'Discord Server Update Thread',
    description: 'Rename or change archive or lock settings for a thread.',
    schema: serverUpdateThreadSchema,
    modelInputSchema: serverUpdateThreadInputSchema,
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    access: 'admin',
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to update thread settings.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_join_thread',
    title: 'Discord Server Join Thread',
    description: 'Join an existing Discord thread as Sage so later thread-scoped actions can proceed.',
    schema: serverThreadMembershipSchema('join_thread', 'Join a thread as Sage. Disabled in autopilot turns.'),
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    access: 'admin',
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to join a thread.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_leave_thread',
    title: 'Discord Server Leave Thread',
    description: 'Leave an existing Discord thread as Sage after thread-scoped work is complete.',
    schema: serverThreadMembershipSchema('leave_thread', 'Leave a thread as Sage. Disabled in autopilot turns.'),
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    access: 'admin',
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to leave a thread.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_add_thread_member',
    title: 'Discord Server Add Thread Member',
    description: 'Add a member to a thread.',
    schema: serverThreadMemberActionSchema('add_thread_member', 'Add a member to a thread. Disabled in autopilot turns.'),
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    access: 'admin',
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to add a member to a thread.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_remove_thread_member',
    title: 'Discord Server Remove Thread Member',
    description: 'Remove a member from a thread.',
    schema: serverThreadMemberActionSchema('remove_thread_member', 'Remove a member from a thread. Disabled in autopilot turns.'),
    domain: 'discord_server',
    executeDomain: executeDiscordServerAction,
    access: 'admin',
    readOnly: false,
    capabilityTags: ['server', 'threads'],
    promptSummary: 'Use to remove a member from a thread.',
  }),
] as const;

const discordAdminTools = [
  defineDiscordActionTool({
    name: 'discord_governance_get_server_key_status',
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
    name: 'discord_governance_get_host_auth_status',
    title: 'Discord Admin Get Host Auth Status',
    description: 'Inspect the shared host-level Codex auth status and fallback behavior.',
    schema: adminGetHostAuthStatusSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['admin', 'governance'],
    promptSummary: 'Use to inspect the shared host auth state for this deployment.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_get_review_status',
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
    name: 'discord_governance_get_invoke_thread_status',
    title: 'Discord Admin Get Invoke Thread Status',
    description: 'Inspect which channels auto-route Sage invokes into public message threads.',
    schema: adminGetInvokeThreadStatusSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'threads'],
    promptSummary: 'Use to inspect thread-on-invoke routing for this server.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_get_artifact_vault_status',
    title: 'Discord Admin Get Artifact Vault Status',
    description: 'Inspect where Sage publishes default artifact vault posts.',
    schema: adminGetArtifactVaultStatusSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'artifact'],
    promptSummary: 'Use to inspect default artifact vault routing.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_get_mod_log_status',
    title: 'Discord Admin Get Mod Log Status',
    description: 'Inspect where Sage posts default moderation log alerts.',
    schema: adminGetModLogStatusSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'moderation'],
    promptSummary: 'Use to inspect default moderation log routing.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_get_invite_url',
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
    name: 'discord_spaces_list_invites',
    title: 'Discord Admin List Invites',
    description: 'List active guild or channel invites.',
    schema: adminListInvitesSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: true,
    access: 'admin',
    capabilityTags: ['admin', 'invites'],
    promptSummary: 'Use to inspect active invite codes before creating or revoking one.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_create_invite',
    title: 'Discord Admin Create Invite',
    description: 'Create a new invite for a channel.',
    schema: adminCreateInviteSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'invites'],
    promptSummary: 'Use to create a channel invite under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_revoke_invite',
    title: 'Discord Admin Revoke Invite',
    description: 'Revoke an invite by its code.',
    schema: adminRevokeInviteSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'invites'],
    promptSummary: 'Use to revoke an invite by code under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_create_scheduled_event',
    title: 'Discord Admin Create Scheduled Event',
    description: 'Create a scheduled event for the guild.',
    schema: adminCreateScheduledEventSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'events'],
    promptSummary: 'Use to create a scheduled event under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_update_scheduled_event',
    title: 'Discord Admin Update Scheduled Event',
    description: 'Update a scheduled event for the guild.',
    schema: adminUpdateScheduledEventSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'events'],
    promptSummary: 'Use to update an existing scheduled event under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_delete_scheduled_event',
    title: 'Discord Admin Delete Scheduled Event',
    description: 'Delete a scheduled event for the guild.',
    schema: adminDeleteScheduledEventSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'events'],
    promptSummary: 'Use to delete a scheduled event under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_create_forum_post',
    title: 'Discord Admin Create Forum Post',
    description: 'Create a forum post in a forum channel.',
    schema: adminCreateForumPostSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    observationPolicy: 'artifact-only',
    capabilityTags: ['admin', 'forum', 'threads', 'artifact'],
    promptSummary: 'Use to create a forum post under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_update_forum_tags',
    title: 'Discord Admin Update Forum Tags',
    description: 'Replace the applied tags on a forum thread.',
    schema: adminUpdateForumTagsSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'forum', 'threads'],
    promptSummary: 'Use to replace forum tags on a managed thread under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_archive_thread',
    title: 'Discord Admin Archive Thread',
    description: 'Archive a thread explicitly.',
    schema: adminArchiveThreadSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'threads'],
    promptSummary: 'Use to archive a thread under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_reopen_thread',
    title: 'Discord Admin Reopen Thread',
    description: 'Reopen an archived thread explicitly.',
    schema: adminReopenThreadSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'threads'],
    promptSummary: 'Use to reopen an archived thread under admin approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_clear_server_api_key',
    title: 'Discord Admin Clear Server Api Key',
    description: 'Clear the current server-wide API key.',
    schema: adminClearServerApiKeySchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'owner',
    capabilityTags: ['admin', 'governance'],
    promptSummary: 'Use to clear the server-wide API key.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_set_review_channel',
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
    name: 'discord_governance_enable_invoke_thread_channel',
    title: 'Discord Admin Enable Invoke Thread Channel',
    description: 'Route fresh Sage invokes in a channel into a public message thread.',
    schema: adminEnableInvokeThreadChannelSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'threads'],
    promptSummary: 'Use to enable automatic thread-on-invoke routing for a channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_set_artifact_vault_channel',
    title: 'Discord Admin Set Artifact Vault Channel',
    description: 'Route default artifact publications to a specific text channel or thread.',
    schema: adminSetArtifactVaultChannelSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'artifact'],
    promptSummary: 'Use to configure the default artifact vault channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_set_mod_log_channel',
    title: 'Discord Admin Set Mod Log Channel',
    description: 'Route default moderation log alerts to a specific text channel or thread.',
    schema: adminSetModLogChannelSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'moderation'],
    promptSummary: 'Use to configure the default moderation log channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_clear_review_channel',
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
    name: 'discord_governance_disable_invoke_thread_channel',
    title: 'Discord Admin Disable Invoke Thread Channel',
    description: 'Disable automatic thread-on-invoke routing for a channel.',
    schema: adminDisableInvokeThreadChannelSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'threads'],
    promptSummary: 'Use to disable automatic thread-on-invoke routing for a channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_clear_artifact_vault_channel',
    title: 'Discord Admin Clear Artifact Vault Channel',
    description: 'Clear the dedicated artifact vault channel override.',
    schema: adminClearArtifactVaultChannelSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'artifact'],
    promptSummary: 'Use to clear the default artifact vault channel override.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_clear_mod_log_channel',
    title: 'Discord Admin Clear Mod Log Channel',
    description: 'Clear the dedicated moderation log channel override.',
    schema: adminClearModLogChannelSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'governance', 'moderation'],
    promptSummary: 'Use to clear the default moderation log channel override.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_send_key_setup_card',
    title: 'Discord Admin Send Key Setup Card',
    description: 'Send an interactive server-key setup card.',
    schema: adminSendKeySetupCardSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'owner',
    observationPolicy: 'artifact-only',
    capabilityTags: ['admin', 'artifact'],
    promptSummary: 'Use to send the server-key setup card artifact.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_send_host_auth_status_card',
    title: 'Discord Admin Send Host Auth Status Card',
    description: 'Post the current host auth status in the active channel.',
    schema: adminSendHostAuthStatusCardSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    observationPolicy: 'artifact-only',
    capabilityTags: ['admin', 'governance'],
    promptSummary: 'Use to post a host auth status card for operators in the current channel.',
  }),
  defineDiscordActionTool({
    name: 'discord_governance_update_server_instructions',
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
    name: 'discord_moderation_submit_action',
    title: 'Discord Admin Submit Moderation',
    description: 'Submit a moderation or enforcement request.',
    schema: z.object({
      action: z.literal('submit_moderation').describe('Submit a moderation or enforcement request.'),
      request: discordModerationActionRequestSchema,
    }),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'moderator',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use for moderation or enforcement actions that need approval.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_upsert_policy',
    title: 'Discord Admin Upsert Moderation Policy',
    description: 'Create or update an autonomous moderation policy.',
    schema: adminUpsertModerationPolicySchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to create or update deterministic moderation policy rules.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_disable_policy',
    title: 'Discord Admin Disable Moderation Policy',
    description: 'Disable an existing moderation policy.',
    schema: adminDisableModerationPolicySchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to disable a moderation policy without deleting its case history.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_ack_case',
    title: 'Discord Moderation Acknowledge Case',
    description: 'Acknowledge a moderation case for follow-up.',
    schema: moderationCaseIdSchema(
      'acknowledge_moderation_case',
      'Acknowledge a moderation case. Moderator-or-admin write. Disabled in autopilot turns.',
    ),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'moderator',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to acknowledge a moderation case before working it.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_resolve_case',
    title: 'Discord Moderation Resolve Case',
    description: 'Resolve or void a moderation case.',
    schema: moderationResolveCaseSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'moderator',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to resolve or void a moderation case with an explicit outcome.',
  }),
  defineDiscordActionTool({
    name: 'discord_moderation_add_case_note',
    title: 'Discord Moderation Add Case Note',
    description: 'Add a moderator note to a moderation case.',
    schema: moderationCaseNoteSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'moderator',
    capabilityTags: ['admin', 'moderation'],
    promptSummary: 'Use to record moderator notes on a moderation case.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_upsert_task',
    title: 'Discord Admin Upsert Scheduled Task',
    description: 'Create or update a scheduled reminder or scheduled Sage job.',
    schema: adminUpsertScheduledTaskSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'scheduler'],
    promptSummary: 'Use to create or update durable scheduled reminders and scheduled Sage runs.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_cancel_task',
    title: 'Discord Admin Cancel Scheduled Task',
    description: 'Cancel a scheduled reminder or scheduled Sage job.',
    schema: adminCancelScheduledTaskSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'scheduler'],
    promptSummary: 'Use to cancel an existing scheduled task.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_pause_task',
    title: 'Discord Schedule Pause Task',
    description: 'Pause an active scheduled task.',
    schema: schedulerTaskActionSchema(
      'pause_scheduled_task',
      'Pause a scheduled task. Admin-only write. Disabled in autopilot turns.',
    ),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'scheduler'],
    promptSummary: 'Use to pause a scheduled task without cancelling it.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_resume_task',
    title: 'Discord Schedule Resume Task',
    description: 'Resume a paused scheduled task.',
    schema: schedulerTaskActionSchema(
      'resume_scheduled_task',
      'Resume a scheduled task. Admin-only write. Disabled in autopilot turns.',
    ),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'scheduler'],
    promptSummary: 'Use to resume a paused scheduled task.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_run_now',
    title: 'Discord Schedule Run Now',
    description: 'Run a scheduled task immediately.',
    schema: schedulerTaskActionSchema(
      'run_scheduled_task_now',
      'Run a scheduled task immediately. Admin-only write. Disabled in autopilot turns.',
    ),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'scheduler'],
    promptSummary: 'Use to trigger a scheduled task immediately.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_skip_next',
    title: 'Discord Schedule Skip Next',
    description: 'Skip the next scheduled run for a task.',
    schema: schedulerTaskActionSchema(
      'skip_scheduled_task_next_run',
      'Skip the next scheduled task run. Admin-only write. Disabled in autopilot turns.',
    ),
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'scheduler'],
    promptSummary: 'Use to skip the next run for a scheduled task.',
  }),
  defineDiscordActionTool({
    name: 'discord_schedule_clone_task',
    title: 'Discord Schedule Clone Task',
    description: 'Clone an existing scheduled task.',
    schema: schedulerCloneTaskSchema,
    domain: 'discord_admin',
    executeDomain: executeDiscordAdminAction,
    readOnly: false,
    access: 'admin',
    capabilityTags: ['admin', 'scheduler'],
    promptSummary: 'Use to clone an existing scheduled task into a new one.',
  }),
  defineDiscordActionTool({
    name: 'discord_spaces_edit_message',
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
    name: 'discord_spaces_delete_message',
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
    name: 'discord_spaces_pin_message',
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
    name: 'discord_spaces_unpin_message',
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
    name: 'discord_spaces_create_channel',
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
    name: 'discord_spaces_edit_channel',
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
    name: 'discord_spaces_create_role',
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
    name: 'discord_spaces_edit_role',
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
    name: 'discord_spaces_delete_role',
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
    name: 'discord_spaces_add_member_role',
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
    name: 'discord_spaces_remove_member_role',
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
] as const;

const discordToolSurface = [
  ...discordContextToolDefs,
  ...discordMessageTools,
  ...discordFileTools,
  ...discordServerTools,
  ...discordAdminTools,
] as const;

export const discordContextTools = discordToolSurface.filter((tool) =>
  tool.name.startsWith('discord_context_'),
);

export const discordHistoryTools = discordToolSurface.filter((tool) =>
  tool.name.startsWith('discord_history_'),
);

export const discordArtifactTools = discordToolSurface.filter((tool) =>
  tool.name.startsWith('discord_artifact_'),
);

export const discordModerationTools = discordToolSurface.filter((tool) =>
  tool.name.startsWith('discord_moderation_'),
);

export const discordScheduleTools = discordToolSurface.filter((tool) =>
  tool.name.startsWith('discord_schedule_'),
);

export const discordSpacesTools = discordToolSurface.filter((tool) =>
  tool.name.startsWith('discord_spaces_'),
);

export const discordGovernanceTools = discordToolSurface.filter((tool) =>
  tool.name.startsWith('discord_governance_'),
);

export const discordTools = discordToolSurface;

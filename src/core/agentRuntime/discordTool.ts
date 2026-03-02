import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from './toolRegistry';
import {
  lookupUserMemory,
  lookupChannelMemory,
  searchChannelArchives,
  searchChannelMessages,
  lookupChannelMessage,
  lookupChannelFileCache,
  lookupServerFileCache,
  searchAttachmentChunksInChannel,
  searchAttachmentChunksInGuild,
  lookupSocialGraph,
  lookupVoiceAnalytics,
  lookupVoiceSessionSummaries,
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
import { discordRestRequest } from '../discord/discordRest';
import { config } from '../../config';

const requiredThinkField = z
  .string()
  .describe(
    'Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.',
  );

const discordToolSchema = z.discriminatedUnion('action', [
  z.object({
    think: requiredThinkField,
    action: z.literal('help'),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.get_user'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxChars: z.number().int().min(200).max(8_000).optional(),
    maxItemsPerSection: z.number().int().min(1).max(10).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.get_channel'),
    maxChars: z.number().int().min(200).max(12_000).optional(),
    maxItemsPerList: z.number().int().min(1).max(12).optional(),
    maxRecentFiles: z.number().int().min(1).max(20).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.search_channel_archives'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.get_server'),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('memory.queue_server_update'),
    request: serverMemoryUpdateRequestSchema,
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.lookup_channel'),
    query: z.string().trim().min(1).max(200).optional(),
    messageId: z.string().trim().min(1).max(64).optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    includeContent: z.boolean().optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.lookup_server'),
    query: z.string().trim().min(1).max(200).optional(),
    messageId: z.string().trim().min(1).max(64).optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    includeContent: z.boolean().optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.search_channel'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('files.search_server'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.search_history'),
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
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.get_context'),
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
    action: z.literal('analytics.get_social_graph'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxEdges: z.number().int().min(1).max(30).optional(),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('analytics.get_voice_analytics'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('analytics.get_voice_session_summaries'),
    voiceChannelId: z.string().trim().min(1).max(64).optional(),
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.send'),
    channelId: z.string().trim().min(1).max(64).optional(),
    content: z.string().trim().min(1).max(8_000),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.edit'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    content: z.string().trim().min(1).max(2_000),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.delete'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.pin'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('messages.unpin'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('channels.create'),
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
    action: z.literal('channels.edit'),
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
    action: z.literal('roles.create'),
    name: z.string().trim().min(1).max(100),
    colorHex: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    permissions: z.string().trim().regex(/^\d+$/).optional(),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('roles.edit'),
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
    action: z.literal('roles.delete'),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('members.add_role'),
    userId: z.string().trim().min(1).max(64),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('members.remove_role'),
    userId: z.string().trim().min(1).max(64),
    roleId: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('oauth2.get_bot_invite_url'),
    permissions: z.union([z.string().trim().regex(/^\d+$/), z.number().int().min(0)]).optional(),
    scopes: z.array(z.enum(['bot', 'applications.commands'])).min(1).max(4).optional(),
    guildId: z.string().trim().min(1).max(64).optional(),
    disableGuildSelect: z.boolean().optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('polls.create'),
    channelId: z.string().trim().min(1).max(64).optional(),
    question: z.string().trim().min(1).max(300),
    answers: z.array(z.string().trim().min(1).max(55)).min(2).max(10),
    durationHours: z.number().int().min(1).max(768).optional(),
    allowMultiselect: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('threads.create'),
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
    action: z.literal('reactions.add'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    emoji: z.string().trim().min(1).max(128),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('reactions.remove_self'),
    channelId: z.string().trim().min(1).max(64).optional(),
    messageId: z.string().trim().min(1).max(64),
    emoji: z.string().trim().min(1).max(128),
    reason: z.string().trim().max(500).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('moderation.queue'),
    request: discordModerationActionRequestSchema,
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('rest'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().trim().min(1).max(2_000),
    query: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional(),
    body: z.unknown().optional(),
    multipartBodyMode: z.enum(['payload_json', 'fields']).optional(),
    files: z
      .array(
        z.object({
          fieldName: z.string().trim().min(1).max(120).optional(),
          filename: z.string().trim().min(1).max(255),
          contentType: z.string().trim().min(1).max(200).optional(),
          source: z.discriminatedUnion('type', [
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
          ]),
        }),
      )
      .min(1)
      .max(10)
      .optional(),
    reason: z.string().trim().max(500).optional(),
    maxResponseChars: z.number().int().min(500).max(50_000).optional(),
  }),
]);

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
    case 'memory.search_channel_archives':
    case 'memory.get_server':
    case 'files.lookup_channel':
    case 'files.lookup_server':
    case 'files.search_channel':
    case 'files.search_server':
    case 'messages.search_history':
    case 'messages.get_context':
    case 'analytics.get_social_graph':
    case 'analytics.get_voice_analytics':
    case 'analytics.get_voice_session_summaries':
    case 'oauth2.get_bot_invite_url':
      return true;
    case 'rest': {
      const method = (args as Record<string, unknown>).method;
      return typeof method === 'string' && method.toUpperCase() === 'GET';
    }
    default:
      return false;
  }
}

export const discordTool: ToolDefinition<DiscordToolArgs> = {
  name: 'discord',
  description:
    [
      'Unified Discord tool for Sage: memory, retrieval, safe interactions, moderation queue, and admin-only REST passthrough.',
      '<USE_ONLY_WHEN> You need to read or change Discord state, or query Sage’s Discord-backed memory (summaries/files/messages/social graph/voice analytics). </USE_ONLY_WHEN>',
      'Safety:',
      '- Autopilot turns must not perform writes.',
      '- Moderation and server-memory updates require admin privileges and are approval-gated.',
      '- REST passthrough is admin-only; GET executes immediately, non-GET requires approval.',
    ].join('\n'),
  schema: discordToolSchema,
  metadata: {
    readOnlyPredicate: (args) => isReadOnlyDiscordToolCall(args),
  },
  execute: async (args, ctx) => {
    switch (args.action) {
      case 'help': {
        return {
          tool: 'discord',
          actions: [
            'memory.get_user',
            'memory.get_channel',
            'memory.search_channel_archives',
            'memory.get_server',
            'memory.queue_server_update',
            'files.lookup_channel',
            'files.lookup_server',
            'files.search_channel',
            'files.search_server',
            'messages.search_history',
            'messages.get_context',
            'analytics.get_social_graph',
            'analytics.get_voice_analytics',
            'analytics.get_voice_session_summaries',
            'messages.send',
            'messages.edit',
            'messages.delete',
            'messages.pin',
            'messages.unpin',
            'channels.create',
            'channels.edit',
            'roles.create',
            'roles.edit',
            'roles.delete',
            'members.add_role',
            'members.remove_role',
            'oauth2.get_bot_invite_url',
            'polls.create',
            'threads.create',
            'reactions.add',
            'reactions.remove_self',
            'moderation.queue',
            'rest',
          ],
          notes: [
            'Some actions require a guild context.',
            'Server-wide file actions and REST are disabled in autopilot turns.',
            'Non-GET REST requests require admin approval.',
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

      case 'memory.search_channel_archives': {
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

      case 'memory.queue_server_update': {
        assertAdmin(ctx.invokerIsAdmin);
        assertNotAutopilot(ctx.invokedBy, 'memory.queue_server_update');
        const guildId = requireGuildContext(ctx.guildId);
        return requestServerMemoryUpdateForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          request: args.request,
        });
      }

      case 'files.lookup_channel': {
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

      case 'files.lookup_server': {
        assertNotAutopilot(ctx.invokedBy, 'files.lookup_server');
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

      case 'files.search_channel': {
        return searchAttachmentChunksInChannel({
          guildId: ctx.guildId ?? null,
          channelId: ctx.channelId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
        });
      }

      case 'files.search_server': {
        assertNotAutopilot(ctx.invokedBy, 'files.search_server');
        return searchAttachmentChunksInGuild({
          guildId: ctx.guildId ?? null,
          requesterUserId: ctx.userId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
        });
      }

      case 'messages.search_history': {
        const targetChannelId = (args.channelId?.trim() || ctx.channelId).trim();
        if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
          throw new Error('Cross-channel message history search is disabled in autopilot turns.');
        }
        return searchChannelMessages({
          guildId: ctx.guildId ?? null,
          channelId: targetChannelId,
          requesterUserId: ctx.userId,
          query: args.query,
          topK: args.topK,
          maxChars: args.maxChars,
          mode: args.mode,
          regexPattern: args.regexPattern,
          sinceIso: args.sinceIso,
          untilIso: args.untilIso,
        });
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

      case 'analytics.get_social_graph': {
        return lookupSocialGraph({
          guildId: ctx.guildId ?? null,
          userId: args.userId?.trim() || ctx.userId,
          maxEdges: args.maxEdges,
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

      case 'analytics.get_voice_session_summaries': {
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

      case 'oauth2.get_bot_invite_url': {
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
          action: 'oauth2.get_bot_invite_url',
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

      case 'moderation.queue': {
        assertAdmin(ctx.invokerIsAdmin);
        assertNotAutopilot(ctx.invokedBy, 'moderation.queue');
        const guildId = requireGuildContext(ctx.guildId);
        return requestDiscordAdminActionForTool({
          guildId,
          channelId: ctx.channelId,
          requestedBy: ctx.userId,
          request: args.request,
        });
      }

      case 'rest': {
        assertAdmin(ctx.invokerIsAdmin);
        assertNotAutopilot(ctx.invokedBy, 'discord.rest');
        requireGuildContext(ctx.guildId);

        if (args.method === 'GET') {
          if (args.files?.length) {
            throw new Error('discord.rest GET requests cannot include files.');
          }
          return discordRestRequest({
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

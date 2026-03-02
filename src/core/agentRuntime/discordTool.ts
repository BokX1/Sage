import { z } from 'zod';
import type { ToolDefinition } from './toolRegistry';
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
} from '../../bot/admin/adminActionService';
import { discordRestRequest } from '../discord/discordRest';

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

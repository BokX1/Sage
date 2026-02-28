import { z } from 'zod';
import { ToolDefinition, ToolRegistry, globalToolRegistry } from './toolRegistry';
import {
  type SearchDepth,
  generateImage,
  lookupChannelMessage,
  lookupChannelMemory,
  searchChannelArchives,
  searchChannelMessages,
  searchAttachmentChunksInChannel,
  searchAttachmentChunksInGuild,
  lookupChannelFileCache,
  lookupServerFileCache,
  lookupGitHubFile,
  lookupGitHubCodeSearch,
  lookupGitHubRepo,
  lookupNpmPackage,
  lookupSocialGraph,
  lookupUserMemory,
  lookupVoiceAnalytics,
  lookupVoiceSessionSummaries,
  lookupWikipedia,
  runWebSearch,
  sanitizePublicUrl,
  searchStackOverflow,
  scrapeWebPage,
  runAgenticWebScrape,
} from './toolIntegrations';
import {
  discordModerationActionRequestSchema,
  discordInteractionRequestSchema,
  lookupServerMemoryForTool,
  requestDiscordAdminActionForTool,
  requestDiscordInteractionForTool,
  requestServerMemoryUpdateForTool,
  serverMemoryUpdateRequestSchema,
} from '../../bot/admin/adminActionService';


const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMPLEX_SEARCH_WEB_PROVIDER_ORDER = ['searxng', 'tavily', 'exa'] as const;
const COMPLEX_SEARCH_SCRAPE_PROVIDER_ORDER = ['crawl4ai', 'jina', 'raw_fetch', 'firecrawl'] as const;

const getCurrentDateTimeTool: ToolDefinition<{
  think: string;
  utcOffsetMinutes?: number;
}> = {
  name: 'system_get_current_datetime',
  description:
    'Get the current date and time.\n<USE_ONLY_WHEN> You explicitly need to know the current date, time, or "today" to accurately answer a scheduling or time-sensitive query. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    utcOffsetMinutes: z.number().int().min(-720).max(840).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ utcOffsetMinutes }) => {
    const now = new Date();
    if (typeof utcOffsetMinutes !== 'number') {
      return {
        isoUtc: now.toISOString(),
        unixMs: now.getTime(),
      };
    }

    const shifted = new Date(now.getTime() + utcOffsetMinutes * 60_000);
    const offsetHours = Math.trunc(utcOffsetMinutes / 60);
    const offsetMinutes = Math.abs(utcOffsetMinutes % 60);
    const sign = utcOffsetMinutes >= 0 ? '+' : '-';
    const offsetLabel = `UTC${sign}${Math.abs(offsetHours).toString().padStart(2, '0')}:${offsetMinutes
      .toString()
      .padStart(2, '0')}`;

    return {
      isoUtc: now.toISOString(),
      shiftedTimeIso: shifted.toISOString(),
      requestedOffsetMinutes: utcOffsetMinutes,
      requestedOffsetLabel: offsetLabel,
      unixMs: now.getTime(),
    };
  },
};

const webSearchTool: ToolDefinition<{
  think: string;
  query: string;
  depth?: SearchDepth;
  maxResults?: number;
}> = {
  name: 'web_search',
  description:
    'Search the web with provider-backed retrieval (Tavily/Exa + fallback) and return source-grounded results.\n<USE_ONLY_WHEN> You need up-to-date information from the internet that is not in your training data or cached memory. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    query: z.string().trim().min(2).max(400),
    depth: z.enum(['quick', 'balanced', 'deep']).optional(),
    maxResults: z.number().int().min(1).max(10).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, depth, maxResults }, ctx) => {
    const useHighSearchProfile =
      ctx.routeKind === 'search' && ctx.toolExecutionProfile === 'search_high';
    return runWebSearch({
      query,
      depth: depth ?? (useHighSearchProfile ? 'deep' : 'balanced'),
      maxResults,
      apiKey: ctx.apiKey,
      providerOrder: useHighSearchProfile ? [...COMPLEX_SEARCH_WEB_PROVIDER_ORDER] : undefined,
      allowLlmFallback: useHighSearchProfile ? false : undefined,
    });
  },
};

const userMemoryLookupTool: ToolDefinition<{
  think: string;
  userId?: string;
  maxChars?: number;
  maxItemsPerSection?: number;
}> = {
  name: 'discord_get_user_memory',
  description:
    'Retrieve long-term user memory profile summary and personalization cues for the current user.\n<USE_ONLY_WHEN> You need to recall specific long-term facts, preferences, or profile information about a user to personalize your response. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxChars: z.number().int().min(200).max(8_000).optional(),
    maxItemsPerSection: z.number().int().min(1).max(10).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ userId, maxChars, maxItemsPerSection }, ctx) => {
    return lookupUserMemory({
      userId: userId?.trim() || ctx.userId,
      maxChars,
      maxItemsPerSection,
    });
  },
};

const channelMemoryLookupTool: ToolDefinition<{
  think: string;
  maxChars?: number;
  maxItemsPerList?: number;
  maxRecentFiles?: number;
}> = {
  name: 'discord_get_channel_memory',
  description:
    'Retrieve short-term and long-term channel memory summaries plus recent cached file pointers for this channel. Scope: summary memory only, not full raw message history.\n<USE_ONLY_WHEN> You need rolling/profile summary context or recent file pointers. Use discord_search_channel_messages for exact transcript-level history. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    maxChars: z.number().int().min(200).max(12_000).optional(),
    maxItemsPerList: z.number().int().min(1).max(10).optional(),
    maxRecentFiles: z.number().int().min(1).max(20).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ maxChars, maxItemsPerList, maxRecentFiles }, ctx) => {
    return lookupChannelMemory({
      guildId: ctx.guildId ?? null,
      channelId: ctx.channelId,
      maxChars,
      maxItemsPerList,
      maxRecentFiles,
    });
  },
};

const socialGraphLookupTool: ToolDefinition<{
  think: string;
  userId?: string;
  maxEdges?: number;
  maxChars?: number;
}> = {
  name: 'discord_get_social_graph',
  description:
    'Retrieve social relationship edges and familiarity signals for the current user in the active guild.\n<USE_ONLY_WHEN> You need to determine social connections, interactions, or familiarity between users in the current community context. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxEdges: z.number().int().min(1).max(30).optional(),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ userId, maxEdges, maxChars }, ctx) => {
    return lookupSocialGraph({
      guildId: ctx.guildId ?? null,
      userId: userId?.trim() || ctx.userId,
      maxEdges,
      maxChars,
    });
  },
};

const voiceAnalyticsLookupTool: ToolDefinition<{
  think: string;
  userId?: string;
  maxChars?: number;
}> = {
  name: 'discord_get_voice_analytics',
  description:
    'Retrieve current guild voice presence and the target user voice activity summary for today.\n<USE_ONLY_WHEN> You need to check who is currently in voice channels or analyze recent voice activity metrics. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    userId: z.string().trim().min(1).max(64).optional(),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ userId, maxChars }, ctx) => {
    return lookupVoiceAnalytics({
      guildId: ctx.guildId ?? null,
      userId: userId?.trim() || ctx.userId,
      maxChars,
    });
  },
};

const voiceSessionSummariesLookupTool: ToolDefinition<{
  think: string;
  voiceChannelId?: string;
  sinceHours?: number;
  limit?: number;
  maxChars?: number;
}> = {
  name: 'discord_get_voice_session_summaries',
  description:
    'Retrieve summary-only memory for recent Discord voice sessions in this guild.\n<USE_ONLY_WHEN> You need to recall what was discussed in recent voice sessions (topics/decisions/action items). </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    voiceChannelId: z.string().trim().min(1).max(64).optional(),
    // Allow up to 90 days of lookback for persistent voice session summaries.
    sinceHours: z.number().int().min(1).max(2_160).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ voiceChannelId, sinceHours, limit, maxChars }, ctx) => {
    return lookupVoiceSessionSummaries({
      guildId: ctx.guildId ?? null,
      voiceChannelId: voiceChannelId?.trim() || undefined,
      sinceHours,
      limit,
      maxChars,
    });
  },
};

const generateImageTool: ToolDefinition<{
  think: string;
  prompt: string;
  model?: string;
  seed?: number;
  width?: number;
  height?: number;
  referenceImageUrl?: string;
}> = {
  name: 'image_generate',
  description:
    'Generate an image with Pollinations and return it as an attachment payload for the final runtime response.\n<USE_ONLY_WHEN> The user explicitly requests generating or drawing an image. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    prompt: z.string().trim().min(3).max(2_000),
    model: z.string().trim().min(1).max(120).optional(),
    seed: z.number().int().min(0).max(9_999_999).optional(),
    width: z.number().int().min(64).max(2_048).optional(),
    height: z.number().int().min(64).max(2_048).optional(),
    referenceImageUrl: z.string().trim().url().max(2_048).optional(),
  }),
  metadata: { readOnly: false },
  execute: async ({ prompt, model, seed, width, height, referenceImageUrl }, ctx) => {
    return generateImage({
      prompt,
      model,
      seed,
      width,
      height,
      referenceImageUrl,
      apiKey: ctx.apiKey,
    });
  },
};

const webScrapeTool: ToolDefinition<{
  think: string;
  url: string;
  maxChars?: number;
}> = {
  name: 'web_get_page_text',
  description:
    'Fetch and extract the main content from a URL using Crawl4AI/Firecrawl/Jina/raw fallback for grounded summarization.\n<USE_ONLY_WHEN> You have a specific URL and need to extract its raw webpage or article text content. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    url: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://'),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ url, maxChars }, ctx) => {
    const sanitizedUrl = sanitizePublicUrl(url);
    if (!sanitizedUrl) {
      throw new Error('Invalid URL');
    }
    const useHighSearchProfile =
      ctx.routeKind === 'search' && ctx.toolExecutionProfile === 'search_high';
    return scrapeWebPage({
      url: sanitizedUrl,
      maxChars,
      providerOrder: useHighSearchProfile ? [...COMPLEX_SEARCH_SCRAPE_PROVIDER_ORDER] : undefined,
    });
  },
};

const agenticWebScrapeTool: ToolDefinition<{
  think: string;
  url: string;
  instruction: string;
  maxChars?: number;
}> = {
  name: 'web_extract',
  description:
    'Agentic web scraper.\n<USE_ONLY_WHEN> You need to extract highly specific data from a URL, bypass complex page layouts, or have a webpage summarized based on explicit instructions. Do NOT use this for generic full-page dumps. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    url: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://'),
    instruction: z.string().trim().min(5).max(1_000).describe('Specific instructions for what data to extract or how to interpret the webpage.'),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ url, instruction, maxChars }) => {
    return runAgenticWebScrape({
      url,
      instruction,
      maxChars,
    });
  },
};

const githubRepoLookupTool: ToolDefinition<{
  think: string;
  repo: string;
  includeReadme?: boolean;
}> = {
  name: 'github_get_repository',
  description:
    'Lookup GitHub repository metadata (stars, default branch, language, topics) and optionally include a trimmed README.\n<USE_ONLY_WHEN> You need high-level structural metadata or the README content of a specific GitHub repository. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    repo: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .refine((value) => REPO_PATTERN.test(value), 'repo must be in owner/name format'),
    includeReadme: z.boolean().optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ repo, includeReadme }) => {
    return lookupGitHubRepo({
      repo,
      includeReadme,
    });
  },
};

const githubFileLookupTool: ToolDefinition<{
  think: string;
  repo: string;
  path: string;
  ref?: string;
  maxChars?: number;
  startLine?: number;
  endLine?: number;
  includeLineNumbers?: boolean;
}> = {
  name: 'github_get_file',
  description:
    'Fetch file contents from a public GitHub repo (or private repo with token) for targeted code/document inspection.\n<USE_ONLY_WHEN> You know the exact file path within a GitHub repository and need to read its entire source code. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    repo: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .refine((value) => REPO_PATTERN.test(value), 'repo must be in owner/name format'),
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !value.includes('..'), 'path must not contain ".." segments'),
    ref: z.string().trim().min(1).max(120).optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
    startLine: z.number().int().min(1).max(2_000_000).optional(),
    endLine: z.number().int().min(1).max(2_000_000).optional(),
    includeLineNumbers: z.boolean().optional(),
  }).superRefine((value, ctx) => {
    const hasStart = value.startLine !== undefined;
    const hasEnd = value.endLine !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startLine and endLine must both be provided for ranged lookup',
        path: hasStart ? ['endLine'] : ['startLine'],
      });
      return;
    }
    if (hasStart && hasEnd && (value.endLine as number) < (value.startLine as number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endLine must be greater than or equal to startLine',
        path: ['endLine'],
      });
    }
  }),
  metadata: { readOnly: true },
  execute: async ({ repo, path, ref, maxChars, startLine, endLine, includeLineNumbers }, ctx) => {
    return lookupGitHubFile({
      repo,
      path,
      ref,
      maxChars,
      startLine,
      endLine,
      includeLineNumbers,
      traceId: ctx.traceId,
    });
  },
};

const githubCodeSearchTool: ToolDefinition<{
  think: string;
  repo: string;
  query: string;
  ref?: string;
  regex?: string;
  pathFilter?: string;
  maxCandidates?: number;
  maxFilesToScan?: number;
  maxMatches?: number;
}> = {
  name: 'github_search_code',
  description:
    'Search files across a GitHub repository and optionally refine with regex to locate exact code matches.\n<USE_ONLY_WHEN> You know the repository but not the exact file path, or you need to find code patterns across multiple files. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    repo: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .refine((value) => REPO_PATTERN.test(value), 'repo must be in owner/name format'),
    query: z.string().trim().min(2).max(300),
    ref: z.string().trim().min(1).max(120).optional(),
    regex: z.string().trim().min(1).max(500).optional(),
    pathFilter: z.string().trim().min(1).max(300).optional(),
    maxCandidates: z.number().int().min(1).max(100).optional(),
    maxFilesToScan: z.number().int().min(1).max(100).optional(),
    maxMatches: z.number().int().min(1).max(1_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async (
    { repo, query, ref, regex, pathFilter, maxCandidates, maxFilesToScan, maxMatches },
    ctx,
  ) => {
    return lookupGitHubCodeSearch({
      repo,
      query,
      ref,
      regex,
      pathFilter,
      maxCandidates,
      maxFilesToScan,
      maxMatches,
      traceId: ctx.traceId,
    });
  },
};

const npmPackageLookupTool: ToolDefinition<{
  think: string;
  packageName: string;
  version?: string;
}> = {
  name: 'npm_get_package',
  description:
    'Lookup npm package metadata (latest version, publish time, dependency surface, maintainers, repository).\n<USE_ONLY_WHEN> You need to retrieve specific metadata, versioning, or dependency info for an npm package. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    packageName: z.string().trim().min(1).max(214),
    version: z.string().trim().min(1).max(80).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ packageName, version }) => {
    return lookupNpmPackage({
      packageName,
      version,
    });
  },
};

const channelFileLookupTool: ToolDefinition<{
  think: string;
  query?: string;
  messageId?: string;
  filename?: string;
  limit?: number;
  includeContent?: boolean;
  maxChars?: number;
}> = {
  name: 'discord_lookup_channel_files',
  description:
    'Retrieve cached non-image Discord attachment content for this channel by filename/message id.\n<USE_ONLY_WHEN> A user explicitly asks you to read or reference a file they just uploaded to the Discord channel. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    query: z.string().trim().min(1).max(200).optional(),
    messageId: z.string().trim().min(1).max(64).optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    includeContent: z.boolean().optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, messageId, filename, limit, includeContent, maxChars }, ctx) => {
    return lookupChannelFileCache({
      guildId: ctx.guildId ?? null,
      channelId: ctx.channelId,
      query,
      messageId,
      filename,
      limit,
      includeContent,
      maxChars,
    });
  },
};

const serverFileLookupTool: ToolDefinition<{
  think: string;
  query?: string;
  messageId?: string;
  filename?: string;
  limit?: number;
  includeContent?: boolean;
  maxChars?: number;
}> = {
  name: 'discord_lookup_server_files',
  description:
    'Retrieve cached non-image Discord attachment content across the active server (all channels you can access).\n<USE_ONLY_WHEN> You need to read or reference a file uploaded elsewhere in this server and the user asked for it explicitly. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    query: z.string().trim().min(1).max(200).optional(),
    messageId: z.string().trim().min(1).max(64).optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    includeContent: z.boolean().optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, messageId, filename, limit, includeContent, maxChars }, ctx) => {
    if (ctx.invokedBy === 'autopilot') {
      throw new Error('discord_lookup_server_files is disabled in autopilot turns.');
    }
    return lookupServerFileCache({
      guildId: ctx.guildId ?? null,
      requesterUserId: ctx.userId,
      query,
      messageId,
      filename,
      limit,
      includeContent,
      maxChars,
    });
  },
};

const searchAttachmentsTool: ToolDefinition<{
  think: string;
  query: string;
  topK?: number;
  maxChars?: number;
}> = {
  name: 'discord_search_channel_files',
  description:
    'Semantic search over previously cached attachment chunks for this channel. Use to find relevant passages from uploaded files.\n<USE_ONLY_WHEN> You need to search inside the text contents of files previously uploaded to this channel. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, topK, maxChars }, ctx) => {
    return searchAttachmentChunksInChannel({
      guildId: ctx.guildId ?? null,
      channelId: ctx.channelId,
      query,
      topK,
      maxChars,
    });
  },
};

const searchServerAttachmentsTool: ToolDefinition<{
  think: string;
  query: string;
  topK?: number;
  maxChars?: number;
}> = {
  name: 'discord_search_server_files',
  description:
    'Semantic search over previously cached attachment chunks across the active server (all channels you can access).\n<USE_ONLY_WHEN> You need to search inside files uploaded elsewhere in this server. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, topK, maxChars }, ctx) => {
    if (ctx.invokedBy === 'autopilot') {
      throw new Error('discord_search_server_files is disabled in autopilot turns.');
    }
    return searchAttachmentChunksInGuild({
      guildId: ctx.guildId ?? null,
      requesterUserId: ctx.userId,
      query,
      topK,
      maxChars,
    });
  },
};

const searchChannelMessagesTool: ToolDefinition<{
  think: string;
  channelId?: string;
  query: string;
  topK?: number;
  maxChars?: number;
  mode?: 'hybrid' | 'semantic' | 'lexical' | 'regex';
  regexPattern?: string;
  sinceIso?: string;
  untilIso?: string;
}> = {
  name: 'discord_search_channel_messages',
  description:
    'Search raw historical channel messages (users + bots + Sage) with hybrid semantic/lexical retrieval. Use this for exact transcript-level history. Provide channelId to target another channel you and the bot can access.\n<USE_ONLY_WHEN> You need precise historical message evidence, quotes, or specific past messages from this channel (or a specified channelId). </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    channelId: z.string().trim().min(1).max(64).optional().describe('Optional target channelId. Defaults to the current channel.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
    mode: z.enum(['hybrid', 'semantic', 'lexical', 'regex']).optional(),
    regexPattern: z.string().trim().min(1).max(500).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    untilIso: z.string().trim().min(1).max(80).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ channelId, query, topK, maxChars, mode, regexPattern, sinceIso, untilIso }, ctx) => {
    const targetChannelId = (channelId?.trim() || ctx.channelId).trim();
    if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
      throw new Error('Cross-channel message history search is disabled in autopilot turns.');
    }
    return searchChannelMessages({
      guildId: ctx.guildId ?? null,
      channelId: targetChannelId,
      requesterUserId: ctx.userId,
      query,
      topK,
      maxChars,
      mode,
      regexPattern,
      sinceIso,
      untilIso,
    });
  },
};

const channelMessageLookupTool: ToolDefinition<{
  think: string;
  channelId?: string;
  messageId: string;
  before?: number;
  after?: number;
  maxChars?: number;
}> = {
  name: 'discord_get_channel_message',
  description:
    'Lookup a specific raw channel message by messageId and optionally fetch surrounding messages for local context. Provide channelId to lookup a message in another channel you and the bot can access.\n<USE_ONLY_WHEN> You already have a messageId from discord_search_channel_messages and need neighboring context before finalizing your answer. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    channelId: z.string().trim().min(1).max(64).optional().describe('Optional target channelId. Defaults to the current channel.'),
    messageId: z.string().trim().min(1).max(64),
    before: z.number().int().min(0).max(20).optional(),
    after: z.number().int().min(0).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ channelId, messageId, before, after, maxChars }, ctx) => {
    const targetChannelId = (channelId?.trim() || ctx.channelId).trim();
    if (ctx.invokedBy === 'autopilot' && targetChannelId !== ctx.channelId) {
      throw new Error('Cross-channel message history lookup is disabled in autopilot turns.');
    }
    return lookupChannelMessage({
      guildId: ctx.guildId ?? null,
      channelId: targetChannelId,
      requesterUserId: ctx.userId,
      messageId,
      before,
      after,
      maxChars,
    });
  },
};

const searchChannelArchivesTool: ToolDefinition<{
  think: string;
  query: string;
  topK?: number;
  maxChars?: number;
}> = {
  name: 'discord_search_channel_archived_summaries',
  description:
    'Semantic search over weekly archived channel profile summaries for this channel. Scope: archived summaries only, not raw message transcripts.\n<USE_ONLY_WHEN> You need long-term historical profile context or prior weekly decisions. Use discord_search_channel_messages for exact historical messages. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    query: z.string().trim().min(2).max(500),
    topK: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(300).max(12_000).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, topK, maxChars }, ctx) => {
    return searchChannelArchives({
      guildId: ctx.guildId ?? null,
      channelId: ctx.channelId,
      query,
      topK,
      maxChars,
    });
  },
};

const wikipediaLookupTool: ToolDefinition<{
  think: string;
  query: string;
  language?: string;
  maxResults?: number;
}> = {
  name: 'wikipedia_search',
  description:
    'Lookup Wikipedia pages with snippets and canonical links for broad factual topics and fast grounding.\n<USE_ONLY_WHEN> You explicitly need historical, broadly factual, or canonical encyclopedia data. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    query: z.string().trim().min(2).max(300),
    language: z.string().trim().min(2).max(16).optional(),
    maxResults: z.number().int().min(1).max(10).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, language, maxResults }) => {
    return lookupWikipedia({
      query,
      language,
      maxResults,
    });
  },
};

const stackOverflowSearchTool: ToolDefinition<{
  think: string;
  query: string;
  maxResults?: number;
  tagged?: string;
}> = {
  name: 'stack_overflow_search',
  description:
    'Search Stack Overflow questions with accepted status and scoring metadata for coding support.\n<USE_ONLY_WHEN> You need to find proven coding solutions, debugging help, or programming Q&A. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    query: z.string().trim().min(2).max(350),
    maxResults: z.number().int().min(1).max(15).optional(),
    tagged: z.string().trim().min(1).max(120).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, maxResults, tagged }) => {
    return searchStackOverflow({
      query,
      maxResults,
      tagged,
    });
  },
};

const serverMemoryLookupTool: ToolDefinition<{
  think: string;
  maxChars?: number;
}> = {
  name: 'discord_get_server_memory',
  description:
    'Retrieve admin-authored server memory for the active guild.\n<USE_ONLY_WHEN> You need server-level role/policy/persona context that admins configured for this guild. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    maxChars: z.number().int().min(200).max(12_000).optional(),
  }),
  metadata: { readOnly: true, access: 'admin' },
  execute: async ({ maxChars }, ctx) => {
    if (!ctx.guildId) {
      return {
        found: false,
        content: 'Server memory is unavailable in DM context.',
      };
    }
    return lookupServerMemoryForTool({
      guildId: ctx.guildId,
      maxChars,
    });
  },
};

const serverMemoryUpdateRequestTool: ToolDefinition<{
  think: string;
  request: z.infer<typeof serverMemoryUpdateRequestSchema>;
}> = {
  name: 'discord_queue_server_memory_update',
  description:
    'Queue an admin-approved server memory update (set/append/clear).\n<USE_ONLY_WHEN> An admin explicitly requests changing server memory and can approve via buttons. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    request: serverMemoryUpdateRequestSchema,
  }),
  metadata: { readOnly: false, access: 'admin' },
  execute: async ({ request }, ctx) => {
    if (!ctx.invokerIsAdmin) {
      throw new Error('Admin privileges are required for server memory updates.');
    }
    if (ctx.invokedBy === 'autopilot') {
      throw new Error('discord_queue_server_memory_update is disabled in autopilot turns.');
    }
    if (!ctx.guildId) {
      throw new Error('Server memory updates require a guild context.');
    }
    return requestServerMemoryUpdateForTool({
      guildId: ctx.guildId,
      channelId: ctx.channelId,
      requestedBy: ctx.userId,
      request,
    });
  },
};

const discordAdminActionTool: ToolDefinition<{
  think: string;
  request: z.infer<typeof discordModerationActionRequestSchema>;
}> = {
  name: 'discord_queue_moderation_action',
  description:
    'Perform admin-scoped Discord moderation actions. Destructive actions require approval before execution.\n<USE_ONLY_WHEN> A guild admin explicitly requests moderation or high-authority Discord actions. Use `discord_execute_interaction` for non-destructive interactions. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    request: discordModerationActionRequestSchema,
  }),
  metadata: { readOnly: false, access: 'admin' },
  execute: async ({ request }, ctx) => {
    if (!ctx.invokerIsAdmin) {
      throw new Error('Admin privileges are required for Discord moderation actions.');
    }
    if (ctx.invokedBy === 'autopilot') {
      throw new Error('discord_queue_moderation_action is disabled in autopilot turns.');
    }
    if (!ctx.guildId) {
      throw new Error('Discord admin actions require a guild context.');
    }
    return requestDiscordAdminActionForTool({
      guildId: ctx.guildId,
      channelId: ctx.channelId,
      requestedBy: ctx.userId,
      request,
    });
  },
};

const discordInteractionTool: ToolDefinition<{
  think: string;
  request: z.infer<typeof discordInteractionRequestSchema>;
}> = {
  name: 'discord_execute_interaction',
  description:
    'Execute non-destructive Discord interactions (`create_poll`, `create_thread`, `add_reaction`, `remove_bot_reaction`, `send_message`).\n<USE_ONLY_WHEN> The user explicitly asked for one immediate interaction in this turn. Never call proactively, never chain or spam repeated actions, and never use this tool for moderation or punitive intent. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    request: discordInteractionRequestSchema,
  }),
  metadata: { readOnly: false },
  execute: async ({ request }, ctx) => {
    if (!ctx.guildId) {
      throw new Error('Discord interactions require a guild context.');
    }
    if (ctx.invokedBy === 'autopilot') {
      throw new Error('discord_execute_interaction is disabled in autopilot turns.');
    }
    return requestDiscordInteractionForTool({
      guildId: ctx.guildId,
      channelId: ctx.channelId,
      requestedBy: ctx.userId,
      invokedBy: ctx.invokedBy,
      request,
    });
  },
};

const internalReflectionTool: ToolDefinition<{
  think: string;
  hypothesis: string;
}> = {
  name: 'system_internal_reflection',
  description: 'Use this tool to pause and think logically when faced with an ambiguous situation.\n<USE_ONLY_WHEN> The user request is highly complex and you need a dedicated scratchpad to plan before answering. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    hypothesis: z.string().describe('The logical hypothesis or step-by-step plan you have formulated.'),
  }),
  metadata: { readOnly: true },
  execute: async ({ hypothesis }) => {
    return `Cognitive Loop Complete. Hypothesis logged: ${hypothesis}. Proceed with execution based on this reasoning.`;
  },
};

const DEFAULT_TOOL_DEFINITIONS = [
  getCurrentDateTimeTool,
  userMemoryLookupTool,
  channelMemoryLookupTool,
  socialGraphLookupTool,
  voiceAnalyticsLookupTool,
  voiceSessionSummariesLookupTool,
  generateImageTool,
  channelFileLookupTool,
  serverFileLookupTool,
  searchAttachmentsTool,
  searchServerAttachmentsTool,
  searchChannelMessagesTool,
  channelMessageLookupTool,
  searchChannelArchivesTool,
  webSearchTool,
  webScrapeTool,
  agenticWebScrapeTool,
  githubRepoLookupTool,
  githubCodeSearchTool,
  githubFileLookupTool,
  npmPackageLookupTool,
  wikipediaLookupTool,
  stackOverflowSearchTool,
  serverMemoryLookupTool,
  serverMemoryUpdateRequestTool,
  discordInteractionTool,
  discordAdminActionTool,
  internalReflectionTool,
] as const;

function registerIfMissing(registry: ToolRegistry, tool: ToolDefinition<unknown>): void {
  if (!registry.has(tool.name)) {
    registry.register(tool);
  }
}

export function registerDefaultAgenticTools(registry: ToolRegistry = globalToolRegistry): void {
  for (const tool of DEFAULT_TOOL_DEFINITIONS) {
    registerIfMissing(registry, tool as ToolDefinition<unknown>);
  }
}

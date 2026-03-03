/**
 * @module src/core/agentRuntime/defaultTools
 * @description Defines the default tools module.
 */
import { z } from 'zod';
import { ToolDefinition, ToolRegistry, globalToolRegistry } from './toolRegistry';
import { discordTool } from './discordTool';
import {
  type SearchDepth,
  generateImage,
  lookupGitHubFile,
  lookupGitHubCodeSearch,
  lookupGitHubRepo,
  lookupNpmPackage,
  lookupWikipedia,
  runWebSearch,
  sanitizePublicUrl,
  searchStackOverflow,
  scrapeWebPage,
  runAgenticWebScrape,
} from './toolIntegrations';


const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMPLEX_SEARCH_WEB_PROVIDER_ORDER = ['searxng', 'tavily', 'exa'] as const;
const COMPLEX_SEARCH_SCRAPE_PROVIDER_ORDER = ['crawl4ai', 'jina', 'raw_fetch', 'firecrawl'] as const;

const getCurrentDateTimeTool: ToolDefinition<{
  think: string;
  utcOffsetMinutes?: number;
}> = {
  name: 'system_time',
  description:
    'You DO NOT NEED to call this to find out the current UTC date and time—that is already constantly provided to you in your <agent_state>. However, you can call this tool to supply a strict offset calculation if you are performing complex scheduling.',
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
    query: z.string().trim().min(2).max(400).describe('The specific explicit search query to run.'),
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
    prompt: z.string().trim().min(3).max(2_000).describe('The detailed text prompt to generate the image from.'),
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
  name: 'web_read',
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
  name: 'web_scrape',
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
  name: 'github_repo',
  description:
    'Lookup GitHub repository metadata (stars, default branch, language, topics) and optionally include a trimmed README.\n<USE_ONLY_WHEN> You need high-level structural metadata or the README content of a specific GitHub repository. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    repo: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .refine((value) => REPO_PATTERN.test(value), 'repo must be in owner/name format')
      .describe('The repository name in owner/repo format (e.g. microsoft/TypeScript).'),
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
      .refine((value) => REPO_PATTERN.test(value), 'repo must be in owner/name format')
      .describe('The repository name in owner/repo format (e.g. microsoft/TypeScript).'),
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !value.includes('..'), 'path must not contain ".." segments')
      .describe('The precise file path within the repository.'),
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
      .refine((value) => REPO_PATTERN.test(value), 'repo must be in owner/name format')
      .describe('The repository name in owner/repo format (e.g. microsoft/TypeScript).'),
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
  name: 'npm_info',
  description:
    'Lookup npm package metadata (latest version, publish time, dependency surface, maintainers, repository).\n<USE_ONLY_WHEN> You need to retrieve specific metadata, versioning, or dependency info for an npm package. </USE_ONLY_WHEN>',
  schema: z.object({
    think: z.string().describe('Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.'),
    packageName: z.string().trim().min(1).max(214).describe('The exact npm package name.'),
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
    query: z.string().trim().min(2).max(300).describe('The topic or query to search for on Wikipedia.'),
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
    query: z.string().trim().min(2).max(350).describe('The explicit coding problem to search StackOverflow for.'),
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

const internalReflectionTool: ToolDefinition<{
  think: string;
  hypothesis: string;
}> = {
  name: 'system_plan',
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
  discordTool,
  generateImageTool,
  webSearchTool,
  webScrapeTool,
  agenticWebScrapeTool,
  githubRepoLookupTool,
  githubCodeSearchTool,
  githubFileLookupTool,
  npmPackageLookupTool,
  wikipediaLookupTool,
  stackOverflowSearchTool,
  internalReflectionTool,
] as const;

function registerIfMissing(registry: ToolRegistry, tool: ToolDefinition<unknown>): void {
  if (!registry.has(tool.name)) {
    registry.register(tool);
  }
}

/**
 * Runs registerDefaultAgenticTools.
 *
 * @param registry - Describes the registry input.
 * @returns Returns the function result.
 */
export function registerDefaultAgenticTools(registry: ToolRegistry = globalToolRegistry): void {
  for (const tool of DEFAULT_TOOL_DEFINITIONS) {
    registerIfMissing(registry, tool as ToolDefinition<unknown>);
  }
}

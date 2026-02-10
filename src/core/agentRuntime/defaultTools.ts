import { z } from 'zod';
import { ToolDefinition, ToolRegistry, globalToolRegistry } from './toolRegistry';
import {
  type SearchDepth,
  listLocalOllamaModels,
  lookupGitHubFile,
  lookupGitHubRepo,
  lookupNpmPackage,
  lookupWikipedia,
  runLocalLlmInfer,
  runWebSearch,
  sanitizePublicUrl,
  searchStackOverflow,
  scrapeWebPage,
} from './toolIntegrations';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const getCurrentDateTimeTool: ToolDefinition<{
  utcOffsetMinutes?: number;
}> = {
  name: 'get_current_datetime',
  description:
    'Get the current date and time. Useful for scheduling, date-sensitive answers, or "today/latest" checks.',
  schema: z.object({
    utcOffsetMinutes: z.number().int().min(-720).max(840).optional(),
  }),
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
  query: string;
  depth?: SearchDepth;
  maxResults?: number;
}> = {
  name: 'web_search',
  description:
    'Search the web with provider-backed retrieval (Tavily/Exa + fallback) and return source-grounded results.',
  schema: z.object({
    query: z.string().trim().min(2).max(400),
    depth: z.enum(['quick', 'balanced', 'deep']).optional(),
    maxResults: z.number().int().min(1).max(10).optional(),
  }),
  execute: async ({ query, depth, maxResults }, ctx) => {
    return runWebSearch({
      query,
      depth: depth ?? 'balanced',
      maxResults,
      apiKey: ctx.apiKey,
    });
  },
};

const webScrapeTool: ToolDefinition<{
  url: string;
  maxChars?: number;
}> = {
  name: 'web_scrape',
  description:
    'Fetch and extract the main content from a URL using Firecrawl/Jina/raw fallback for grounded summarization.',
  schema: z.object({
    url: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://'),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),
  execute: async ({ url, maxChars }) => {
    const sanitizedUrl = sanitizePublicUrl(url);
    if (!sanitizedUrl) {
      throw new Error('Invalid URL');
    }
    return scrapeWebPage({
      url: sanitizedUrl,
      maxChars,
    });
  },
};

const githubRepoLookupTool: ToolDefinition<{
  repo: string;
  includeReadme?: boolean;
}> = {
  name: 'github_repo_lookup',
  description:
    'Lookup GitHub repository metadata (stars, default branch, language, topics) and optionally include a trimmed README.',
  schema: z.object({
    repo: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .refine((value) => REPO_PATTERN.test(value), 'repo must be in owner/name format'),
    includeReadme: z.boolean().optional(),
  }),
  execute: async ({ repo, includeReadme }) => {
    return lookupGitHubRepo({
      repo,
      includeReadme,
    });
  },
};

const githubFileLookupTool: ToolDefinition<{
  repo: string;
  path: string;
  ref?: string;
  maxChars?: number;
}> = {
  name: 'github_file_lookup',
  description:
    'Fetch file contents from a public GitHub repo (or private repo with token) for targeted code/document inspection.',
  schema: z.object({
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
  }),
  execute: async ({ repo, path, ref, maxChars }) => {
    return lookupGitHubFile({
      repo,
      path,
      ref,
      maxChars,
    });
  },
};

const npmPackageLookupTool: ToolDefinition<{
  packageName: string;
  version?: string;
}> = {
  name: 'npm_package_lookup',
  description:
    'Lookup npm package metadata (latest version, publish time, dependency surface, maintainers, repository).',
  schema: z.object({
    packageName: z.string().trim().min(1).max(214),
    version: z.string().trim().min(1).max(80).optional(),
  }),
  execute: async ({ packageName, version }) => {
    return lookupNpmPackage({
      packageName,
      version,
    });
  },
};

const wikipediaLookupTool: ToolDefinition<{
  query: string;
  language?: string;
  maxResults?: number;
}> = {
  name: 'wikipedia_lookup',
  description:
    'Lookup Wikipedia pages with snippets and canonical links for broad factual topics and fast grounding.',
  schema: z.object({
    query: z.string().trim().min(2).max(300),
    language: z.string().trim().min(2).max(16).optional(),
    maxResults: z.number().int().min(1).max(10).optional(),
  }),
  execute: async ({ query, language, maxResults }) => {
    return lookupWikipedia({
      query,
      language,
      maxResults,
    });
  },
};

const stackOverflowSearchTool: ToolDefinition<{
  query: string;
  maxResults?: number;
  tagged?: string;
}> = {
  name: 'stack_overflow_search',
  description:
    'Search Stack Overflow questions with accepted status and scoring metadata for coding support.',
  schema: z.object({
    query: z.string().trim().min(2).max(350),
    maxResults: z.number().int().min(1).max(15).optional(),
    tagged: z.string().trim().min(1).max(120).optional(),
  }),
  execute: async ({ query, maxResults, tagged }) => {
    return searchStackOverflow({
      query,
      maxResults,
      tagged,
    });
  },
};

const localLlmModelsTool: ToolDefinition<Record<string, never>> = {
  name: 'local_llm_models',
  description: 'List available local Ollama models and metadata from the configured OLLAMA_BASE_URL.',
  schema: z.object({}),
  execute: async () => {
    return listLocalOllamaModels();
  },
};

const localLlmInferTool: ToolDefinition<{
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}> = {
  name: 'local_llm_infer',
  description:
    'Run a local inference pass through Ollama for private/offline summarization, drafting, or comparison tasks.',
  schema: z.object({
    prompt: z.string().trim().min(3).max(8_000),
    system: z.string().trim().min(1).max(2_000).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(64).max(4_096).optional(),
  }),
  execute: async ({ prompt, system, model, temperature, maxTokens }) => {
    return runLocalLlmInfer({
      prompt,
      system,
      model,
      temperature,
      maxTokens,
    });
  },
};

const DEFAULT_TOOL_DEFINITIONS = [
  getCurrentDateTimeTool,
  webSearchTool,
  webScrapeTool,
  githubRepoLookupTool,
  githubFileLookupTool,
  npmPackageLookupTool,
  wikipediaLookupTool,
  stackOverflowSearchTool,
  localLlmModelsTool,
  localLlmInferTool,
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

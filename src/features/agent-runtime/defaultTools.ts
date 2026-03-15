import { z } from 'zod';
import { ToolDefinition, ToolRegistry, globalToolRegistry } from './toolRegistry';
import {
  discordAdminTool,
  discordContextTool,
  discordFilesTool,
  discordMessagesTool,
  discordServerTool,
  discordVoiceTool,
} from './discordDomainTools';
import { webTool } from './webTool';
import { githubTool } from './githubTool';
import { workflowTool } from './workflowTool';
import { globalToolMemoStore } from './toolMemoStore';
import { globalPagedTextStore } from './pagedTextStore';
import { metrics } from '../../shared/observability/metrics';
import {
  generateImage,
  lookupNpmPackage,
  lookupWikipedia,
  searchStackOverflow,
} from './toolIntegrations';

const getCurrentDateTimeTool: ToolDefinition<{
  utcOffsetMinutes?: number;
}> = {
  name: 'system_time',
  description:
    'Calculate timezone offsets for complex scheduling. Note: current UTC time is already in <agent_state> — only call this when you need explicit offset math (e.g., converting between timezones).',
  schema: z.object({
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

function parseMetricKey(key: string): { name: string; labels: Record<string, string> } {
  const braceIndex = key.indexOf('{');
  if (braceIndex < 0) return { name: key, labels: {} };
  const name = key.slice(0, braceIndex);
  const raw = key.endsWith('}') ? key.slice(braceIndex + 1, -1) : key.slice(braceIndex + 1);
  const labels: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    labels[k] = v;
  }
  return { name, labels };
}

type ToolStatsRow = {
  tool: string;
  executions: number;
  successes: number;
  failures: Record<string, number>;
  avgLatencyMs: number | null;
};

function buildToolStatsRows(): ToolStatsRow[] {
  const rows = new Map<string, ToolStatsRow>();

  const ensure = (tool: string): ToolStatsRow => {
    const existing = rows.get(tool);
    if (existing) return existing;
    const created: ToolStatsRow = {
      tool,
      executions: 0,
      successes: 0,
      failures: {},
      avgLatencyMs: null,
    };
    rows.set(tool, created);
    return created;
  };

  for (const [key, value] of metrics.counters.entries()) {
    const parsedValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const { name, labels } = parseMetricKey(key);
    const tool = labels.tool;
    if (!tool) continue;

    if (name === 'tool_execution_total') {
      const row = ensure(tool);
      row.executions += parsedValue;
      const status = labels.status ?? 'unknown';
      if (status === 'success') {
        row.successes += parsedValue;
      } else {
        row.failures[status] = (row.failures[status] ?? 0) + parsedValue;
      }
      continue;
    }
  }

  for (const [key, value] of metrics.histograms.entries()) {
    const { name, labels } = parseMetricKey(key);
    if (name !== 'tool_latency_ms') continue;
    const tool = labels.tool;
    if (!tool) continue;
    const row = ensure(tool);
    const sum = typeof value.sum === 'number' && Number.isFinite(value.sum) ? value.sum : 0;
    const count = typeof value.count === 'number' && Number.isFinite(value.count) ? value.count : 0;
    row.avgLatencyMs = count > 0 ? Number((sum / count).toFixed(1)) : null;
  }

  return Array.from(rows.values());
}

const toolStatsTool: ToolDefinition<{ topN?: number; includeRaw?: boolean }> = {
  name: 'system_tool_stats',
  description:
    [
      'Inspect in-process tool telemetry (latency averages, successes, failures, and store occupancy).',
      'Note: all stats are process-local in-memory views; they reset on restart and are not shared across instances.',
      '<USE_ONLY_WHEN> You need to debug runtime latency, failures, or local store pressure for tools. </USE_ONLY_WHEN>',
    ].join('\n'),
  schema: z.object({
    topN: z.number().int().min(1).max(50).optional().describe('Maximum number of tools to return (sorted by executions).'),
    includeRaw: z.boolean().optional().describe('If true, include the raw metrics.dump() string for debugging.'),
  }),
  metadata: { readOnly: true },
  execute: async ({ topN, includeRaw }) => {
    const now = new Date();
    const rows = buildToolStatsRows();
    rows.sort((a, b) => b.executions - a.executions);
    const limited = rows.slice(0, topN ?? 15);

    return {
      generatedAtIso: now.toISOString(),
      scope: 'process',
      note:
        'All tool stats/caches are in-memory only. Multi-instance deployments do not share memoization without Redis/DB (by design).',
      memo: globalToolMemoStore.stats(now.getTime()),
      pagedText: globalPagedTextStore.stats(now.getTime()),
      tools: limited,
      raw: includeRaw ? metrics.dump() : undefined,
    };
  },
};

const generateImageTool: ToolDefinition<{
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

const npmPackageLookupTool: ToolDefinition<{ packageName: string; version?: string }> = {
  name: 'npm_info',
  description:
    'Lookup npm package metadata (latest version, publish time, dependency surface, maintainers, repository). Returns githubRepo when the repository points to GitHub.\n<USE_ONLY_WHEN> You need to retrieve specific metadata, versioning, or dependency info for an npm package. </USE_ONLY_WHEN>',
  schema: z.object({
    packageName: z.string().trim().min(1).max(214).describe('The exact npm package name.'),
    version: z.string().trim().min(1).max(80).optional(),
  }),
  metadata: { readOnly: true },
  execute: async ({ packageName, version }, ctx) => {
    return lookupNpmPackage({
      packageName,
      version,
      signal: ctx.signal,
    });
  },
};

const wikipediaLookupTool: ToolDefinition<{
  query: string;
  language?: string;
  maxResults?: number;
}> = {
  name: 'wikipedia_search',
  description:
    'Lookup Wikipedia pages with snippets and canonical links for broad factual topics and fast grounding.\n<USE_ONLY_WHEN> You explicitly need historical, broadly factual, or canonical encyclopedia data. </USE_ONLY_WHEN>',
  schema: z.object({
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
  query: string;
  maxResults?: number;
  tagged?: string;
  includeAcceptedAnswer?: boolean;
}> = {
  name: 'stack_overflow_search',
  description:
    'Search Stack Overflow questions with accepted status and scoring metadata for coding support.\nOptionally fetch the accepted answer body for the top accepted result.\n<USE_ONLY_WHEN> You need to find proven coding solutions, debugging help, or programming Q&A. </USE_ONLY_WHEN>',
  schema: z.object({
    query: z.string().trim().min(2).max(350).describe('The explicit coding problem to search StackOverflow for.'),
    maxResults: z.number().int().min(1).max(15).optional(),
    tagged: z.string().trim().min(1).max(120).optional(),
    includeAcceptedAnswer: z.boolean().optional().describe('If true, fetch the accepted answer body for the top accepted match (when available).'),
  }),
  metadata: { readOnly: true },
  execute: async ({ query, maxResults, tagged, includeAcceptedAnswer }) => {
    return searchStackOverflow({
      query,
      maxResults,
      tagged,
      includeAcceptedAnswer,
    });
  },
};

const DEFAULT_TOOL_DEFINITIONS = [
  getCurrentDateTimeTool,
  toolStatsTool,
  discordContextTool,
  discordMessagesTool,
  discordFilesTool,
  discordServerTool,
  discordVoiceTool,
  discordAdminTool,
  generateImageTool,
  webTool,
  githubTool,
  workflowTool,
  npmPackageLookupTool,
  wikipediaLookupTool,
  stackOverflowSearchTool,
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

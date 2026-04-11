import { z } from 'zod';
import {
  defineToolSpecV2,
  type ToolSpecV2,
  ToolRegistry,
  globalToolRegistry,
} from './toolRegistry';
import {
  discordTools,
} from './discordDomainTools';
import { webTools } from './webTool';
import { globalPagedTextStore } from './pagedTextStore';
import { globalToolMemoStore } from './toolMemoStore';
import { metrics } from '../../shared/observability/metrics';
import {
  generateImage,
  getWebProviderRuntimeStatus,
  lookupNpmPackage,
} from './toolIntegrations';
import { getPublicHostCodexAuthStatus } from '../auth/hostCodexAuthService';
import { getArtifactRuntimeDiagnostics } from '../artifacts/service';
import { getModerationRuntimeDiagnostics } from '../moderation/runtime';
import { getScheduledTaskRuntimeDiagnostics } from '../scheduler/service';
import { initializeMcpTools } from './mcp/manager';
import { registerMcpCapabilityTools } from './mcp/capabilities';

const getCurrentDateTimeTool = defineToolSpecV2({
  name: 'system_time',
  title: 'System Time',
  description:
    'Calculate timezone offsets for complex scheduling. Current UTC time is already in runtime state, so use this only when explicit offset math is needed.',
  input: z.object({
    utcOffsetMinutes: z.number().int().min(-720).max(840).optional(),
  }),
  outputSchema: {
    type: 'object',
    properties: {
      isoUtc: { type: 'string' },
      unixMs: { type: 'integer' },
      shiftedTimeIso: { type: 'string' },
      requestedOffsetMinutes: { type: 'integer' },
      requestedOffsetLabel: { type: 'string' },
    },
    required: ['isoUtc', 'unixMs'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    parallelSafe: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'tiny',
    capabilityTags: ['system', 'time'],
  },
  prompt: {
    summary: 'Use only for explicit timezone or offset math beyond the runtime UTC timestamp.',
    whenToUse: ['The user asks for converted times or offset calculations.'],
    whenNotToUse: ['The current UTC time in runtime state already answers the question.'],
  },
  smoke: {
    mode: 'required',
    args: {},
  },
  execute: async ({ utcOffsetMinutes }) => {
    const now = new Date();
    if (typeof utcOffsetMinutes !== 'number') {
      return {
        structuredContent: {
          isoUtc: now.toISOString(),
          unixMs: now.getTime(),
        },
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
      structuredContent: {
        isoUtc: now.toISOString(),
        shiftedTimeIso: shifted.toISOString(),
        requestedOffsetMinutes: utcOffsetMinutes,
        requestedOffsetLabel: offsetLabel,
        unixMs: now.getTime(),
      },
    };
  },
});

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
    if (name !== 'tool_execution_total') continue;
    const row = ensure(tool);
    row.executions += parsedValue;
    const status = labels.status ?? 'unknown';
    if (status === 'success') {
      row.successes += parsedValue;
    } else {
      row.failures[status] = (row.failures[status] ?? 0) + parsedValue;
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

function emptyModerationDiagnostics(): Record<string, unknown> {
  return {
    ready: false,
    requiredGatewayIntents: [],
    missingGatewayIntents: [],
    declaredGatewayIntents: [],
    totalPolicies: 0,
    enforcePolicies: 0,
    dryRunPolicies: 0,
    externalNativePolicies: 0,
    error: 'unavailable',
  };
}

function emptyArtifactDiagnostics(): Record<string, unknown> {
  return {
    ready: false,
    totalArtifacts: 0,
    totalRevisions: 0,
    publishedLinks: 0,
    error: 'unavailable',
  };
}

function emptySchedulerDiagnostics(): Record<string, unknown> {
  return {
    ready: false,
    activeTasks: 0,
    leasedTasks: 0,
    dueTasks: 0,
    error: 'unavailable',
  };
}

function emptyHostAuthDiagnostics(): Record<string, unknown> {
  return {
    configured: false,
    activeTextProvider: 'missing',
    fallbackTextProviderConfigured: false,
    hasOperatorError: false,
  };
}

const toolStatsTool = defineToolSpecV2({
  name: 'system_tool_stats',
  title: 'System Tool Stats',
  description: 'Inspect in-process tool telemetry, cache occupancy, and average latency by tool.',
  input: z.object({
    topN: z.number().int().min(1).max(50).optional(),
    includeRaw: z.boolean().optional(),
  }),
  outputSchema: {
    type: 'object',
    properties: {
      generatedAtIso: { type: 'string' },
      scope: { type: 'string' },
      note: { type: 'string' },
      memo: { type: 'object' },
      pagedText: { type: 'object' },
      artifacts: { type: 'object' },
      moderation: { type: 'object' },
      scheduler: { type: 'object' },
      hostAuth: { type: 'object' },
      webProviders: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            family: { type: 'string' },
            configured: { type: 'boolean' },
            coolingDown: { type: 'boolean' },
            cooldownUntil: { type: ['string', 'null'] },
            cooldownReason: { type: ['string', 'null'] },
            failureCategory: { type: ['string', 'null'] },
          },
          required: [
            'provider',
            'family',
            'configured',
            'coolingDown',
            'cooldownUntil',
            'cooldownReason',
            'failureCategory',
          ],
          additionalProperties: false,
        },
      },
      tools: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string' },
            executions: { type: 'integer' },
            successes: { type: 'integer' },
            failures: { type: 'object' },
            avgLatencyMs: { type: ['number', 'null'] },
          },
          required: ['tool', 'executions', 'successes', 'failures', 'avgLatencyMs'],
          additionalProperties: false,
        },
      },
      raw: {},
    },
    required: ['generatedAtIso', 'scope', 'note', 'memo', 'pagedText', 'artifacts', 'moderation', 'scheduler', 'hostAuth', 'webProviders', 'tools'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    parallelSafe: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'default',
    capabilityTags: ['system', 'tooling', 'telemetry'],
  },
  prompt: {
    summary: 'Inspect tool telemetry and cache state for operator diagnostics.',
    whenToUse: ['You need runtime tool health, latency, or cache insight.'],
    whenNotToUse: ['The request is for external facts or normal user-facing research.'],
  },
  smoke: {
    mode: 'required',
    args: {},
  },
  execute: async ({ topN, includeRaw }) => {
    const now = new Date();
    const rows = buildToolStatsRows();
    rows.sort((a, b) => b.executions - a.executions);
    return {
      structuredContent: {
        generatedAtIso: now.toISOString(),
        scope: 'process',
        note: 'All tool stats and caches are in-memory only.',
        memo: globalToolMemoStore.stats(now.getTime()),
        pagedText: globalPagedTextStore.stats(now.getTime()),
        artifacts: await getArtifactRuntimeDiagnostics().catch(() => emptyArtifactDiagnostics()),
        moderation: await getModerationRuntimeDiagnostics().catch(() => emptyModerationDiagnostics()),
        scheduler: await getScheduledTaskRuntimeDiagnostics().catch(() => emptySchedulerDiagnostics()),
        hostAuth: await getPublicHostCodexAuthStatus().catch(() => emptyHostAuthDiagnostics()),
        webProviders: getWebProviderRuntimeStatus(),
        tools: rows.slice(0, topN ?? 15),
        raw: includeRaw ? metrics.dump() : undefined,
      },
    };
  },
});

const generateImageTool = defineToolSpecV2({
  name: 'image_generate',
  title: 'Image Generate',
  description: 'Generate an image with Pollinations as a distinct artifact, not a normal text reply.',
  input: z.object({
    prompt: z.string().trim().min(3).max(2_000),
    model: z.string().trim().min(1).max(120).optional(),
    seed: z.number().int().min(0).max(9_999_999).optional(),
    width: z.number().int().min(64).max(2_048).optional(),
    height: z.number().int().min(64).max(2_048).optional(),
    referenceImageUrl: z.string().trim().url().max(2_048).optional(),
  }),
  outputSchema: {
    type: 'object',
    properties: {
      provider: { type: 'string' },
      model: { type: 'string' },
      seed: { type: 'integer' },
      prompt: { type: 'string' },
      imageUrl: { type: 'string' },
    },
    required: ['provider', 'model', 'prompt', 'imageUrl'],
    additionalProperties: false,
  },
  runtime: {
    class: 'artifact',
    readOnly: false,
    observationPolicy: 'artifact-only',
    capabilityTags: ['generation', 'image', 'artifact'],
  },
  prompt: {
    summary: 'Create an image artifact when the user explicitly wants generated art or a picture.',
    whenToUse: ['The request is for a generated image or art asset.'],
    whenNotToUse: ['A normal text answer is enough and no image artifact is needed.'],
  },
  smoke: {
    mode: 'skip',
    reason: 'Image generation is provider-dependent and slower than normal smoke checks.',
  },
  execute: async ({ prompt, model, seed, width, height, referenceImageUrl }, ctx) => {
    const result = await generateImage({
      prompt,
      model,
      seed,
      width,
      height,
      referenceImageUrl,
      apiKey: ctx.apiKey,
    }) as Record<string, unknown> & { artifacts?: unknown[] };
    const artifacts = Array.isArray(result.artifacts) && result.artifacts.length > 0
      ? result.artifacts
      : undefined;
    const { artifacts: _artifacts, ...structuredContent } = result;
    void _artifacts;
    return {
      structuredContent,
      artifacts: artifacts as never,
    };
  },
});

const npmPackageLookupTool = defineToolSpecV2({
  name: 'npm_info',
  title: 'npm Package Info',
  description: 'Lookup npm package metadata including versions, repository, and maintainers.',
  input: z.object({
    packageName: z.string().trim().min(1).max(214),
    version: z.string().trim().min(1).max(80).optional(),
  }),
  annotations: {
    readOnlyHint: true,
    parallelSafe: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'default',
    capabilityTags: ['developer', 'npm'],
  },
  prompt: {
    summary: 'Lookup npm package metadata such as latest versions, dist-tags, maintainers, and repository links.',
    whenToUse: ['The task is about an npm package or its current metadata.'],
    whenNotToUse: ['The task is about source code inside a known repository instead.'],
  },
  smoke: {
    mode: 'required',
    args: { packageName: 'openai' },
  },
  validationHint: 'Pass packageName and optionally version, for example { "packageName": "zod" }.',
  execute: async ({ packageName, version }, ctx) => lookupNpmPackage({
    packageName,
    version,
    signal: ctx.signal,
  }),
});

export const STATIC_TOOL_DEFINITIONS = [
  getCurrentDateTimeTool,
  toolStatsTool,
  ...discordTools,
  generateImageTool,
  ...webTools,
  npmPackageLookupTool,
];

function registerIfMissing<TArgs, TStructured>(
  registry: ToolRegistry,
  tool: ToolSpecV2<TArgs, TStructured>,
): void {
  if (!registry.has(tool.name)) {
    registry.register(tool);
  }
}

export async function registerDefaultAgenticTools(
  registry: ToolRegistry = globalToolRegistry,
): Promise<void> {
  for (const tool of STATIC_TOOL_DEFINITIONS) {
    registerIfMissing(registry, tool as ToolSpecV2<unknown, unknown>);
  }
  await initializeMcpTools(registry);
  await registerMcpCapabilityTools(registry);
}

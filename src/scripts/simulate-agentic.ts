/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import {
  evaluateDraftWithCritic,
  parseTraceToolTelemetry,
  registerDefaultAgenticTools,
  runChatTurn,
  scoreTraceOutcome,
} from '../core/agentRuntime';
import { getTraceById } from '../core/agentRuntime/agent-trace-repo';
import { prisma } from '../core/db/prisma-client';
import { limitConcurrency } from '../core/utils/concurrency';

const ROUTES = ['chat', 'coding', 'search', 'creative'] as const;
type RouteKind = (typeof ROUTES)[number];

type SimulationScenario = {
  id: string;
  route: RouteKind;
  userText: string;
  intent?: string | null;
};

type RouteWeights = Record<RouteKind, number>;

type SimulationRunRow = {
  index: number;
  traceId: string;
  scenarioId: string;
  requestedRoute: RouteKind;
  observedRoute: string;
  latencyMs: number;
  replyChars: number;
  fallbackDetected: boolean;
  successLikely: boolean;
  heuristicScore: number;
  judgeScore: number | null;
  judgeVerdict: 'pass' | 'revise' | null;
  judgeIssues: string[];
  score: number;
  riskFlags: string[];
  tooling: ReturnType<typeof parseTraceToolTelemetry>;
  judgeErrorText?: string;
  errorText?: string;
};

type SimulationRouteSummary = {
  total: number;
  errors: number;
  successLikelyCount: number;
  avgScore: number;
  avgHeuristicScore: number;
  judgeCoverageRate: number;
  judgeAvgScore: number | null;
  judgeReviseRate: number | null;
  avgLatencyMs: number;
  p90LatencyMs: number;
  fallbackCount: number;
  toolExecutionCount: number;
  hardGateRequiredCount: number;
  hardGateFailedCount: number;
};

type SimulationSummary = {
  runId: string;
  requestedRuns: number;
  completedRuns: number;
  concurrency: number;
  traceEnabled: boolean;
  expectTraceRows: boolean;
  avgScore: number;
  avgHeuristicScore: number;
  successLikelyRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p90LatencyMs: number;
  errorRate: number;
  fallbackRate: number;
  toolExecutionRate: number;
  avgSuccessfulToolCallsPerRun: number;
  hardGateFailureRate: number;
  judgeEnabled: boolean;
  judgeWeight: number;
  judgeCoverageRate: number;
  judgeAvgScore: number | null;
  judgeReviseRate: number | null;
  topRiskFlags: Array<{ riskFlag: string; count: number }>;
  byRoute: Record<string, SimulationRouteSummary>;
};

type SimulationJudgeConfig = {
  enabled: boolean;
  weight: number;
  timeoutMs: number;
  maxTokens: number;
  apiKey?: string;
};

const SCENARIOS: Record<RouteKind, SimulationScenario[]> = {
  chat: [
    {
      id: 'chat-release-notes',
      route: 'chat',
      userText:
        'Give me a concise summary of the most important AI model launch news from today, with sources.',
    },
    {
      id: 'chat-decision-memo',
      route: 'chat',
      userText:
        'Write a short decision memo: should a small team adopt an agentic architecture now or wait 3 months?',
    },
    {
      id: 'chat-architecture-compare',
      route: 'chat',
      userText:
        'Compare planner-executor architecture vs direct single-pass answers for reliability and speed.',
    },
    {
      id: 'chat-operational-risk',
      route: 'chat',
      userText:
        'List the top operational risks of autonomous agents in production and suggest immediate controls.',
    },
  ],
  coding: [
    {
      id: 'coding-typescript-bugfix',
      route: 'coding',
      userText:
        'I have a TypeScript runtime bug in async retries. Give a concrete fix pattern with code and edge cases.',
    },
    {
      id: 'coding-prisma-transaction',
      route: 'coding',
      userText:
        'Design a robust Prisma transaction pattern with retry handling for transient DB failures.',
    },
    {
      id: 'coding-node-streaming',
      route: 'coding',
      userText:
        'Provide a Node.js implementation strategy for streaming tool outputs safely to users with cancellation.',
    },
    {
      id: 'coding-test-strategy',
      route: 'coding',
      userText:
        'Create a test strategy for an LLM tool-call loop including mocks, flaky-network simulation, and regressions.',
    },
  ],
  search: [
    {
      id: 'search-latest-agent-news',
      route: 'search',
      userText:
        'Find the latest announcements this week about AI agents from major labs and include links.',
    },
    {
      id: 'search-recent-benchmarks',
      route: 'search',
      userText:
        'What are the newest agent benchmark results published recently? Summarize with sources and dates.',
    },
    {
      id: 'search-model-pricing',
      route: 'search',
      userText:
        'Check current pricing changes for leading LLM APIs and provide a sourced comparison table.',
    },
    {
      id: 'search-reliability-patterns',
      route: 'search',
      userText:
        'Look up practical patterns teams use to improve agent reliability in production. Cite sources.',
    },
  ],
  creative: [
    {
      id: 'creative-launch-copy',
      route: 'creative',
      userText:
        'Draft a launch announcement for an autonomous coding agent with a bold but credible tone.',
    },
    {
      id: 'creative-mascot-concept',
      route: 'creative',
      userText:
        'Create a visual concept prompt for a futuristic owl mascot representing trustworthy AI orchestration.',
    },
    {
      id: 'creative-taglines',
      route: 'creative',
      userText:
        'Generate 12 punchy product taglines for an agent runtime governance platform.',
    },
    {
      id: 'creative-story',
      route: 'creative',
      userText:
        'Write a micro-story where an AI agent prevents a production outage by self-correcting its plan.',
    },
  ],
};

function isRouteKind(value: string): value is RouteKind {
  return (ROUTES as readonly string[]).includes(value);
}

function readInt(name: string, fallback: number, bounds?: { min?: number; max?: number }): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (bounds?.min !== undefined && normalized < bounds.min) return bounds.min;
  if (bounds?.max !== undefined && normalized > bounds.max) return bounds.max;
  return normalized;
}

function readFloat(name: string, fallback: number, bounds?: { min?: number; max?: number }): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (bounds?.min !== undefined && parsed < bounds.min) return bounds.min;
  if (bounds?.max !== undefined && parsed > bounds.max) return bounds.max;
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
}

function createRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function parseRouteWeights(raw: string | undefined): RouteWeights {
  const defaults: RouteWeights = {
    chat: 3,
    coding: 2,
    search: 3,
    creative: 1,
  };
  if (!raw || raw.trim().length === 0) return defaults;

  const parsed: RouteWeights = {
    chat: 0,
    coding: 0,
    search: 0,
    creative: 0,
  };

  for (const token of raw.split(',')) {
    const [rawRoute, rawWeight] = token.split(':').map((part) => part.trim().toLowerCase());
    if (!rawRoute || !rawWeight || !isRouteKind(rawRoute)) continue;
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    parsed[rawRoute] = Math.max(0, Math.floor(weight));
  }

  const totalWeight = ROUTES.reduce((sum, route) => sum + parsed[route], 0);
  return totalWeight > 0 ? parsed : defaults;
}

function buildRoutePlan(runCount: number, weights: RouteWeights): RouteKind[] {
  const pool: RouteKind[] = [];
  for (const route of ROUTES) {
    for (let i = 0; i < weights[route]; i += 1) {
      pool.push(route);
    }
  }
  if (pool.length === 0) return Array.from({ length: runCount }, () => 'chat');
  return Array.from({ length: runCount }, (_, index) => pool[index % pool.length]);
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clampedPct = Math.max(0, Math.min(1, pct));
  const idx = Math.min(sorted.length - 1, Math.floor(clampedPct * (sorted.length - 1)));
  return sorted[idx];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isFallbackReply(replyText: string): boolean {
  const normalized = replyText.trim().toLowerCase();
  if (!normalized) return true;
  const markers = [
    "i'm having trouble connecting right now",
    "i couldn't verify this with tools right now",
    "i couldn't complete the search request at this time",
    "i won't provide an unverified answer",
    'please try again later',
  ];
  return markers.some((marker) => normalized.includes(marker));
}

function trimError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length <= 300 ? text : `${text.slice(0, 300)}...`;
}

function round(value: number, precision = 4): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

async function runSingleSimulation(params: {
  index: number;
  runId: string;
  scenario: SimulationScenario;
  guildId: string | null;
  channelPrefix: string;
  userPrefix: string;
  tracePrefix: string;
  expectTraceRows: boolean;
  judge: SimulationJudgeConfig;
}): Promise<SimulationRunRow> {
  const {
    index,
    runId,
    scenario,
    guildId,
    channelPrefix,
    userPrefix,
    tracePrefix,
    expectTraceRows,
    judge,
  } = params;
  const traceId = `${tracePrefix}-${runId}-${String(index + 1).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;
  const messageId = `sim-msg-${runId}-${index + 1}`;
  const channelId = `${channelPrefix}-${scenario.route}`;
  const userId = `${userPrefix}-${(index % 12) + 1}`;
  const startedAt = Date.now();

  try {
    const result = await runChatTurn({
      traceId,
      userId,
      channelId,
      guildId,
      messageId,
      userText: scenario.userText,
      intent: scenario.intent ?? null,
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'command',
      isVoiceActive: false,
    });

    const latencyMs = Date.now() - startedAt;
    const trace = config.TRACE_ENABLED ? await getTraceById(traceId) : null;
    if (expectTraceRows && !trace) {
      throw new Error('Trace row missing after run; ensure TRACE_ENABLED=true and database is reachable.');
    }

    const observedRoute = trace?.routeKind ?? scenario.route;
    const replyText = trace?.replyText ?? result.replyText;
    const outcome = scoreTraceOutcome({
      routeKind: observedRoute,
      replyText,
      toolJson: trace?.toolJson,
      qualityJson: trace?.qualityJson ?? trace?.tokenJson,
      budgetJson: trace?.budgetJson ?? trace?.tokenJson,
    });
    const tooling = parseTraceToolTelemetry(trace?.toolJson);
    let judgeScore: number | null = null;
    let judgeVerdict: 'pass' | 'revise' | null = null;
    let judgeIssues: string[] = [];
    let judgeErrorText: string | undefined;

    if (judge.enabled && replyText.trim().length > 0) {
      try {
        const assessment = await evaluateDraftWithCritic({
          guildId,
          routeKind: isRouteKind(observedRoute) ? observedRoute : scenario.route,
          userText: scenario.userText,
          draftText: replyText,
          apiKey: judge.apiKey,
          timeoutMs: judge.timeoutMs,
          maxTokens: judge.maxTokens,
        });
        if (assessment) {
          judgeScore = assessment.score;
          judgeVerdict = assessment.verdict;
          judgeIssues = assessment.issues.slice(0, 8);
        }
      } catch (judgeError) {
        judgeErrorText = trimError(judgeError);
      }
    }

    const blendedScore =
      judgeScore === null
        ? outcome.score
        : clamp01(outcome.score * (1 - judge.weight) + judgeScore * judge.weight);
    const blendedSuccessLikely = judgeVerdict === 'revise' ? false : blendedScore >= 0.6;
    const riskFlags =
      judgeVerdict === 'revise'
        ? Array.from(new Set([...outcome.riskFlags, 'judge_revise']))
        : outcome.riskFlags;

    return {
      index,
      traceId,
      scenarioId: scenario.id,
      requestedRoute: scenario.route,
      observedRoute,
      latencyMs,
      replyChars: replyText.trim().length,
      fallbackDetected: isFallbackReply(replyText),
      successLikely: blendedSuccessLikely,
      heuristicScore: outcome.score,
      judgeScore,
      judgeVerdict,
      judgeIssues,
      score: blendedScore,
      riskFlags,
      tooling,
      judgeErrorText,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      index,
      traceId,
      scenarioId: scenario.id,
      requestedRoute: scenario.route,
      observedRoute: scenario.route,
      latencyMs,
      replyChars: 0,
      fallbackDetected: true,
      successLikely: false,
      heuristicScore: 0,
      judgeScore: null,
      judgeVerdict: null,
      judgeIssues: [],
      score: 0,
      riskFlags: ['simulation_error'],
      tooling: parseTraceToolTelemetry(undefined),
      errorText: trimError(error),
    };
  }
}

function summarizeRuns(params: {
  runId: string;
  rows: SimulationRunRow[];
  concurrency: number;
  expectTraceRows: boolean;
  judge: SimulationJudgeConfig;
}): SimulationSummary {
  const { runId, rows, concurrency, expectTraceRows, judge } = params;
  const latencies = rows.map((row) => row.latencyMs);
  const riskCounts = new Map<string, number>();
  for (const row of rows) {
    for (const riskFlag of row.riskFlags) {
      riskCounts.set(riskFlag, (riskCounts.get(riskFlag) ?? 0) + 1);
    }
  }

  const byRouteAccumulator = new Map<string, SimulationRunRow[]>();
  for (const row of rows) {
    const bucket = byRouteAccumulator.get(row.observedRoute) ?? [];
    bucket.push(row);
    byRouteAccumulator.set(row.observedRoute, bucket);
  }

  const byRoute: Record<string, SimulationRouteSummary> = {};
  for (const [route, routeRows] of byRouteAccumulator.entries()) {
    const routeLatencies = routeRows.map((row) => row.latencyMs);
    const total = routeRows.length;
    const errors = routeRows.filter((row) => !!row.errorText).length;
    const successLikelyCount = routeRows.filter((row) => row.successLikely).length;
    const fallbackCount = routeRows.filter((row) => row.fallbackDetected).length;
    const toolExecutionCount = routeRows.filter((row) => row.tooling.toolsExecuted).length;
    const hardGateRequiredCount = routeRows.filter((row) => row.tooling.hardGateRequired).length;
    const hardGateFailedCount = routeRows.filter(
      (row) => row.tooling.hardGateRequired && row.tooling.hardGateSatisfied === false,
    ).length;
    const routeJudgeRows = routeRows.filter((row) => row.judgeScore !== null);
    const routeJudgeReviseCount = routeJudgeRows.filter((row) => row.judgeVerdict === 'revise').length;
    byRoute[route] = {
      total,
      errors,
      successLikelyCount,
      avgScore: round(avg(routeRows.map((row) => row.score))),
      avgHeuristicScore: round(avg(routeRows.map((row) => row.heuristicScore))),
      judgeCoverageRate: round(toRate(routeJudgeRows.length, total)),
      judgeAvgScore:
        routeJudgeRows.length > 0
          ? round(avg(routeJudgeRows.map((row) => row.judgeScore as number)))
          : null,
      judgeReviseRate: routeJudgeRows.length > 0 ? round(toRate(routeJudgeReviseCount, routeJudgeRows.length)) : null,
      avgLatencyMs: round(avg(routeLatencies), 2),
      p90LatencyMs: round(percentile(routeLatencies, 0.9), 2),
      fallbackCount,
      toolExecutionCount,
      hardGateRequiredCount,
      hardGateFailedCount,
    };
  }

  const sortedRiskFlags = Array.from(riskCounts.entries())
    .map(([riskFlag, count]) => ({ riskFlag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const completedRuns = rows.length;
  const errorCount = rows.filter((row) => !!row.errorText).length;
  const successLikelyCount = rows.filter((row) => row.successLikely).length;
  const fallbackCount = rows.filter((row) => row.fallbackDetected).length;
  const toolExecutionCount = rows.filter((row) => row.tooling.toolsExecuted).length;
  const successfulToolCalls = rows.reduce((sum, row) => sum + row.tooling.successfulToolCount, 0);
  const hardGateRequiredCount = rows.filter((row) => row.tooling.hardGateRequired).length;
  const hardGateFailedCount = rows.filter(
    (row) => row.tooling.hardGateRequired && row.tooling.hardGateSatisfied === false,
  ).length;
  const judgeRows = rows.filter((row) => row.judgeScore !== null);
  const judgeReviseCount = judgeRows.filter((row) => row.judgeVerdict === 'revise').length;

  return {
    runId,
    requestedRuns: completedRuns,
    completedRuns,
    concurrency,
    traceEnabled: config.TRACE_ENABLED,
    expectTraceRows,
    avgScore: round(avg(rows.map((row) => row.score))),
    avgHeuristicScore: round(avg(rows.map((row) => row.heuristicScore))),
    successLikelyRate: round(toRate(successLikelyCount, completedRuns)),
    avgLatencyMs: round(avg(latencies), 2),
    p50LatencyMs: round(percentile(latencies, 0.5), 2),
    p90LatencyMs: round(percentile(latencies, 0.9), 2),
    errorRate: round(toRate(errorCount, completedRuns)),
    fallbackRate: round(toRate(fallbackCount, completedRuns)),
    toolExecutionRate: round(toRate(toolExecutionCount, completedRuns)),
    avgSuccessfulToolCallsPerRun: round(toRate(successfulToolCalls, completedRuns)),
    hardGateFailureRate: round(toRate(hardGateFailedCount, hardGateRequiredCount)),
    judgeEnabled: judge.enabled,
    judgeWeight: round(judge.weight),
    judgeCoverageRate: round(toRate(judgeRows.length, completedRuns)),
    judgeAvgScore: judgeRows.length > 0 ? round(avg(judgeRows.map((row) => row.judgeScore as number))) : null,
    judgeReviseRate: judgeRows.length > 0 ? round(toRate(judgeReviseCount, judgeRows.length)) : null,
    topRiskFlags: sortedRiskFlags,
    byRoute,
  };
}

async function main(): Promise<void> {
  registerDefaultAgenticTools();

  const runCount = readInt('SIM_RUNS', 80, { min: 1, max: 2_000 });
  const concurrency = readInt('SIM_CONCURRENCY', 6, { min: 1, max: 32 });
  const routeWeights = parseRouteWeights(process.env.SIM_ROUTE_WEIGHTS_CSV);
  const guildIdRaw = process.env.SIM_GUILD_ID?.trim();
  const guildId = guildIdRaw && guildIdRaw.length > 0 ? guildIdRaw : null;
  const channelPrefix = process.env.SIM_CHANNEL_PREFIX?.trim() || 'sim-agentic';
  const userPrefix = process.env.SIM_USER_PREFIX?.trim() || 'sim-user';
  const tracePrefix = process.env.SIM_TRACE_PREFIX?.trim() || 'sim-agentic';
  const outputJson = process.env.SIM_OUTPUT_JSON?.trim();
  const minAvgScore = readFloat('SIM_MIN_AVG_SCORE', 0, { min: 0, max: 1 });
  const minSuccessRate = readFloat('SIM_MIN_SUCCESS_RATE', 0, { min: 0, max: 1 });
  const minToolExecutionRate = readFloat('SIM_MIN_TOOL_EXECUTION_RATE', 0, { min: 0, max: 1 });
  const maxErrorRate = readFloat('SIM_MAX_ERROR_RATE', 1, { min: 0, max: 1 });
  const judgeEnabled = readBoolean('SIM_JUDGE_ENABLED', false);
  const judgeWeight = readFloat('SIM_JUDGE_WEIGHT', 0.55, { min: 0, max: 1 });
  const judgeTimeoutMs = readInt('SIM_JUDGE_TIMEOUT_MS', 120_000, { min: 1_000, max: 300_000 });
  const judgeMaxTokens = readInt('SIM_JUDGE_MAX_TOKENS', 900, { min: 128, max: 4_000 });
  const requireJudgeResults = readBoolean('SIM_REQUIRE_JUDGE_RESULTS', false);
  const minJudgeAvgScore = readFloat('SIM_MIN_JUDGE_AVG_SCORE', 0, { min: 0, max: 1 });
  const maxJudgeReviseRate = readFloat('SIM_MAX_JUDGE_REVISE_RATE', 1, { min: 0, max: 1 });
  const judgeApiKeyRaw = process.env.SIM_JUDGE_API_KEY?.trim();
  const judgeApiKey = judgeApiKeyRaw && judgeApiKeyRaw.length > 0 ? judgeApiKeyRaw : config.LLM_API_KEY;
  const judgeConfig: SimulationJudgeConfig = {
    enabled: judgeEnabled,
    weight: judgeWeight,
    timeoutMs: judgeTimeoutMs,
    maxTokens: judgeMaxTokens,
    apiKey: judgeApiKey || undefined,
  };
  const expectTraceRows = readBoolean('SIM_REQUIRE_TRACE', true);
  const seed = readInt('SIM_SEED', Date.now());
  const rng = createRng(seed);

  const routePlan = buildRoutePlan(runCount, routeWeights);
  const runId = `${Date.now()}-${Math.floor(rng() * 1_000_000)}`;
  const limiter = limitConcurrency(concurrency);

  console.log('[agentic-sim] config', {
    runCount,
    concurrency,
    seed,
    traceEnabled: config.TRACE_ENABLED,
    expectTraceRows,
    routeWeights,
    guildScoped: guildId !== null,
    llmProvider: config.LLM_PROVIDER,
    model: config.CHAT_MODEL,
    judge: {
      enabled: judgeConfig.enabled,
      weight: judgeConfig.weight,
      timeoutMs: judgeConfig.timeoutMs,
      maxTokens: judgeConfig.maxTokens,
      apiKeyPresent: !!judgeConfig.apiKey,
      requireResults: requireJudgeResults,
    },
  });

  const rows = await Promise.all(
    routePlan.map((route, index) =>
      limiter(async () => {
        const scenarios = SCENARIOS[route];
        const selected = scenarios[Math.floor(rng() * scenarios.length)] ?? scenarios[0];
        return runSingleSimulation({
          index,
          runId,
          scenario: selected,
          guildId,
          channelPrefix,
            userPrefix,
            tracePrefix,
            expectTraceRows,
            judge: judgeConfig,
          });
        }),
    ),
  );

  const summary = summarizeRuns({
    runId,
    rows,
    concurrency,
    expectTraceRows,
    judge: judgeConfig,
  });
  summary.requestedRuns = runCount;

  console.log('[agentic-sim] summary', summary);

  if (outputJson) {
    const resolved = path.resolve(outputJson);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(
      resolved,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          config: {
            runCount,
            concurrency,
            seed,
            routeWeights,
            guildId,
            traceEnabled: config.TRACE_ENABLED,
            expectTraceRows,
            judge: {
              enabled: judgeConfig.enabled,
              weight: judgeConfig.weight,
              timeoutMs: judgeConfig.timeoutMs,
              maxTokens: judgeConfig.maxTokens,
              apiKeyPresent: !!judgeConfig.apiKey,
            },
          },
          summary,
          rows,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log('[agentic-sim] output', { file: resolved });
  }

  const failedChecks: string[] = [];
  if (summary.avgScore < minAvgScore) {
    failedChecks.push(
      `avgScore=${summary.avgScore.toFixed(4)} below SIM_MIN_AVG_SCORE=${minAvgScore.toFixed(4)}`,
    );
  }
  if (summary.successLikelyRate < minSuccessRate) {
    failedChecks.push(
      `successLikelyRate=${summary.successLikelyRate.toFixed(4)} below SIM_MIN_SUCCESS_RATE=${minSuccessRate.toFixed(4)}`,
    );
  }
  if (summary.toolExecutionRate < minToolExecutionRate) {
    failedChecks.push(
      `toolExecutionRate=${summary.toolExecutionRate.toFixed(4)} below SIM_MIN_TOOL_EXECUTION_RATE=${minToolExecutionRate.toFixed(4)}`,
    );
  }
  if (summary.errorRate > maxErrorRate) {
    failedChecks.push(
      `errorRate=${summary.errorRate.toFixed(4)} above SIM_MAX_ERROR_RATE=${maxErrorRate.toFixed(4)}`,
    );
  }
  if (judgeConfig.enabled && requireJudgeResults && summary.judgeCoverageRate <= 0) {
    failedChecks.push('judgeCoverageRate=0 while SIM_REQUIRE_JUDGE_RESULTS=true');
  }
  if (judgeConfig.enabled && summary.judgeAvgScore !== null && summary.judgeAvgScore < minJudgeAvgScore) {
    failedChecks.push(
      `judgeAvgScore=${summary.judgeAvgScore.toFixed(4)} below SIM_MIN_JUDGE_AVG_SCORE=${minJudgeAvgScore.toFixed(4)}`,
    );
  }
  if (judgeConfig.enabled && summary.judgeReviseRate !== null && summary.judgeReviseRate > maxJudgeReviseRate) {
    failedChecks.push(
      `judgeReviseRate=${summary.judgeReviseRate.toFixed(4)} above SIM_MAX_JUDGE_REVISE_RATE=${maxJudgeReviseRate.toFixed(4)}`,
    );
  }

  if (failedChecks.length > 0) {
    console.error('[agentic-sim] failed', { failedChecks });
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[agentic-sim] failed', trimError(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

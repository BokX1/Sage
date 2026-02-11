/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type VariantSpec = {
  name: string;
  env: Record<string, string>;
  description?: string;
};

type SimulationSummary = {
  runId: string;
  requestedRuns: number;
  completedRuns: number;
  concurrency: number;
  avgScore: number;
  avgHeuristicScore: number;
  successLikelyRate: number;
  avgLatencyMs: number;
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
};

type VariantResult = {
  variant: VariantSpec;
  outputFile: string;
  summary: SimulationSummary | null;
  exitCode: number | null;
  errorText?: string;
  compositeScore: number;
};

const DEFAULT_VARIANTS: VariantSpec[] = [
  {
    name: 'baseline',
    description: 'Current runtime configuration',
    env: {},
  },
  {
    name: 'critic_stricter_threshold',
    description: 'Raise critic minimum score to push stricter revisions',
    env: {
      AGENTIC_CRITIC_MIN_SCORE: '0.82',
    },
  },
  {
    name: 'critic_fewer_loops',
    description: 'Reduce critic loops to test latency-first behavior',
    env: {
      AGENTIC_CRITIC_MAX_LOOPS: '1',
    },
  },
  {
    name: 'tool_gate_stricter',
    description: 'Require at least 2 successful tool calls on hard-gated turns',
    env: {
      AGENTIC_TOOL_HARD_GATE_MIN_SUCCESSFUL_CALLS: '2',
    },
  },
  {
    name: 'tool_gate_strict_plus_critic',
    description: 'Combine stricter hard gate with tighter critic threshold',
    env: {
      AGENTIC_TOOL_HARD_GATE_MIN_SUCCESSFUL_CALLS: '2',
      AGENTIC_CRITIC_MIN_SCORE: '0.82',
    },
  },
];

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

function parseVariants(raw: string | undefined): VariantSpec[] {
  if (!raw || raw.trim().length === 0) return DEFAULT_VARIANTS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_VARIANTS;
    const variants: VariantSpec[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const envRaw = record.env;
      if (!name || !envRaw || typeof envRaw !== 'object' || Array.isArray(envRaw)) continue;
      const envEntries: Record<string, string> = {};
      for (const [key, value] of Object.entries(envRaw as Record<string, unknown>)) {
        if (typeof value === 'string') {
          envEntries[key] = value;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          envEntries[key] = String(value);
        }
      }
      variants.push({
        name,
        description: typeof record.description === 'string' ? record.description : undefined,
        env: envEntries,
      });
    }
    return variants.length > 0 ? variants : DEFAULT_VARIANTS;
  } catch {
    return DEFAULT_VARIANTS;
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'variant';
}

function computeCompositeScore(summary: SimulationSummary): number {
  const judgeScore = summary.judgeAvgScore ?? summary.avgScore;
  const judgeRevisePenalty = summary.judgeReviseRate ?? 0;
  const judgeCoverageBonus = summary.judgeCoverageRate > 0 ? 0.03 : 0;
  const reliability =
    summary.avgScore * 0.4 +
    summary.successLikelyRate * 0.2 +
    judgeScore * 0.2 -
    judgeRevisePenalty * 0.1 +
    judgeCoverageBonus;
  const tooling = summary.toolExecutionRate * 0.15 - summary.hardGateFailureRate * 0.15;
  const stability = (1 - summary.errorRate) * 0.08 - summary.fallbackRate * 0.05;
  return reliability + tooling + stability;
}

async function runVariant(params: {
  variant: VariantSpec;
  runsPerVariant: number;
  concurrency: number;
  outputFile: string;
  keepRows: boolean;
  judgeEnabled: boolean;
  judgeWeight: number;
  judgeTimeoutMs: number;
  judgeMaxTokens: number;
  requireJudgeResults: boolean;
  minJudgeAvgScore: number;
  maxJudgeReviseRate: number;
}): Promise<VariantResult> {
  const {
    variant,
    runsPerVariant,
    concurrency,
    outputFile,
    keepRows,
    judgeEnabled,
    judgeWeight,
    judgeTimeoutMs,
    judgeMaxTokens,
    requireJudgeResults,
    minJudgeAvgScore,
    maxJudgeReviseRate,
  } = params;
  const scriptPath = path.resolve(process.cwd(), 'dist/scripts/simulate-agentic.js');
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SIM_JUDGE_ENABLED: judgeEnabled ? '1' : '0',
    SIM_JUDGE_WEIGHT: String(judgeWeight),
    SIM_JUDGE_TIMEOUT_MS: String(judgeTimeoutMs),
    SIM_JUDGE_MAX_TOKENS: String(judgeMaxTokens),
    SIM_REQUIRE_JUDGE_RESULTS: requireJudgeResults ? '1' : '0',
    SIM_MIN_JUDGE_AVG_SCORE: String(minJudgeAvgScore),
    SIM_MAX_JUDGE_REVISE_RATE: String(maxJudgeReviseRate),
    ...variant.env,
    SIM_RUNS: String(runsPerVariant),
    SIM_CONCURRENCY: String(concurrency),
    SIM_OUTPUT_JSON: outputFile,
    SIM_TRACE_PREFIX: `tune-${sanitizeFileSegment(variant.name)}`,
  };

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrCombined = '';
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrCombined += text;
      process.stderr.write(chunk);
    });

    child.on('close', async (code) => {
      try {
        const raw = await readFile(outputFile, 'utf8');
        const parsed = JSON.parse(raw) as { summary?: SimulationSummary };
        const summary = parsed.summary ?? null;
        if (!keepRows) {
          try {
            await rm(outputFile, { force: true });
          } catch {
            // Ignore cleanup failures; recommendation output still matters.
          }
        }
        resolve({
          variant,
          outputFile,
          summary,
          exitCode: code,
          compositeScore: summary ? computeCompositeScore(summary) : -1,
          errorText:
            code && code !== 0
              ? stderrCombined.trim().slice(0, 1_000) || `Simulation exited with code ${code}`
              : undefined,
        });
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        resolve({
          variant,
          outputFile,
          summary: null,
          exitCode: code,
          compositeScore: -1,
          errorText: `Missing or invalid simulation output: ${errorText}`,
        });
      }
    });
  });
}

async function main(): Promise<void> {
  const runsPerVariant = readInt('TUNE_RUNS_PER_VARIANT', 120, { min: 10, max: 2_000 });
  const concurrency = readInt('TUNE_CONCURRENCY', 6, { min: 1, max: 32 });
  const maxVariants = readInt('TUNE_MAX_VARIANTS', 8, { min: 1, max: 32 });
  const keepRows = readBoolean('TUNE_KEEP_VARIANT_ROWS', true);
  const judgeEnabled = readBoolean('TUNE_JUDGE_ENABLED', true);
  const judgeWeight = readFloat('TUNE_JUDGE_WEIGHT', 0.55, { min: 0, max: 1 });
  const judgeTimeoutMs = readInt('TUNE_JUDGE_TIMEOUT_MS', 120_000, { min: 1_000, max: 300_000 });
  const judgeMaxTokens = readInt('TUNE_JUDGE_MAX_TOKENS', 900, { min: 128, max: 4_000 });
  const requireJudgeResults = readBoolean('TUNE_REQUIRE_JUDGE_RESULTS', false);
  const minJudgeAvgScore = readFloat('TUNE_MIN_JUDGE_AVG_SCORE', 0, { min: 0, max: 1 });
  const maxJudgeReviseRate = readFloat('TUNE_MAX_JUDGE_REVISE_RATE', 1, { min: 0, max: 1 });
  const variants = parseVariants(process.env.TUNE_VARIANTS_JSON).slice(0, maxVariants);
  const runId = `${Date.now()}`;
  const outputDir = path.resolve(
    process.env.TUNE_OUTPUT_DIR?.trim() || `.agent/simulations/tuning/${runId}`,
  );
  const recommendationPath = path.join(outputDir, 'recommendation.json');

  await mkdir(outputDir, { recursive: true });

  console.log('[agentic-tune] config', {
    runId,
    variants: variants.map((variant) => variant.name),
    runsPerVariant,
    concurrency,
    outputDir,
    keepRows,
    judge: {
      enabled: judgeEnabled,
      weight: judgeWeight,
      timeoutMs: judgeTimeoutMs,
      maxTokens: judgeMaxTokens,
      requireResults: requireJudgeResults,
      minJudgeAvgScore,
      maxJudgeReviseRate,
    },
  });

  const results: VariantResult[] = [];
  for (const variant of variants) {
    const outputFile = path.join(outputDir, `${sanitizeFileSegment(variant.name)}.json`);
    console.log('[agentic-tune] running', {
      variant: variant.name,
      envOverrides: variant.env,
      outputFile,
    });
    const result = await runVariant({
      variant,
      runsPerVariant,
      concurrency,
      outputFile,
      keepRows,
      judgeEnabled,
      judgeWeight,
      judgeTimeoutMs,
      judgeMaxTokens,
      requireJudgeResults,
      minJudgeAvgScore,
      maxJudgeReviseRate,
    });
    results.push(result);
  }

  const ranked = [...results].sort((a, b) => b.compositeScore - a.compositeScore);
  const winner = ranked.find((entry) => entry.summary !== null) ?? ranked[0] ?? null;

  const recommendation = {
    generatedAt: new Date().toISOString(),
    runId,
    runsPerVariant,
    concurrency,
    ranking: ranked.map((entry, index) => ({
      rank: index + 1,
      variant: entry.variant.name,
      description: entry.variant.description ?? null,
      compositeScore: Number(entry.compositeScore.toFixed(6)),
      exitCode: entry.exitCode,
      env: entry.variant.env,
      summary: entry.summary,
      errorText: entry.errorText ?? null,
    })),
    recommended: winner
      ? {
          variant: winner.variant.name,
          description: winner.variant.description ?? null,
          env: winner.variant.env,
          compositeScore: Number(winner.compositeScore.toFixed(6)),
          summary: winner.summary,
        }
      : null,
  };

  await writeFile(recommendationPath, JSON.stringify(recommendation, null, 2), 'utf8');

  console.log('[agentic-tune] ranking');
  for (const [index, entry] of ranked.entries()) {
    console.log(`${index + 1}. ${entry.variant.name}`, {
      compositeScore: Number(entry.compositeScore.toFixed(6)),
      exitCode: entry.exitCode,
      avgScore: entry.summary?.avgScore ?? null,
      avgHeuristicScore: entry.summary?.avgHeuristicScore ?? null,
      successLikelyRate: entry.summary?.successLikelyRate ?? null,
      judgeAvgScore: entry.summary?.judgeAvgScore ?? null,
      judgeReviseRate: entry.summary?.judgeReviseRate ?? null,
      judgeCoverageRate: entry.summary?.judgeCoverageRate ?? null,
      toolExecutionRate: entry.summary?.toolExecutionRate ?? null,
      hardGateFailureRate: entry.summary?.hardGateFailureRate ?? null,
      errorRate: entry.summary?.errorRate ?? null,
    });
  }

  console.log('[agentic-tune] recommendation', {
    file: recommendationPath,
    winner: recommendation.recommended,
  });

  if (!winner || !winner.summary) {
    throw new Error('No successful tuning variant produced a valid summary.');
  }
}

main().catch((error) => {
  const text = error instanceof Error ? error.message : String(error);
  console.error('[agentic-tune] failed', text);
  process.exitCode = 1;
});

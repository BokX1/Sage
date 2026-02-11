import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { listRecentTraces } from '../core/agentRuntime/agent-trace-repo';
import {
  cleanupAgentEvaluationsByTrace,
  insertAgentEvaluation,
} from '../core/agentRuntime/agent-eval-repo';
import { runLlmJudge } from '../core/agentRuntime/llmJudge';
import { prisma } from '../core/db/prisma-client';
import { limitConcurrency } from '../core/utils/concurrency';

interface TraceLike {
  id: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  routeKind: string;
  routerJson: unknown;
  qualityJson: unknown;
  budgetJson: unknown;
  toolJson: unknown;
  replyText: string;
}

interface EvalRunRowSummary {
  traceId: string;
  routeKind: string;
  model: string;
  overallScore: number;
  confidence: number;
  verdict: 'pass' | 'revise';
  disagreement: boolean;
  arbitrationUsed: boolean;
  issues: string[];
  errorText?: string;
}

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
}

function readCsv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function normalizeScope(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveTraceModel(trace: TraceLike): string {
  const quality = toRecord(trace.qualityJson);
  const budget = toRecord(trace.budgetJson);
  const router = toRecord(trace.routerJson);
  return (
    readString(quality, 'model') ??
    readString(quality, 'selectedModel') ??
    readString(budget, 'model') ??
    readString(budget, 'selectedModel') ??
    readString(router, 'model') ??
    'unknown'
  );
}

function resolveTraceUserText(trace: TraceLike): string | undefined {
  const quality = toRecord(trace.qualityJson);
  const budget = toRecord(trace.budgetJson);
  return (
    readString(quality, 'userText') ??
    readString(quality, 'promptUserText') ??
    readString(budget, 'userText') ??
    readString(budget, 'promptUserText') ??
    undefined
  );
}

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function round(value: number, precision = 4): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isSupportedRoute(routeKind: string): boolean {
  return routeKind === 'chat' || routeKind === 'coding' || routeKind === 'search' || routeKind === 'creative';
}

async function main(): Promise<void> {
  const limit = Math.max(1, Math.floor(readNumber('EVAL_RUN_LIMIT', 40)));
  const concurrency = Math.max(1, Math.floor(readNumber('EVAL_RUN_CONCURRENCY', 2)));
  const requireData = readBoolean('EVAL_RUN_REQUIRE_DATA', true);
  const cleanupExisting = readBoolean('EVAL_RUN_CLEANUP_EXISTING', true);
  const failOnError = readBoolean('EVAL_RUN_FAIL_ON_ERROR', true);
  const rubricVersion = (process.env.EVAL_RUN_RUBRIC_VERSION?.trim() || 'v1').toLowerCase();
  const timeoutMs = Math.max(1_000, Math.floor(readNumber('EVAL_RUN_TIMEOUT_MS', 120_000)));
  const maxTokens = Math.max(128, Math.floor(readNumber('EVAL_RUN_MAX_TOKENS', 1_200)));
  const primaryModel = normalizeScope(process.env.EVAL_RUN_PRIMARY_MODEL);
  const secondaryModel = normalizeScope(process.env.EVAL_RUN_SECONDARY_MODEL);
  const adjudicatorModel = normalizeScope(process.env.EVAL_RUN_ADJUDICATOR_MODEL);
  const guildId = normalizeScope(process.env.EVAL_RUN_GUILD_ID);
  const channelId = normalizeScope(process.env.EVAL_RUN_CHANNEL_ID);
  const routeAllowlist = readCsv('EVAL_RUN_ROUTES_CSV');
  const outputJson = normalizeScope(process.env.EVAL_RUN_OUTPUT_JSON);
  const apiKey = normalizeScope(process.env.EVAL_RUN_API_KEY) ?? config.LLM_API_KEY;
  const scopedLimit = routeAllowlist.length > 0 ? limit * 3 : limit;

  console.warn('[eval-run] config', {
    limit,
    scopedLimit,
    concurrency,
    requireData,
    cleanupExisting,
    failOnError,
    rubricVersion,
    timeoutMs,
    maxTokens,
    guildId: guildId ?? null,
    channelId: channelId ?? null,
    routeAllowlist,
    outputJson: outputJson ?? null,
    primaryModel: primaryModel ?? null,
    secondaryModel: secondaryModel ?? null,
    adjudicatorModel: adjudicatorModel ?? null,
    apiKeyPresent: !!apiKey,
  });

  const tracesRaw = await listRecentTraces({
    guildId,
    channelId,
    limit: scopedLimit,
  });
  const traces: TraceLike[] = tracesRaw
    .filter((row) => row.replyText.trim().length > 0)
    .filter((row) => isSupportedRoute(row.routeKind.toLowerCase()))
    .filter((row) => {
      if (routeAllowlist.length === 0) return true;
      return routeAllowlist.includes(row.routeKind.toLowerCase());
    })
    .map((row) => ({
      id: row.id,
      guildId: row.guildId,
      channelId: row.channelId,
      userId: row.userId,
      routeKind: row.routeKind,
      routerJson: row.routerJson,
      qualityJson: row.qualityJson,
      budgetJson: row.budgetJson,
      toolJson: row.toolJson,
      replyText: row.replyText,
    }))
    .slice(0, limit);

  if (traces.length === 0) {
    console.warn('[eval-run] no eligible traces found');
    if (requireData) {
      throw new Error('Eval run failed: no eligible traces while EVAL_RUN_REQUIRE_DATA=true');
    }
    return;
  }

  if (cleanupExisting) {
    const deleted = await cleanupAgentEvaluationsByTrace({
      traceIds: traces.map((trace) => trace.id),
      rubricVersion,
    });
    console.warn('[eval-run] cleanup', {
      deleted,
      traceCount: traces.length,
      rubricVersion,
    });
  }

  const limiter = limitConcurrency(concurrency);
  const rows = await Promise.all(
    traces.map((trace) =>
      limiter(async (): Promise<EvalRunRowSummary> => {
        const routeKind = trace.routeKind.toLowerCase();
        const traceModel = resolveTraceModel(trace);
        const userText = resolveTraceUserText(trace);
        try {
          const judgeResult = await runLlmJudge({
            guildId: trace.guildId,
            routeKind,
            userText,
            replyText: trace.replyText,
            toolJson: trace.toolJson,
            qualityJson: trace.qualityJson,
            budgetJson: trace.budgetJson,
            rubricVersion,
            apiKey: apiKey ?? undefined,
            timeoutMs,
            maxTokens,
            primaryModel,
            secondaryModel,
            adjudicatorModel,
          });

          await insertAgentEvaluation({
            traceId: trace.id,
            guildId: trace.guildId,
            channelId: trace.channelId,
            userId: trace.userId,
            routeKind,
            model: traceModel,
            rubricVersion: judgeResult.rubricVersion,
            primaryJudgeModel: judgeResult.primary.model,
            secondaryJudgeModel: judgeResult.secondary.model,
            adjudicatorJudgeModel: judgeResult.adjudicator?.model ?? null,
            overallScore: judgeResult.final.overallScore,
            confidence: judgeResult.final.confidence,
            verdict: judgeResult.final.verdict,
            disagreement: judgeResult.disagreement,
            arbitrationUsed: judgeResult.arbitrationUsed,
            judgeAgreement: !judgeResult.disagreement,
            dimensionScores: judgeResult.final.scores,
            issues: judgeResult.final.issues,
            summary: judgeResult.final.summary,
            judgeJson: judgeResult,
          });

          return {
            traceId: trace.id,
            routeKind,
            model: traceModel,
            overallScore: judgeResult.final.overallScore,
            confidence: judgeResult.final.confidence,
            verdict: judgeResult.final.verdict,
            disagreement: judgeResult.disagreement,
            arbitrationUsed: judgeResult.arbitrationUsed,
            issues: judgeResult.final.issues,
          };
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          return {
            traceId: trace.id,
            routeKind,
            model: traceModel,
            overallScore: 0,
            confidence: 0,
            verdict: 'revise',
            disagreement: false,
            arbitrationUsed: false,
            issues: ['eval_run_failed'],
            errorText,
          };
        }
      }),
    ),
  );

  const failedRows = rows.filter((row) => !!row.errorText);
  const passedRows = rows.filter((row) => !row.errorText);
  const passCount = passedRows.filter((row) => row.verdict === 'pass').length;
  const disagreementCount = passedRows.filter((row) => row.disagreement).length;
  const arbitrationCount = passedRows.filter((row) => row.arbitrationUsed).length;

  const byRoute = Object.fromEntries(
    Array.from(new Set(rows.map((row) => row.routeKind)))
      .sort((a, b) => a.localeCompare(b))
      .map((routeKind) => {
        const bucket = rows.filter((row) => row.routeKind === routeKind && !row.errorText);
        const bucketPass = bucket.filter((row) => row.verdict === 'pass').length;
        const bucketDisagreement = bucket.filter((row) => row.disagreement).length;
        const bucketArbitration = bucket.filter((row) => row.arbitrationUsed).length;
        return [
          routeKind,
          {
            total: bucket.length,
            avgScore: round(average(bucket.map((row) => row.overallScore))),
            avgConfidence: round(average(bucket.map((row) => row.confidence))),
            passRate: round(toRate(bucketPass, bucket.length)),
            disagreementRate: round(toRate(bucketDisagreement, bucket.length)),
            arbitrationRate: round(toRate(bucketArbitration, bucket.length)),
          },
        ];
      }),
  );

  const summary = {
    total: rows.length,
    evaluated: passedRows.length,
    errors: failedRows.length,
    avgScore: round(average(passedRows.map((row) => row.overallScore))),
    avgConfidence: round(average(passedRows.map((row) => row.confidence))),
    passRate: round(toRate(passCount, passedRows.length)),
    disagreementRate: round(toRate(disagreementCount, passedRows.length)),
    arbitrationRate: round(toRate(arbitrationCount, passedRows.length)),
    byRoute,
  };

  console.warn('[eval-run] summary', summary);
  if (failedRows.length > 0) {
    console.warn(
      '[eval-run] failures',
      failedRows.map((row) => ({
        traceId: row.traceId,
        routeKind: row.routeKind,
        errorText: row.errorText,
      })),
    );
  }

  if (outputJson) {
    const resolved = path.resolve(outputJson);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(
      resolved,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          config: {
            limit,
            concurrency,
            rubricVersion,
            guildId: guildId ?? null,
            channelId: channelId ?? null,
            routeAllowlist,
          },
          summary,
          rows,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.warn('[eval-run] output', { file: resolved });
  }

  if (failedRows.length > 0 && failOnError) {
    throw new Error(`Eval run failed: ${failedRows.length} evaluation rows failed`);
  }
  if (requireData && passedRows.length === 0) {
    throw new Error('Eval run failed: zero successful evaluations while EVAL_RUN_REQUIRE_DATA=true');
  }
}

main()
  .catch((error) => {
    const text = error instanceof Error ? error.message : String(error);
    console.error('[eval-run] failed', text);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

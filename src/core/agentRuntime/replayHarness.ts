import { listRecentTraces } from './agent-trace-repo';
import { scoreTraceOutcome, OutcomeScore } from './outcomeScorer';
import { parseTraceToolTelemetry, TraceToolTelemetry } from './toolTelemetry';

export interface ReplayToolingAggregate {
  tracesWithTelemetry: number;
  tracesWithToolsExecuted: number;
  totalSuccessfulToolCalls: number;
  totalToolResults: number;
  tracesWithHardGateRequired: number;
  tracesWithHardGateSatisfied: number;
  tracesWithHardGateFailed: number;
  tracesWithHardGateForcedPass: number;
  tracesWithToolLoopFailed: number;
  tracesWithCriticToolLoops: number;
  totalCriticToolLoopBudgets: number;
}

export interface ReplayEvaluationRow {
  traceId: string;
  routeKind: string;
  createdAt: Date;
  tooling: TraceToolTelemetry;
  score: OutcomeScore;
}

export interface ReplayRouteBucket {
  total: number;
  successLikelyCount: number;
  avgScore: number;
  tooling: ReplayToolingAggregate;
}

export interface ReplayEvaluationReport {
  total: number;
  successLikelyCount: number;
  avgScore: number;
  tooling: ReplayToolingAggregate;
  byRoute: Record<string, ReplayRouteBucket>;
  rows: ReplayEvaluationRow[];
}

function roundTo(value: number, precision = 4): number {
  const p = 10 ** precision;
  return Math.round(value * p) / p;
}

function createToolingAggregate(): ReplayToolingAggregate {
  return {
    tracesWithTelemetry: 0,
    tracesWithToolsExecuted: 0,
    totalSuccessfulToolCalls: 0,
    totalToolResults: 0,
    tracesWithHardGateRequired: 0,
    tracesWithHardGateSatisfied: 0,
    tracesWithHardGateFailed: 0,
    tracesWithHardGateForcedPass: 0,
    tracesWithToolLoopFailed: 0,
    tracesWithCriticToolLoops: 0,
    totalCriticToolLoopBudgets: 0,
  };
}

function applyToolingSample(aggregate: ReplayToolingAggregate, telemetry: TraceToolTelemetry): void {
  if (telemetry.signalPresent) {
    aggregate.tracesWithTelemetry += 1;
  }
  if (telemetry.toolsExecuted) {
    aggregate.tracesWithToolsExecuted += 1;
  }
  aggregate.totalSuccessfulToolCalls += telemetry.successfulToolCount;
  aggregate.totalToolResults += telemetry.toolResultCount;
  if (telemetry.hardGateRequired) {
    aggregate.tracesWithHardGateRequired += 1;
    if (telemetry.hardGateSatisfied === true) {
      aggregate.tracesWithHardGateSatisfied += 1;
    } else if (telemetry.hardGateSatisfied === false) {
      aggregate.tracesWithHardGateFailed += 1;
    }
  }
  if (telemetry.hardGateForcedPassUsed) {
    aggregate.tracesWithHardGateForcedPass += 1;
  }
  if (telemetry.toolLoopFailed) {
    aggregate.tracesWithToolLoopFailed += 1;
  }
  if (telemetry.critic.length > 0) {
    aggregate.tracesWithCriticToolLoops += 1;
    aggregate.totalCriticToolLoopBudgets += telemetry.critic.length;
  }
}

export async function evaluateRecentTraceOutcomes(params: {
  limit: number;
  guildId?: string;
  channelId?: string;
}): Promise<ReplayEvaluationReport> {
  const traces = await listRecentTraces({
    limit: params.limit,
    guildId: params.guildId,
    channelId: params.channelId,
  });

  const rows: ReplayEvaluationRow[] = traces.map((trace) => ({
    tooling: parseTraceToolTelemetry(trace.toolJson),
    traceId: trace.id,
    routeKind: trace.routeKind,
    createdAt: trace.createdAt,
    score: scoreTraceOutcome({
      routeKind: trace.routeKind,
      replyText: trace.replyText,
      toolJson: trace.toolJson,
      qualityJson: trace.qualityJson ?? trace.tokenJson,
      budgetJson: trace.budgetJson ?? trace.tokenJson,
    }),
  }));

  const tooling = createToolingAggregate();
  const byRoute: ReplayEvaluationReport['byRoute'] = {};
  for (const row of rows) {
    const bucket = byRoute[row.routeKind] ?? {
      total: 0,
      successLikelyCount: 0,
      avgScore: 0,
      tooling: createToolingAggregate(),
    };
    bucket.total += 1;
    if (row.score.successLikely) {
      bucket.successLikelyCount += 1;
    }
    bucket.avgScore += row.score.score;
    applyToolingSample(bucket.tooling, row.tooling);
    byRoute[row.routeKind] = bucket;
    applyToolingSample(tooling, row.tooling);
  }

  for (const route of Object.keys(byRoute)) {
    const bucket = byRoute[route];
    if (bucket.total > 0) {
      bucket.avgScore = roundTo(bucket.avgScore / bucket.total);
    }
  }

  const total = rows.length;
  const successLikelyCount = rows.filter((row) => row.score.successLikely).length;
  const avgScore =
    total > 0 ? roundTo(rows.reduce((sum, row) => sum + row.score.score, 0) / total) : 0;

  return {
    total,
    successLikelyCount,
    avgScore,
    tooling,
    byRoute,
    rows,
  };
}

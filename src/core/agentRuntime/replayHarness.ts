import { listRecentTraces } from './agent-trace-repo';
import { scoreTraceOutcome, OutcomeScore } from './outcomeScorer';

export interface ReplayEvaluationRow {
  traceId: string;
  routeKind: string;
  createdAt: Date;
  score: OutcomeScore;
}

export interface ReplayEvaluationReport {
  total: number;
  successLikelyCount: number;
  avgScore: number;
  byRoute: Record<
    string,
    {
      total: number;
      successLikelyCount: number;
      avgScore: number;
    }
  >;
  rows: ReplayEvaluationRow[];
}

function roundTo(value: number, precision = 4): number {
  const p = 10 ** precision;
  return Math.round(value * p) / p;
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

  const byRoute: ReplayEvaluationReport['byRoute'] = {};
  for (const row of rows) {
    const bucket = byRoute[row.routeKind] ?? {
      total: 0,
      successLikelyCount: 0,
      avgScore: 0,
    };
    bucket.total += 1;
    if (row.score.successLikely) {
      bucket.successLikelyCount += 1;
    }
    bucket.avgScore += row.score.score;
    byRoute[row.routeKind] = bucket;
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
    byRoute,
    rows,
  };
}

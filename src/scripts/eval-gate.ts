import { listRecentAgentEvaluations } from '../core/agentRuntime/agent-eval-repo';
import { prisma } from '../core/db/prisma-client';

interface RouteGateThreshold {
  minAvgScore?: number;
  minPassRate?: number;
  maxDisagreementRate?: number;
  minConfidence?: number;
  minSamples?: number;
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
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0),
    ),
  );
}

function normalizeScope(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function readRouteThresholds(name: string): Record<string, RouteGateThreshold> {
  const raw = process.env[name]?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>);
    const normalized: Record<string, RouteGateThreshold> = {};
    for (const [route, value] of entries) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const threshold: RouteGateThreshold = {};
      if (record.minAvgScore !== undefined) threshold.minAvgScore = clamp01(Number(record.minAvgScore));
      if (record.minPassRate !== undefined) threshold.minPassRate = clamp01(Number(record.minPassRate));
      if (record.maxDisagreementRate !== undefined) {
        threshold.maxDisagreementRate = clamp01(Number(record.maxDisagreementRate));
      }
      if (record.minConfidence !== undefined) threshold.minConfidence = clamp01(Number(record.minConfidence));
      if (record.minSamples !== undefined) {
        const numeric = Number(record.minSamples);
        if (Number.isFinite(numeric)) threshold.minSamples = Math.max(1, Math.floor(numeric));
      }
      normalized[route.trim().toLowerCase()] = threshold;
    }
    return normalized;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const limit = Math.max(1, Math.floor(readNumber('EVAL_GATE_LIMIT', 60)));
  const requireData = readBoolean('EVAL_GATE_REQUIRE_DATA', true);
  const minTotal = Math.max(0, Math.floor(readNumber('EVAL_GATE_MIN_TOTAL', requireData ? 1 : 0)));
  const rubricVersion = (process.env.EVAL_GATE_RUBRIC_VERSION?.trim() || 'v1').toLowerCase();
  const minAvgScore = clamp01(readNumber('EVAL_GATE_MIN_AVG_SCORE', 0.75));
  const minPassRate = clamp01(readNumber('EVAL_GATE_MIN_PASS_RATE', 0.7));
  const maxDisagreementRate = clamp01(readNumber('EVAL_GATE_MAX_DISAGREEMENT_RATE', 0.4));
  const minConfidence = clamp01(readNumber('EVAL_GATE_MIN_CONFIDENCE', 0.5));
  const guildId = normalizeScope(process.env.EVAL_GATE_GUILD_ID);
  const channelId = normalizeScope(process.env.EVAL_GATE_CHANNEL_ID);
  const routeKind = normalizeScope(process.env.EVAL_GATE_ROUTE_KIND)?.toLowerCase();
  const latestPerTrace = readBoolean('EVAL_GATE_LATEST_PER_TRACE', true);
  const requiredRoutes = readCsv('EVAL_GATE_REQUIRED_ROUTES_CSV');
  const minRouteSamples = Math.max(1, Math.floor(readNumber('EVAL_GATE_MIN_ROUTE_SAMPLES', 1)));
  const routeThresholds = readRouteThresholds('EVAL_GATE_ROUTE_THRESHOLDS_JSON');

  const rows = await listRecentAgentEvaluations({
    limit,
    guildId,
    channelId,
    routeKind,
    rubricVersion,
    latestPerTrace,
  });

  const passCount = rows.filter((row) => row.verdict === 'pass').length;
  const disagreementCount = rows.filter((row) => row.disagreement).length;
  const byRoute = Object.fromEntries(
    Array.from(new Set(rows.map((row) => row.routeKind)))
      .sort((a, b) => a.localeCompare(b))
      .map((route) => {
        const bucket = rows.filter((row) => row.routeKind === route);
        const bucketPass = bucket.filter((row) => row.verdict === 'pass').length;
        const bucketDisagreement = bucket.filter((row) => row.disagreement).length;
        const bucketArbitration = bucket.filter((row) => row.arbitrationUsed).length;
        return [
          route,
          {
            total: bucket.length,
            avgScore:
              bucket.length === 0
                ? 0
                : Number((bucket.reduce((sum, row) => sum + row.overallScore, 0) / bucket.length).toFixed(4)),
            avgConfidence:
              bucket.length === 0
                ? 0
                : Number((bucket.reduce((sum, row) => sum + row.confidence, 0) / bucket.length).toFixed(4)),
            passRate: Number(toRate(bucketPass, bucket.length).toFixed(4)),
            disagreementRate: Number(toRate(bucketDisagreement, bucket.length).toFixed(4)),
            arbitrationRate: Number(toRate(bucketArbitration, bucket.length).toFixed(4)),
          },
        ];
      }),
  ) as Record<
    string,
    {
      total: number;
      avgScore: number;
      avgConfidence: number;
      passRate: number;
      disagreementRate: number;
      arbitrationRate: number;
    }
  >;

  const avgScore =
    rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.overallScore, 0) / rows.length;
  const avgConfidence =
    rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length;
  const passRate = toRate(passCount, rows.length);
  const disagreementRate = toRate(disagreementCount, rows.length);

  console.warn('[eval-gate] config', {
    limit,
    requireData,
    minTotal,
    rubricVersion,
    minAvgScore,
    minPassRate,
    maxDisagreementRate,
    minConfidence,
    guildId: guildId ?? null,
    channelId: channelId ?? null,
    routeKind: routeKind ?? null,
    latestPerTrace,
    requiredRoutes,
    minRouteSamples,
    routeThresholds,
  });

  console.warn('[eval-gate] report', {
    total: rows.length,
    avgScore: Number(avgScore.toFixed(4)),
    avgConfidence: Number(avgConfidence.toFixed(4)),
    passCount,
    passRate: Number(passRate.toFixed(4)),
    disagreementCount,
    disagreementRate: Number(disagreementRate.toFixed(4)),
    byRoute,
  });

  if (rows.length === 0 && requireData) {
    throw new Error('Eval gate failed: no evaluations available while EVAL_GATE_REQUIRE_DATA=true');
  }
  if (rows.length < minTotal) {
    throw new Error(`Eval gate failed: total evaluations ${rows.length} below minimum ${minTotal}`);
  }

  if (rows.length > 0 && avgScore < minAvgScore) {
    throw new Error(
      `Eval gate failed: avgScore ${avgScore.toFixed(4)} below threshold ${minAvgScore.toFixed(4)}`,
    );
  }
  if (rows.length > 0 && passRate < minPassRate) {
    throw new Error(
      `Eval gate failed: passRate ${passRate.toFixed(4)} below threshold ${minPassRate.toFixed(4)}`,
    );
  }
  if (rows.length > 0 && disagreementRate > maxDisagreementRate) {
    throw new Error(
      `Eval gate failed: disagreementRate ${disagreementRate.toFixed(4)} above threshold ${maxDisagreementRate.toFixed(4)}`,
    );
  }
  if (rows.length > 0 && avgConfidence < minConfidence) {
    throw new Error(
      `Eval gate failed: avgConfidence ${avgConfidence.toFixed(4)} below threshold ${minConfidence.toFixed(4)}`,
    );
  }

  for (const route of requiredRoutes) {
    const bucket = byRoute[route];
    const routeOverride = routeThresholds[route] ?? {};
    const routeMinSamples = routeOverride.minSamples ?? minRouteSamples;
    const routeMinAvgScore = routeOverride.minAvgScore ?? minAvgScore;
    const routeMinPassRate = routeOverride.minPassRate ?? minPassRate;
    const routeMaxDisagreementRate = routeOverride.maxDisagreementRate ?? maxDisagreementRate;
    const routeMinConfidence = routeOverride.minConfidence ?? minConfidence;

    if (!bucket || bucket.total < routeMinSamples) {
      throw new Error(
        `Eval gate failed: route "${route}" has ${bucket?.total ?? 0} evaluations; requires at least ${routeMinSamples}`,
      );
    }
    if (bucket.avgScore < routeMinAvgScore) {
      throw new Error(
        `Eval gate failed: route "${route}" avgScore ${bucket.avgScore.toFixed(4)} below threshold ${routeMinAvgScore.toFixed(4)}`,
      );
    }
    if (bucket.passRate < routeMinPassRate) {
      throw new Error(
        `Eval gate failed: route "${route}" passRate ${bucket.passRate.toFixed(4)} below threshold ${routeMinPassRate.toFixed(4)}`,
      );
    }
    if (bucket.disagreementRate > routeMaxDisagreementRate) {
      throw new Error(
        `Eval gate failed: route "${route}" disagreementRate ${bucket.disagreementRate.toFixed(4)} above threshold ${routeMaxDisagreementRate.toFixed(4)}`,
      );
    }
    if (bucket.avgConfidence < routeMinConfidence) {
      throw new Error(
        `Eval gate failed: route "${route}" avgConfidence ${bucket.avgConfidence.toFixed(4)} below threshold ${routeMinConfidence.toFixed(4)}`,
      );
    }
  }

  console.warn('[eval-gate] passed');
}

main()
  .catch((error) => {
    console.error('[eval-gate] failed', error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

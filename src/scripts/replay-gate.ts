import { evaluateRecentTraceOutcomes } from '../core/agentRuntime/replayHarness';

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

interface RouteGateThreshold {
  minAvgScore?: number;
  minSuccessRate?: number;
  minToolExecutionRate?: number;
  maxHardGateFailureRate?: number;
  minSamples?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
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
      if (record.minAvgScore !== undefined) {
        threshold.minAvgScore = clamp01(Number(record.minAvgScore));
      }
      if (record.minSuccessRate !== undefined) {
        threshold.minSuccessRate = clamp01(Number(record.minSuccessRate));
      }
      if (record.minToolExecutionRate !== undefined) {
        threshold.minToolExecutionRate = clamp01(Number(record.minToolExecutionRate));
      }
      if (record.maxHardGateFailureRate !== undefined) {
        threshold.maxHardGateFailureRate = clamp01(Number(record.maxHardGateFailureRate));
      }
      if (record.minSamples !== undefined) {
        const numeric = Number(record.minSamples);
        if (Number.isFinite(numeric)) {
          threshold.minSamples = Math.max(1, Math.floor(numeric));
        }
      }
      normalized[route.trim().toLowerCase()] = threshold;
    }
    return normalized;
  } catch {
    return {};
  }
}

function normalizeScope(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function toRate(successLikelyCount: number, total: number): number {
  if (total <= 0) return 0;
  return successLikelyCount / total;
}

async function main(): Promise<void> {
  const limit = Math.max(1, Math.floor(readNumber('REPLAY_GATE_LIMIT', 50)));
  const minAvgScore = Math.max(0, Math.min(1, readNumber('REPLAY_GATE_MIN_AVG_SCORE', 0.62)));
  const minSuccessRate = Math.max(0, Math.min(1, readNumber('REPLAY_GATE_MIN_SUCCESS_RATE', 0.7)));
  const minToolExecutionRate = Math.max(
    0,
    Math.min(1, readNumber('REPLAY_GATE_MIN_TOOL_EXECUTION_RATE', 0)),
  );
  const maxHardGateFailureRate = Math.max(
    0,
    Math.min(1, readNumber('REPLAY_GATE_MAX_HARD_GATE_FAILURE_RATE', 1)),
  );
  const requireData = readBoolean('REPLAY_GATE_REQUIRE_DATA', false);
  const minTotal = Math.max(0, Math.floor(readNumber('REPLAY_GATE_MIN_TOTAL', requireData ? 1 : 0)));
  const requiredRoutes = readCsv('REPLAY_GATE_REQUIRED_ROUTES_CSV');
  const minRouteSamples = Math.max(1, Math.floor(readNumber('REPLAY_GATE_MIN_ROUTE_SAMPLES', 1)));
  const routeThresholds = readRouteThresholds('REPLAY_GATE_ROUTE_THRESHOLDS_JSON');
  const guildId = normalizeScope(process.env.REPLAY_GATE_GUILD_ID);
  const channelId = normalizeScope(process.env.REPLAY_GATE_CHANNEL_ID);

  const report = await evaluateRecentTraceOutcomes({
    limit,
    guildId,
    channelId,
  });

  const successRate = toRate(report.successLikelyCount, report.total);
  const toolExecutionRate = toRate(report.tooling.tracesWithToolsExecuted, report.total);
  const hardGateFailureRate = toRate(
    report.tooling.tracesWithHardGateFailed,
    report.tooling.tracesWithHardGateRequired,
  );
  const routeSummary = Object.entries(report.byRoute)
    .map(([route, bucket]) => ({
      route,
      total: bucket.total,
      avgScore: Number(bucket.avgScore.toFixed(4)),
      successRate: Number(toRate(bucket.successLikelyCount, bucket.total).toFixed(4)),
      toolExecutionRate: Number(toRate(bucket.tooling.tracesWithToolsExecuted, bucket.total).toFixed(4)),
      hardGateRequired: bucket.tooling.tracesWithHardGateRequired,
      hardGateFailed: bucket.tooling.tracesWithHardGateFailed,
      hardGateFailureRate: Number(
        toRate(bucket.tooling.tracesWithHardGateFailed, bucket.tooling.tracesWithHardGateRequired).toFixed(4),
      ),
      avgSuccessfulToolCalls: Number((bucket.tooling.totalSuccessfulToolCalls / Math.max(1, bucket.total)).toFixed(4)),
    }))
    .sort((a, b) => a.route.localeCompare(b.route));

  console.warn('[replay-gate] config', {
    limit,
    minAvgScore,
    minSuccessRate,
    minToolExecutionRate,
    maxHardGateFailureRate,
    minTotal,
    requireData,
    requiredRoutes,
    minRouteSamples,
    routeThresholds,
    guildId: guildId ?? null,
    channelId: channelId ?? null,
  });
  console.warn('[replay-gate] report', {
    total: report.total,
    avgScore: report.avgScore,
    successLikelyCount: report.successLikelyCount,
    successRate: Number(successRate.toFixed(4)),
    tooling: {
      tracesWithTelemetry: report.tooling.tracesWithTelemetry,
      tracesWithToolsExecuted: report.tooling.tracesWithToolsExecuted,
      totalSuccessfulToolCalls: report.tooling.totalSuccessfulToolCalls,
      totalToolResults: report.tooling.totalToolResults,
      tracesWithHardGateRequired: report.tooling.tracesWithHardGateRequired,
      tracesWithHardGateSatisfied: report.tooling.tracesWithHardGateSatisfied,
      tracesWithHardGateFailed: report.tooling.tracesWithHardGateFailed,
      tracesWithHardGateForcedPass: report.tooling.tracesWithHardGateForcedPass,
      tracesWithToolLoopFailed: report.tooling.tracesWithToolLoopFailed,
      tracesWithCriticToolLoops: report.tooling.tracesWithCriticToolLoops,
      totalCriticToolLoopBudgets: report.tooling.totalCriticToolLoopBudgets,
      toolExecutionRate: Number(toolExecutionRate.toFixed(4)),
      hardGateFailureRate: Number(hardGateFailureRate.toFixed(4)),
    },
    byRoute: routeSummary,
  });

  if (report.total === 0 && requireData) {
    throw new Error('Replay gate failed: no traces available while REPLAY_GATE_REQUIRE_DATA=true');
  }
  if (report.total < minTotal) {
    throw new Error(`Replay gate failed: total traces ${report.total} below minimum ${minTotal}`);
  }

  if (report.total > 0 && report.avgScore < minAvgScore) {
    throw new Error(
      `Replay gate failed: avgScore ${report.avgScore.toFixed(4)} below threshold ${minAvgScore.toFixed(4)}`,
    );
  }

  if (report.total > 0 && successRate < minSuccessRate) {
    throw new Error(
      `Replay gate failed: successRate ${successRate.toFixed(4)} below threshold ${minSuccessRate.toFixed(4)}`,
    );
  }

  if (report.total > 0 && toolExecutionRate < minToolExecutionRate) {
    throw new Error(
      `Replay gate failed: toolExecutionRate ${toolExecutionRate.toFixed(4)} below threshold ${minToolExecutionRate.toFixed(4)}`,
    );
  }

  if (
    report.tooling.tracesWithHardGateRequired > 0 &&
    hardGateFailureRate > maxHardGateFailureRate
  ) {
    throw new Error(
      `Replay gate failed: hardGateFailureRate ${hardGateFailureRate.toFixed(4)} above threshold ${maxHardGateFailureRate.toFixed(4)}`,
    );
  }

  for (const route of requiredRoutes) {
    const bucket = report.byRoute[route];
    const routeOverride = routeThresholds[route] ?? {};
    const routeMinSamples = routeOverride.minSamples ?? minRouteSamples;
    const routeMinAvgScore = routeOverride.minAvgScore ?? minAvgScore;
    const routeMinSuccessRate = routeOverride.minSuccessRate ?? minSuccessRate;
    const routeMinToolExecutionRate = routeOverride.minToolExecutionRate;
    const routeMaxHardGateFailureRate =
      routeOverride.maxHardGateFailureRate ?? maxHardGateFailureRate;

    if (!bucket || bucket.total < routeMinSamples) {
      throw new Error(
        `Replay gate failed: route "${route}" has ${bucket?.total ?? 0} traces; requires at least ${routeMinSamples}`,
      );
    }

    const routeSuccessRate = toRate(bucket.successLikelyCount, bucket.total);
    const routeToolExecutionRate = toRate(bucket.tooling.tracesWithToolsExecuted, bucket.total);
    const routeHardGateFailureRate = toRate(
      bucket.tooling.tracesWithHardGateFailed,
      bucket.tooling.tracesWithHardGateRequired,
    );
    if (bucket.avgScore < routeMinAvgScore) {
      throw new Error(
        `Replay gate failed: route "${route}" avgScore ${bucket.avgScore.toFixed(4)} below threshold ${routeMinAvgScore.toFixed(4)}`,
      );
    }
    if (routeSuccessRate < routeMinSuccessRate) {
      throw new Error(
        `Replay gate failed: route "${route}" successRate ${routeSuccessRate.toFixed(4)} below threshold ${routeMinSuccessRate.toFixed(4)}`,
      );
    }
    if (
      routeMinToolExecutionRate !== undefined &&
      routeToolExecutionRate < routeMinToolExecutionRate
    ) {
      throw new Error(
        `Replay gate failed: route "${route}" toolExecutionRate ${routeToolExecutionRate.toFixed(4)} below threshold ${routeMinToolExecutionRate.toFixed(4)}`,
      );
    }
    if (
      bucket.tooling.tracesWithHardGateRequired > 0 &&
      routeHardGateFailureRate > routeMaxHardGateFailureRate
    ) {
      throw new Error(
        `Replay gate failed: route "${route}" hardGateFailureRate ${routeHardGateFailureRate.toFixed(4)} above threshold ${routeMaxHardGateFailureRate.toFixed(4)}`,
      );
    }
  }

  console.warn('[replay-gate] passed');
}

main().catch((error) => {
  console.error('[replay-gate] failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

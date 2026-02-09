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
  const requireData = readBoolean('REPLAY_GATE_REQUIRE_DATA', false);
  const minTotal = Math.max(0, Math.floor(readNumber('REPLAY_GATE_MIN_TOTAL', requireData ? 1 : 0)));
  const requiredRoutes = readCsv('REPLAY_GATE_REQUIRED_ROUTES_CSV');
  const minRouteSamples = Math.max(1, Math.floor(readNumber('REPLAY_GATE_MIN_ROUTE_SAMPLES', 1)));
  const guildId = normalizeScope(process.env.REPLAY_GATE_GUILD_ID);
  const channelId = normalizeScope(process.env.REPLAY_GATE_CHANNEL_ID);

  const report = await evaluateRecentTraceOutcomes({
    limit,
    guildId,
    channelId,
  });

  const successRate = toRate(report.successLikelyCount, report.total);
  const routeSummary = Object.entries(report.byRoute)
    .map(([route, bucket]) => ({
      route,
      total: bucket.total,
      avgScore: Number(bucket.avgScore.toFixed(4)),
      successRate: Number(toRate(bucket.successLikelyCount, bucket.total).toFixed(4)),
    }))
    .sort((a, b) => a.route.localeCompare(b.route));

  console.warn('[replay-gate] config', {
    limit,
    minAvgScore,
    minSuccessRate,
    minTotal,
    requireData,
    requiredRoutes,
    minRouteSamples,
    guildId: guildId ?? null,
    channelId: channelId ?? null,
  });
  console.warn('[replay-gate] report', {
    total: report.total,
    avgScore: report.avgScore,
    successLikelyCount: report.successLikelyCount,
    successRate: Number(successRate.toFixed(4)),
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

  for (const route of requiredRoutes) {
    const bucket = report.byRoute[route];
    if (!bucket || bucket.total < minRouteSamples) {
      throw new Error(
        `Replay gate failed: route "${route}" has ${bucket?.total ?? 0} traces; requires at least ${minRouteSamples}`,
      );
    }

    const routeSuccessRate = toRate(bucket.successLikelyCount, bucket.total);
    if (bucket.avgScore < minAvgScore) {
      throw new Error(
        `Replay gate failed: route "${route}" avgScore ${bucket.avgScore.toFixed(4)} below threshold ${minAvgScore.toFixed(4)}`,
      );
    }
    if (routeSuccessRate < minSuccessRate) {
      throw new Error(
        `Replay gate failed: route "${route}" successRate ${routeSuccessRate.toFixed(4)} below threshold ${minSuccessRate.toFixed(4)}`,
      );
    }
  }

  console.warn('[replay-gate] passed');
}

main().catch((error) => {
  console.error('[replay-gate] failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

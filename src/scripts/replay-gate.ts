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

async function main(): Promise<void> {
  const limit = Math.max(1, Math.floor(readNumber('REPLAY_GATE_LIMIT', 50)));
  const minAvgScore = Math.max(0, Math.min(1, readNumber('REPLAY_GATE_MIN_AVG_SCORE', 0.62)));
  const minSuccessRate = Math.max(0, Math.min(1, readNumber('REPLAY_GATE_MIN_SUCCESS_RATE', 0.7)));
  const requireData = readBoolean('REPLAY_GATE_REQUIRE_DATA', false);
  const guildId = process.env.REPLAY_GATE_GUILD_ID;
  const channelId = process.env.REPLAY_GATE_CHANNEL_ID;

  const report = await evaluateRecentTraceOutcomes({
    limit,
    guildId: guildId || undefined,
    channelId: channelId || undefined,
  });

  const successRate = report.total > 0 ? report.successLikelyCount / report.total : 0;

  console.warn('[replay-gate] report', {
    total: report.total,
    avgScore: report.avgScore,
    successLikelyCount: report.successLikelyCount,
    successRate: Number(successRate.toFixed(4)),
    minAvgScore,
    minSuccessRate,
    guildId: guildId ?? null,
    channelId: channelId ?? null,
  });

  if (report.total === 0 && requireData) {
    throw new Error('Replay gate failed: no traces available while REPLAY_GATE_REQUIRE_DATA=true');
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

  console.warn('[replay-gate] passed');
}

main().catch((error) => {
  console.error('[replay-gate] failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

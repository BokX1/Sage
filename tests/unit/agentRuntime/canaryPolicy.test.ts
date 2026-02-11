import { beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateAgenticCanary,
  getAgenticCanarySnapshot,
  normalizeCanaryConfig,
  parseRouteAllowlistCsv,
  recordAgenticOutcome,
  resetAgenticCanaryState,
} from '../../../src/core/agentRuntime/canaryPolicy';

describe('canaryPolicy', () => {
  beforeEach(async () => {
    await resetAgenticCanaryState();
  });

  it('allows execution when canary is disabled', async () => {
    const config = normalizeCanaryConfig({
      enabled: false,
    });

    const decision = await evaluateAgenticCanary({
      traceId: 'trace-1',
      routeKind: 'chat',
      guildId: 'guild-1',
      config,
      nowMs: 1_000,
    });

    expect(decision.allowAgentic).toBe(true);
    expect(decision.reason).toBe('disabled');
  });

  it('blocks routes outside allowlist', async () => {
    const config = normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      routeAllowlist: parseRouteAllowlistCsv('chat,coding'),
    });

    const decision = await evaluateAgenticCanary({
      traceId: 'trace-2',
      routeKind: 'search',
      guildId: 'guild-1',
      config,
      nowMs: 2_000,
    });

    expect(decision.allowAgentic).toBe(false);
    expect(decision.reason).toBe('route_not_allowlisted');
  });

  it('respects rollout percent sampling', async () => {
    const config = normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 0,
    });

    const decision = await evaluateAgenticCanary({
      traceId: 'trace-3',
      routeKind: 'chat',
      guildId: 'guild-1',
      config,
      nowMs: 3_000,
    });

    expect(decision.allowAgentic).toBe(false);
    expect(decision.reason).toBe('out_of_rollout_sample');
  });

  it('trips cooldown when failure rate exceeds threshold', async () => {
    const config = normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      maxFailureRate: 0.25,
      minSamples: 4,
      cooldownMs: 30_000,
      windowSize: 4,
    });

    await recordAgenticOutcome({ success: false, config, nowMs: 10_000 });
    await recordAgenticOutcome({ success: false, config, nowMs: 10_100 });
    await recordAgenticOutcome({ success: false, config, nowMs: 10_200 });
    await recordAgenticOutcome({ success: true, config, nowMs: 10_300 });

    const decision = await evaluateAgenticCanary({
      traceId: 'trace-4',
      routeKind: 'chat',
      guildId: 'guild-1',
      config,
      nowMs: 10_301,
    });

    expect(decision.allowAgentic).toBe(false);
    expect(decision.reason).toBe('error_budget_cooldown');

    const snapshot = await getAgenticCanarySnapshot({ nowMs: 10_301, config });
    expect(snapshot.totalSamples).toBe(4);
    expect(snapshot.totalFailures).toBe(3);
    expect(snapshot.tripped).toBe(true);
    expect(snapshot.recentFailureReasonCounts).toEqual({
      graph_failed_tasks: 0,
      hard_gate_unmet: 0,
      tool_loop_failed: 0,
    });
    expect(snapshot.latestOutcome?.success).toBe(true);
    expect(snapshot.latestOutcome?.reasonCodes).toEqual([]);
    expect(typeof snapshot.latestOutcome?.recordedAt).toBe('string');
  });

  it('tracks structured failure reason diagnostics in snapshot payload', async () => {
    const config = normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      maxFailureRate: 0.8,
      minSamples: 2,
      cooldownMs: 60_000,
      windowSize: 10,
    });

    await recordAgenticOutcome({
      success: false,
      reasonCodes: ['graph_failed_tasks', 'hard_gate_unmet', 'hard_gate_unmet'],
      config,
      nowMs: 20_000,
    });
    await recordAgenticOutcome({
      success: false,
      reasonCodes: ['tool_loop_failed'],
      config,
      nowMs: 20_100,
    });
    await recordAgenticOutcome({
      success: true,
      reasonCodes: ['hard_gate_unmet'],
      config,
      nowMs: 20_200,
    });

    const snapshot = await getAgenticCanarySnapshot({ nowMs: 20_300, config });
    expect(snapshot.recentFailureReasonCounts).toEqual({
      graph_failed_tasks: 1,
      hard_gate_unmet: 1,
      tool_loop_failed: 1,
    });
    expect(snapshot.latestOutcome).toMatchObject({
      success: true,
      reasonCodes: [],
    });
    expect(typeof snapshot.latestOutcome?.recordedAt).toBe('string');
  });
});

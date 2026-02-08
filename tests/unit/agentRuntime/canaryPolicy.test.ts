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
  beforeEach(() => {
    resetAgenticCanaryState();
  });

  it('allows execution when canary is disabled', () => {
    const config = normalizeCanaryConfig({
      enabled: false,
    });

    const decision = evaluateAgenticCanary({
      traceId: 'trace-1',
      routeKind: 'qa',
      guildId: 'guild-1',
      config,
      nowMs: 1_000,
    });

    expect(decision.allowAgentic).toBe(true);
    expect(decision.reason).toBe('disabled');
  });

  it('blocks routes outside allowlist', () => {
    const config = normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      routeAllowlist: parseRouteAllowlistCsv('qa,coding'),
    });

    const decision = evaluateAgenticCanary({
      traceId: 'trace-2',
      routeKind: 'search',
      guildId: 'guild-1',
      config,
      nowMs: 2_000,
    });

    expect(decision.allowAgentic).toBe(false);
    expect(decision.reason).toBe('route_not_allowlisted');
  });

  it('respects rollout percent sampling', () => {
    const config = normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 0,
    });

    const decision = evaluateAgenticCanary({
      traceId: 'trace-3',
      routeKind: 'qa',
      guildId: 'guild-1',
      config,
      nowMs: 3_000,
    });

    expect(decision.allowAgentic).toBe(false);
    expect(decision.reason).toBe('out_of_rollout_sample');
  });

  it('trips cooldown when failure rate exceeds threshold', () => {
    const config = normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      maxFailureRate: 0.25,
      minSamples: 4,
      cooldownMs: 30_000,
      windowSize: 4,
    });

    recordAgenticOutcome({ success: false, config, nowMs: 10_000 });
    recordAgenticOutcome({ success: false, config, nowMs: 10_100 });
    recordAgenticOutcome({ success: false, config, nowMs: 10_200 });
    recordAgenticOutcome({ success: true, config, nowMs: 10_300 });

    const decision = evaluateAgenticCanary({
      traceId: 'trace-4',
      routeKind: 'qa',
      guildId: 'guild-1',
      config,
      nowMs: 10_301,
    });

    expect(decision.allowAgentic).toBe(false);
    expect(decision.reason).toBe('error_budget_cooldown');

    const snapshot = getAgenticCanarySnapshot(10_301);
    expect(snapshot.totalSamples).toBe(4);
    expect(snapshot.totalFailures).toBe(3);
    expect(snapshot.tripped).toBe(true);
  });
});

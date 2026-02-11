import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CanaryTestLoadOptions {
  readRow?: {
    id: string;
    outcomesJson: unknown;
    cooldownUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  readError?: Error;
  writeError?: Error;
}

async function loadCanaryPolicy(options: CanaryTestLoadOptions = {}) {
  const mockRead = vi.fn().mockResolvedValue(options.readRow ?? null);
  if (options.readError) {
    mockRead.mockRejectedValueOnce(options.readError);
  }
  const mockWrite = vi.fn().mockResolvedValue(undefined);
  if (options.writeError) {
    mockWrite.mockRejectedValueOnce(options.writeError);
  }
  const mockClear = vi.fn().mockResolvedValue(undefined);
  const mockWarn = vi.fn();

  vi.doMock('../../../src/core/agentRuntime/canaryStateRepo', () => ({
    readPersistedCanaryState: mockRead,
    writePersistedCanaryState: mockWrite,
    clearPersistedCanaryState: mockClear,
  }));
  vi.doMock('../../../src/core/utils/logger', () => ({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: mockWarn,
      error: vi.fn(),
    },
  }));

  const canary = await import('../../../src/core/agentRuntime/canaryPolicy');
  return {
    canary,
    mockRead,
    mockWrite,
    mockClear,
    mockWarn,
  };
}

describe('canaryPolicy persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('hydrates persisted cooldown and blocks while cooldown is active', async () => {
    const cooldownUntil = new Date('2026-02-11T19:00:00.000Z');
    const { canary, mockRead } = await loadCanaryPolicy({
      readRow: {
        id: 'global',
        outcomesJson: [],
        cooldownUntil,
        createdAt: new Date('2026-02-11T18:00:00.000Z'),
        updatedAt: new Date('2026-02-11T18:30:00.000Z'),
      },
    });
    const config = canary.normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      persistStateEnabled: true,
    });

    const decision = await canary.evaluateAgenticCanary({
      traceId: 'trace-cooldown',
      routeKind: 'chat',
      guildId: 'guild-1',
      config,
      nowMs: cooldownUntil.getTime() - 1_000,
    });

    expect(decision.allowAgentic).toBe(false);
    expect(decision.reason).toBe('error_budget_cooldown');
    expect(mockRead).toHaveBeenCalledTimes(1);

    const snapshot = await canary.getAgenticCanarySnapshot({
      nowMs: cooldownUntil.getTime() - 1_000,
      config,
    });
    expect(snapshot.persistenceMode).toBe('db');
    expect(snapshot.degradedMode).toBe(false);
    expect(snapshot.tripped).toBe(true);
  });

  it('persists outcomes before minSamples threshold is reached', async () => {
    const { canary, mockWrite } = await loadCanaryPolicy();
    const config = canary.normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      minSamples: 10,
      windowSize: 50,
      persistStateEnabled: true,
    });

    await canary.recordAgenticOutcome({
      success: false,
      reasonCodes: ['hard_gate_unmet'],
      config,
      nowMs: 1_000,
    });

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const payload = mockWrite.mock.calls[0]?.[0] as {
      outcomesJson: Array<{ success: boolean; reasonCodes: string[]; recordedAtMs: number }>;
      cooldownUntilMs: number;
    };
    expect(payload.outcomesJson).toHaveLength(1);
    expect(payload.outcomesJson[0]).toMatchObject({
      success: false,
      reasonCodes: ['hard_gate_unmet'],
      recordedAtMs: 1_000,
    });
    expect(payload.cooldownUntilMs).toBe(0);
  });

  it('falls back to degraded memory mode when persistence write fails', async () => {
    const { canary, mockWarn } = await loadCanaryPolicy({
      writeError: new Error('db unavailable'),
    });
    const config = canary.normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      persistStateEnabled: true,
    });

    await canary.recordAgenticOutcome({
      success: true,
      config,
      nowMs: 2_000,
    });

    const snapshot = await canary.getAgenticCanarySnapshot({ nowMs: 2_001, config });
    expect(snapshot.persistenceMode).toBe('memory');
    expect(snapshot.degradedMode).toBe(true);
    expect(snapshot.lastPersistenceError).toContain('db unavailable');
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('clears persisted state on reset after db mode initialization', async () => {
    const { canary, mockClear } = await loadCanaryPolicy();
    const config = canary.normalizeCanaryConfig({
      enabled: true,
      rolloutPercent: 100,
      persistStateEnabled: true,
    });

    await canary.evaluateAgenticCanary({
      traceId: 'trace-reset',
      routeKind: 'chat',
      guildId: 'guild-1',
      config,
      nowMs: 5_000,
    });

    await canary.resetAgenticCanaryState();
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
});

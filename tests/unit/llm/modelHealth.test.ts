import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ModelHealthTestLoadOptions {
  persistEnabled?: boolean;
  listRows?: Array<{
    modelId: string;
    score: number;
    samples: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  listError?: Error;
  upsertError?: Error;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function loadModelHealth(options: ModelHealthTestLoadOptions = {}) {
  const mockList = vi.fn().mockResolvedValue(options.listRows ?? []);
  if (options.listError) {
    mockList.mockRejectedValueOnce(options.listError);
  }
  const mockUpsert = vi.fn().mockResolvedValue(undefined);
  if (options.upsertError) {
    mockUpsert.mockRejectedValueOnce(options.upsertError);
  }
  const mockClear = vi.fn().mockResolvedValue(undefined);
  const mockWarn = vi.fn();

  vi.doMock('../../../src/config', () => ({
    config: {
      TRACE_ENABLED: options.persistEnabled ?? true,
    },
  }));
  vi.doMock('../../../src/core/llm/model-health-repo', () => ({
    listModelHealthStates: mockList,
    upsertModelHealthState: mockUpsert,
    clearModelHealthStates: mockClear,
  }));
  vi.doMock('../../../src/core/utils/logger', () => ({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: mockWarn,
      error: vi.fn(),
    },
  }));

  const modelHealth = await import('../../../src/core/llm/model-health');
  return {
    modelHealth,
    mockList,
    mockUpsert,
    mockClear,
    mockWarn,
  };
}

describe('model-health persistence runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('hydrates score from persistence when db mode is enabled', async () => {
    const { modelHealth, mockList } = await loadModelHealth({
      listRows: [
        {
          modelId: 'kimi',
          score: 0.91,
          samples: 12,
          createdAt: new Date('2026-02-11T18:00:00.000Z'),
          updatedAt: new Date('2026-02-11T18:30:00.000Z'),
        },
      ],
    });

    const score = await modelHealth.getModelHealthScore('KIMI');
    expect(score).toBe(0.91);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(['kimi']);
  });

  it('falls back to degraded in-memory mode when persistence hydration fails', async () => {
    const { modelHealth, mockWarn } = await loadModelHealth({
      listError: new Error('db read unavailable'),
    });

    const score = await modelHealth.getModelHealthScore('kimi');
    expect(score).toBe(0.5);
    expect(modelHealth.getModelHealthRuntimeStatus()).toMatchObject({
      persistenceEnabled: true,
      persistenceMode: 'memory',
      degradedMode: true,
    });
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('persists normalized model outcomes to storage in db mode', async () => {
    const { modelHealth, mockUpsert } = await loadModelHealth();
    modelHealth.recordModelOutcome({
      model: 'Kimi',
      success: true,
      latencyMs: 2_000,
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith({
      modelId: 'kimi',
      score: 1,
      samples: 1,
    });
  });

  it('degrades to in-memory mode when persistence write fails', async () => {
    const { modelHealth, mockWarn } = await loadModelHealth({
      upsertError: new Error('db write unavailable'),
    });

    modelHealth.recordModelOutcome({
      model: 'claude-fast',
      success: true,
      latencyMs: 2_000,
    });
    await flushMicrotasks();

    expect(modelHealth.getModelHealthRuntimeStatus()).toMatchObject({
      persistenceEnabled: true,
      persistenceMode: 'memory',
      degradedMode: true,
    });
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('skips persistence repo operations when persistence is disabled', async () => {
    const { modelHealth, mockList, mockUpsert } = await loadModelHealth({
      persistEnabled: false,
    });

    const score = await modelHealth.getModelHealthScore('kimi');
    modelHealth.recordModelOutcome({ model: 'kimi', success: true, latencyMs: 1_000 });

    expect(score).toBe(0.5);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(modelHealth.getModelHealthRuntimeStatus()).toMatchObject({
      persistenceEnabled: false,
      persistenceMode: 'memory',
      degradedMode: false,
    });
  });

  it('clears persisted rows on reset while in db mode', async () => {
    const { modelHealth, mockClear } = await loadModelHealth();

    modelHealth.resetModelHealth();
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('gets scores for multiple models with getModelHealthScores', async () => {
    const { modelHealth, mockList } = await loadModelHealth({
      listRows: [
        {
          modelId: 'kimi',
          score: 0.9,
          samples: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const scores = await modelHealth.getModelHealthScores(['kimi', 'openai']);
    expect(scores).toEqual({
      kimi: 0.9,
      openai: 0.5,
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(['kimi', 'openai']);
  });

  it('gets a snapshot of all tracked or requested models with getModelHealthSnapshot', async () => {
    const { modelHealth } = await loadModelHealth();

    // Force some entries
    modelHealth.recordModelOutcome({ model: 'Kimi', success: true, latencyMs: 2000 });
    modelHealth.recordModelOutcome({ model: 'Claude', success: false });

    const snapshot = modelHealth.getModelHealthSnapshot();
    expect(snapshot.kimi).toMatchObject({
      score: 1,
      samples: 1,
    });
    expect(snapshot.claude).toMatchObject({
      score: 0,
      samples: 1,
    });

    // Check specific requested models (including one that doesn't exist yet)
    const specificSnapshot = modelHealth.getModelHealthSnapshot(['KIMI', 'UNKNOWN']);
    expect(specificSnapshot.kimi).toBeDefined();
    expect(specificSnapshot.unknown).toMatchObject({
      score: 0.5,
      samples: 0,
    });
  });
});

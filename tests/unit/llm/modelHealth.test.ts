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

  vi.doMock('../../../src/core/config/legacy-config-adapter', () => ({
    config: {
      agenticPersistStateEnabled: options.persistEnabled ?? true,
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
          modelId: 'openai-large',
          score: 0.91,
          samples: 12,
          createdAt: new Date('2026-02-11T18:00:00.000Z'),
          updatedAt: new Date('2026-02-11T18:30:00.000Z'),
        },
      ],
    });

    const score = await modelHealth.getModelHealthScore('OPENAI-LARGE');
    expect(score).toBe(0.91);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(['openai-large']);
  });

  it('falls back to degraded in-memory mode when persistence hydration fails', async () => {
    const { modelHealth, mockWarn } = await loadModelHealth({
      listError: new Error('db read unavailable'),
    });

    const score = await modelHealth.getModelHealthScore('openai-large');
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
      model: 'OpenAI-Large',
      success: true,
      latencyMs: 2_000,
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith({
      modelId: 'openai-large',
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

    const score = await modelHealth.getModelHealthScore('openai-large');
    modelHealth.recordModelOutcome({ model: 'openai-large', success: true, latencyMs: 1_000 });

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
});

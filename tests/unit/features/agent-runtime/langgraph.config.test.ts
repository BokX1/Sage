import { afterEach, describe, expect, it, vi } from 'vitest';
import { importFresh } from '../../../testkit/importFresh';

async function loadConfigModule(envConfig: Record<string, unknown>) {
  vi.doMock('@/platform/config/env', () => ({
    config: envConfig,
  }));
  return importFresh(() => import('@/features/agent-runtime/langgraph/config'));
}

afterEach(() => {
  vi.doUnmock('@/platform/config/env');
});

describe('agent-runtime langgraph config defaults', () => {
  it('uses a derived recursion fail-safe above the slice budget when env overrides are absent', async () => {
    const { buildAgentGraphConfig, deriveAgentGraphRecursionLimit } = await loadConfigModule({});
    const config = buildAgentGraphConfig();

    expect(config.sliceMaxSteps).toBe(10);
    expect(config.recursionLimit).toBe(deriveAgentGraphRecursionLimit(config.sliceMaxSteps));
    expect(config.recursionLimit).toBe(104);
    expect(config.maxToolCallsPerRound).toBe(12);
    expect(config.maxIdenticalToolBatches).toBe(4);
    expect(config.maxLoopGuardRecoveries).toBe(3);
  });

  it('honors an explicit AGENT_GRAPH_RECURSION_LIMIT override when operators set one', async () => {
    const { buildAgentGraphConfig } = await loadConfigModule({
      AGENT_RUN_SLICE_MAX_STEPS: 10,
      AGENT_GRAPH_RECURSION_LIMIT: 77,
    });
    const config = buildAgentGraphConfig();

    expect(config.sliceMaxSteps).toBe(10);
    expect(config.recursionLimit).toBe(77);
  });
});

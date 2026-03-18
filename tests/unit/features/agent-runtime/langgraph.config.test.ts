import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/config/env', () => ({
  config: {},
}));

import { buildAgentGraphConfig } from '@/features/agent-runtime/langgraph/config';

describe('agent-runtime langgraph config defaults', () => {
  it('uses the frontier-tuned recovery defaults when env overrides are absent', () => {
    const config = buildAgentGraphConfig();

    expect(config.sliceMaxSteps).toBe(10);
    expect(config.recursionLimit).toBe(32);
    expect(config.maxToolCallsPerRound).toBe(12);
    expect(config.maxIdenticalToolBatches).toBe(4);
    expect(config.maxLoopGuardRecoveries).toBe(3);
  });
});

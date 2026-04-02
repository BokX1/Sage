import { describe, expect, it } from 'vitest';
import { listRuntimeSurfaceToolNames, getRuntimeSurfaceTools } from '../../../../src/features/agent-runtime/runtimeSurface';
import { auditRuntimeSurface } from '../../../../src/features/agent-runtime/toolAudit';

describe('runtime surface', () => {
  it('exposes only the single code-mode execution surface', () => {
    expect(listRuntimeSurfaceToolNames()).toEqual(['runtime_execute_code']);
    expect(getRuntimeSurfaceTools().map((tool) => tool.name)).toEqual(['runtime_execute_code']);
  });

  it('passes the runtime surface audit for the shipped capability', () => {
    const report = auditRuntimeSurface();

    expect(report.ok).toBe(true);
    expect(report.summary.toolCount).toBe(1);
    expect(report.summary.failCount).toBe(0);
  });
});

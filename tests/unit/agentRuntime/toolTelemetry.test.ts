import { describe, expect, it } from 'vitest';
import { parseTraceToolTelemetry } from '../../../src/core/agentRuntime/toolTelemetry';

describe('toolTelemetry', () => {
  it('parses modern main tool budgets', () => {
    const telemetry = parseTraceToolTelemetry({
      enabled: true,
      routeTools: ['web_search', 'web_get_page_text'],
      main: {
        toolsExecuted: true,
        successfulToolCount: 1,
        toolResultCount: 2,
        failed: true,
      },
    });

    expect(telemetry.enabled).toBe(true);
    expect(telemetry.routeToolCount).toBe(2);
    expect(telemetry.toolsExecuted).toBe(true);
    expect(telemetry.successfulToolCount).toBe(1);
    expect(telemetry.toolResultCount).toBe(2);
    expect(telemetry.toolLoopFailed).toBe(true);
  });

  it('returns empty defaults when tool json is absent', () => {
    const telemetry = parseTraceToolTelemetry(undefined);

    expect(telemetry.signalPresent).toBe(false);
    expect(telemetry.toolsExecuted).toBe(false);
    expect(telemetry.toolLoopFailed).toBe(false);
  });
});

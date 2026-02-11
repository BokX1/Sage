import { describe, expect, it } from 'vitest';
import { parseTraceToolTelemetry } from '../../../src/core/agentRuntime/toolTelemetry';

describe('toolTelemetry', () => {
  it('parses legacy executed schema', () => {
    const telemetry = parseTraceToolTelemetry({ executed: true });

    expect(telemetry.signalPresent).toBe(true);
    expect(telemetry.toolsExecuted).toBe(true);
    expect(telemetry.successfulToolCount).toBe(0);
  });

  it('parses modern main and critic tool budgets', () => {
    const telemetry = parseTraceToolTelemetry({
      enabled: true,
      routeTools: ['web_search', 'web_scrape'],
      main: {
        toolsExecuted: true,
        successfulToolCount: 1,
        toolResultCount: 2,
        hardGateRequired: true,
        hardGateSatisfied: false,
      },
      critic: [
        {
          toolsExecuted: true,
          successfulToolCount: 2,
          toolResultCount: 2,
        },
      ],
    });

    expect(telemetry.enabled).toBe(true);
    expect(telemetry.routeToolCount).toBe(2);
    expect(telemetry.toolsExecuted).toBe(true);
    expect(telemetry.successfulToolCount).toBe(3);
    expect(telemetry.toolResultCount).toBe(4);
    expect(telemetry.hardGateRequired).toBe(true);
    expect(telemetry.hardGateSatisfied).toBe(false);
    expect(telemetry.critic).toHaveLength(1);
  });

  it('returns empty defaults when tool json is absent', () => {
    const telemetry = parseTraceToolTelemetry(undefined);

    expect(telemetry.signalPresent).toBe(false);
    expect(telemetry.toolsExecuted).toBe(false);
    expect(telemetry.hardGateRequired).toBe(false);
    expect(telemetry.hardGateSatisfied).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { resolveRuntimeAutopilotMode } from '../../../../src/features/agent-runtime/autopilotMode';

describe('resolveRuntimeAutopilotMode', () => {
  it('returns null outside autopilot turns', () => {
    expect(
      resolveRuntimeAutopilotMode({
        invokedBy: 'mention',
        configuredMode: 'reserved',
      }),
    ).toBeNull();
  });

  it('returns configured reserved mode for autopilot turns', () => {
    expect(
      resolveRuntimeAutopilotMode({
        invokedBy: 'autopilot',
        configuredMode: 'reserved',
      }),
    ).toBe('reserved');
  });

  it('returns configured talkative mode for autopilot turns', () => {
    expect(
      resolveRuntimeAutopilotMode({
        invokedBy: 'autopilot',
        configuredMode: 'talkative',
      }),
    ).toBe('talkative');
  });

  it('maps manual mode to null', () => {
    expect(
      resolveRuntimeAutopilotMode({
        invokedBy: 'autopilot',
        configuredMode: 'manual',
      }),
    ).toBeNull();
  });
});

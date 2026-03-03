import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  WAKEWORD_COOLDOWN_SEC: 2,
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: 2,
}));

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

import {
  resetInvocationCooldowns,
  shouldAllowInvocation,
} from '../../../src/core/invocation/invocation-rate-limiter';

describe('invocation-rate-limiter', () => {
  beforeEach(() => {
    resetInvocationCooldowns();
    mockConfig.WAKEWORD_COOLDOWN_SEC = 2;
    mockConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL = 2;
    vi.restoreAllMocks();
  });

  it('enforces per-user wakeword cooldown', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    expect(
      shouldAllowInvocation({
        channelId: 'c1',
        userId: 'u1',
        kind: 'wakeword',
      }),
    ).toBe(true);

    nowSpy.mockReturnValue(2_500);
    expect(
      shouldAllowInvocation({
        channelId: 'c1',
        userId: 'u1',
        kind: 'wakeword',
      }),
    ).toBe(false);
  });

  it('enforces per-channel wakeword throughput limits', () => {
    mockConfig.WAKEWORD_COOLDOWN_SEC = 0;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    expect(shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' })).toBe(true);
    nowSpy.mockReturnValue(2_000);
    expect(shouldAllowInvocation({ channelId: 'c1', userId: 'u2', kind: 'wakeword' })).toBe(true);
    nowSpy.mockReturnValue(3_000);
    expect(shouldAllowInvocation({ channelId: 'c1', userId: 'u3', kind: 'wakeword' })).toBe(false);
  });

  it('falls back safely when wakeword config values are non-finite', () => {
    mockConfig.WAKEWORD_COOLDOWN_SEC = Number.NaN;
    mockConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL = Number.NaN;
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    expect(shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' })).toBe(true);
    expect(shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' })).toBe(true);
    expect(shouldAllowInvocation({ channelId: 'c1', userId: 'u2', kind: 'wakeword' })).toBe(true);
  });
});

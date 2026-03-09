import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  WAKEWORD_COOLDOWN_SEC: 2,
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: 2,
}));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

import {
  resetInvocationCooldowns,
  shouldAllowInvocation,
} from '../../../../src/features/invocation/invocation-rate-limiter';

describe('invocation-rate-limiter', () => {
  beforeEach(() => {
    resetInvocationCooldowns();
    mockConfig.WAKEWORD_COOLDOWN_SEC = 2;
    mockConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL = 2;
    vi.restoreAllMocks();
  });

  it('allows non-wakeword invocations without rate limiting', () => {
    const mention = shouldAllowInvocation({
      channelId: 'c1',
      userId: 'u1',
      kind: 'mention',
    });
    const reply = shouldAllowInvocation({
      channelId: 'c1',
      userId: 'u1',
      kind: 'reply',
    });
    const autopilot = shouldAllowInvocation({
      channelId: 'c1',
      userId: 'u1',
      kind: 'autopilot',
    });

    expect([mention, reply, autopilot]).toEqual([true, true, true]);
  });

  it('enforces per-user wakeword cooldown until the boundary', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    const first = shouldAllowInvocation({
      channelId: 'c1',
      userId: 'u1',
      kind: 'wakeword',
    });

    nowSpy.mockReturnValue(2_500);
    const second = shouldAllowInvocation({
      channelId: 'c1',
      userId: 'u1',
      kind: 'wakeword',
    });

    nowSpy.mockReturnValue(3_000);
    const third = shouldAllowInvocation({
      channelId: 'c1',
      userId: 'u1',
      kind: 'wakeword',
    });

    expect([first, second, third]).toEqual([true, false, true]);
  });

  it('enforces per-channel wakeword throughput limits', () => {
    mockConfig.WAKEWORD_COOLDOWN_SEC = 0;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    const first = shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' });
    nowSpy.mockReturnValue(2_000);
    const second = shouldAllowInvocation({ channelId: 'c1', userId: 'u2', kind: 'wakeword' });
    nowSpy.mockReturnValue(3_000);
    const third = shouldAllowInvocation({ channelId: 'c1', userId: 'u3', kind: 'wakeword' });

    expect([first, second, third]).toEqual([true, true, false]);
  });

  it('isolates cooldown keys by channel and user', () => {
    mockConfig.WAKEWORD_COOLDOWN_SEC = 10;
    mockConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL = 0;
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    const firstUser = shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' });
    const secondUserSameChannel = shouldAllowInvocation({ channelId: 'c1', userId: 'u2', kind: 'wakeword' });
    const sameUserDifferentChannel = shouldAllowInvocation({ channelId: 'c2', userId: 'u1', kind: 'wakeword' });

    expect([firstUser, secondUserSameChannel, sameUserDifferentChannel]).toEqual([true, true, true]);
  });

  it('drops wakeword history entries older than one minute', () => {
    mockConfig.WAKEWORD_COOLDOWN_SEC = 0;
    mockConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL = 2;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    const first = shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' });
    nowSpy.mockReturnValue(2_000);
    const second = shouldAllowInvocation({ channelId: 'c1', userId: 'u2', kind: 'wakeword' });
    nowSpy.mockReturnValue(62_000);
    const third = shouldAllowInvocation({ channelId: 'c1', userId: 'u3', kind: 'wakeword' });

    expect([first, second, third]).toEqual([true, true, true]);
  });

  it('computes history freshness using elapsed time, not timestamp sums', () => {
    mockConfig.WAKEWORD_COOLDOWN_SEC = 0;
    mockConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL = 1;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(20_000);
    const first = shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' });
    nowSpy.mockReturnValue(70_000);
    const second = shouldAllowInvocation({ channelId: 'c1', userId: 'u2', kind: 'wakeword' });

    expect([first, second]).toEqual([true, false]);
  });

  it('treats history entries exactly one minute old as expired', () => {
    mockConfig.WAKEWORD_COOLDOWN_SEC = 0;
    mockConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL = 1;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    const first = shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' });
    nowSpy.mockReturnValue(61_000);
    const second = shouldAllowInvocation({ channelId: 'c1', userId: 'u2', kind: 'wakeword' });

    expect([first, second]).toEqual([true, true]);
  });

  it('falls back safely when wakeword config values are non-finite', () => {
    mockConfig.WAKEWORD_COOLDOWN_SEC = Number.NaN;
    mockConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL = Number.NaN;
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    const attempts = [
      shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' }),
      shouldAllowInvocation({ channelId: 'c1', userId: 'u1', kind: 'wakeword' }),
      shouldAllowInvocation({ channelId: 'c1', userId: 'u2', kind: 'wakeword' }),
    ];

    expect(attempts).toEqual([true, true, true]);
  });
});

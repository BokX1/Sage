import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  RATE_LIMIT_WINDOW_SEC: 10,
  RATE_LIMIT_MAX: 5,
}));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

import {
  __getRateLimiterChannelCountForTests,
  __resetRateLimiterStateForTests,
  isRateLimited,
} from '../../../../src/features/chat/rate-limiter';

describe('rate limiter', () => {
  beforeEach(() => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 10;
    mockConfig.RATE_LIMIT_MAX = 5;
    vi.restoreAllMocks();
    __resetRateLimiterStateForTests(0);
  });

  it('allows first message and isolates channels', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    expect({
      firstHit: isRateLimited('chan-1'),
      separateChannelHit: isRateLimited('chan-2'),
    }).toEqual({
      firstHit: false,
      separateChannelHit: false,
    });

  });

  it('enforces configured per-channel cap within the active window', () => {
    mockConfig.RATE_LIMIT_MAX = 3;
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const attempts = [
      isRateLimited('chan-cap'),
      isRateLimited('chan-cap'),
      isRateLimited('chan-cap'),
      isRateLimited('chan-cap'),
    ];

    expect(attempts).toEqual([false, false, false, true]);
  });

  it('drops expired timestamps after window passes', () => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 2;
    mockConfig.RATE_LIMIT_MAX = 2;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    const first = isRateLimited('chan-expire');
    nowSpy.mockReturnValue(1_500);
    const second = isRateLimited('chan-expire');
    nowSpy.mockReturnValue(1_700);
    const third = isRateLimited('chan-expire');
    nowSpy.mockReturnValue(4_000);
    const fourth = isRateLimited('chan-expire');

    expect([first, second, third, fourth]).toEqual([false, false, true, false]);
  });

  it('cleans up stale channels on periodic cleanup', () => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 1;
    mockConfig.RATE_LIMIT_MAX = 10;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    expect(isRateLimited('stale-channel')).toEqual(false);
    expect(__getRateLimiterChannelCountForTests()).toEqual(1);

    nowSpy.mockReturnValue(61_000);
    expect(isRateLimited('fresh-channel')).toEqual(false);
    expect(__getRateLimiterChannelCountForTests()).toEqual(1);
  });

  it('does not run cleanup exactly at the cleanup interval boundary', () => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 1;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    expect(isRateLimited('channel-a')).toEqual(false);
    expect(isRateLimited('channel-b')).toEqual(false);
    expect(__getRateLimiterChannelCountForTests()).toEqual(2);

    nowSpy.mockReturnValue(60_000);
    expect(isRateLimited('channel-c')).toEqual(false);
    expect(__getRateLimiterChannelCountForTests()).toEqual(3);
  });

  it('does not trigger cleanup when the clock moves backwards', () => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 1;
    __resetRateLimiterStateForTests(59_000);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(58_000);
    expect(isRateLimited('backward-a')).toEqual(false);
    expect(__getRateLimiterChannelCountForTests()).toEqual(1);

    nowSpy.mockReturnValue(59_500);
    expect(isRateLimited('backward-b')).toEqual(false);
    expect(__getRateLimiterChannelCountForTests()).toEqual(2);
  });

  it('keeps channels that still have at least one in-window timestamp during cleanup', () => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 60;
    mockConfig.RATE_LIMIT_MAX = 10;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    expect(isRateLimited('mixed-channel')).toEqual(false);
    nowSpy.mockReturnValue(59_500);
    expect(isRateLimited('mixed-channel')).toEqual(false);

    nowSpy.mockReturnValue(61_000);
    expect(isRateLimited('cleanup-trigger')).toEqual(false);
    expect(__getRateLimiterChannelCountForTests()).toEqual(2);
  });

  it('evicts entries exactly at staleness boundary during cleanup', () => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 60.001;
    mockConfig.RATE_LIMIT_MAX = 10;
    __resetRateLimiterStateForTests(-1);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    expect(isRateLimited('boundary-stale')).toEqual(false);

    nowSpy.mockReturnValue(60_001);
    expect(isRateLimited('cleanup-trigger')).toEqual(false);
    expect(__getRateLimiterChannelCountForTests()).toEqual(1);
  });

  it('treats timestamps exactly at the window boundary as expired', () => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 2;
    mockConfig.RATE_LIMIT_MAX = 1;
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    const first = isRateLimited('boundary-channel');
    nowSpy.mockReturnValue(3_000);
    const second = isRateLimited('boundary-channel');

    expect([first, second]).toEqual([false, false]);
  });

  it('falls back to defaults for falsy config values', () => {
    mockConfig.RATE_LIMIT_WINDOW_SEC = 0;
    mockConfig.RATE_LIMIT_MAX = 0;
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const channel = 'chan-defaults';

    const attempts = Array.from({ length: 6 }, () => isRateLimited(channel));
    expect(attempts).toEqual([false, false, false, false, false, true]);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeTimeoutMs } from '@/core/utils/timeout';

describe('normalizeTimeoutMs', () => {
  it('returns fallback when timeout is non-finite', () => {
    expect(
      normalizeTimeoutMs(Number.NaN, {
        fallbackMs: 30_000,
        minMs: 1_000,
        maxMs: 120_000,
      }),
    ).toBe(30_000);
  });

  it('returns fallback when timeout is below min by default', () => {
    expect(
      normalizeTimeoutMs(500, {
        fallbackMs: 30_000,
        minMs: 1_000,
        maxMs: 120_000,
      }),
    ).toBe(30_000);
  });

  it('clamps below-min values when configured', () => {
    expect(
      normalizeTimeoutMs(500, {
        fallbackMs: 30_000,
        minMs: 1_000,
        maxMs: 120_000,
        belowMinMode: 'clamp',
      }),
    ).toBe(1_000);
  });

  it('clamps above max and floors finite values', () => {
    expect(
      normalizeTimeoutMs(999_999.8, {
        fallbackMs: 30_000,
        minMs: 1_000,
        maxMs: 120_000,
      }),
    ).toBe(120_000);
    expect(
      normalizeTimeoutMs(4_500.9, {
        fallbackMs: 30_000,
        minMs: 1_000,
        maxMs: 120_000,
      }),
    ).toBe(4_500);
  });

  it('clamps to JS timer-safe max when no explicit max is provided', () => {
    expect(
      normalizeTimeoutMs(Number.MAX_SAFE_INTEGER, {
        fallbackMs: 30_000,
      }),
    ).toBe(2_147_483_647);
  });
});

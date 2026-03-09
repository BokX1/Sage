import { describe, expect, it } from 'vitest';
import { normalizeTimeoutMs } from '@/shared/utils/timeout';

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

  it('normalizes invalid fallback values before applying bounds', () => {
    expect(
      normalizeTimeoutMs(undefined, {
        fallbackMs: 0,
        minMs: 1_000,
        maxMs: 120_000,
      }),
    ).toBe(30_000);
  });

  it('normalizes non-number fallbackMs inputs to the default fallback', () => {
    expect(
      normalizeTimeoutMs(undefined, {
        fallbackMs: '5000' as unknown as number,
        minMs: 1_000,
        maxMs: 120_000,
      }),
    ).toBe(30_000);
  });

  it('normalizes non-finite numeric fallbackMs inputs to the default fallback', () => {
    expect(
      normalizeTimeoutMs(undefined, {
        fallbackMs: Number.POSITIVE_INFINITY,
        minMs: 1_000,
        maxMs: 120_000,
      }),
    ).toBe(30_000);
  });

  it('treats non-number raw timeout inputs as invalid', () => {
    expect(
      normalizeTimeoutMs('4500' as unknown as number, {
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

  it('accepts values exactly at the min boundary', () => {
    expect(
      normalizeTimeoutMs(1_000, {
        fallbackMs: 30_000,
        minMs: 1_000,
        maxMs: 120_000,
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

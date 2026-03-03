/**
 * @module tests/unit/rate-limiter.test
 * @description Defines the rate limiter.test module.
 */
import { describe, it, expect } from 'vitest';
import { isRateLimited } from '../../src/core/rate-limiter';
import { config } from '../../src/config';

describe('Rate Limiter', () => {
  it('should allow first message', () => {
    expect(isRateLimited('chan-1')).toBe(false);
  });

  it('enforces configured per-channel cap', () => {
    const channel = `chan-cap-${Date.now()}`;
    for (let i = 0; i < config.RATE_LIMIT_MAX; i += 1) {
      expect(isRateLimited(channel)).toBe(false);
    }
    expect(isRateLimited(channel)).toBe(true);
  });
});

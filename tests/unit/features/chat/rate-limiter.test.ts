import { describe, it, expect } from 'vitest';
import { isRateLimited } from '../../../../src/features/chat/rate-limiter';
import { config } from '../../../../src/platform/config/env';

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

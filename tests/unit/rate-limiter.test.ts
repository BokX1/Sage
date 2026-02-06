import { describe, it, expect } from 'vitest';
import { isRateLimited } from '../../src/core/rate-limiter';
import { config } from '../../src/core/config/legacy-config-adapter';

describe('Rate Limiter', () => {
  it('should allow first message', () => {
    expect(isRateLimited('chan-1')).toBe(false);
  });

  it('falls back to defaults when config values are invalid', () => {
    const originalMax = config.rateLimitMax;
    const originalWindow = config.rateLimitWindowSec;

    try {
      config.rateLimitMax = 'NaN';
      config.rateLimitWindowSec = '0';

      const channel = `chan-fallback-${Date.now()}`;
      for (let i = 0; i < 5; i += 1) {
        expect(isRateLimited(channel)).toBe(false);
      }
      expect(isRateLimited(channel)).toBe(true);
    } finally {
      config.rateLimitMax = originalMax;
      config.rateLimitWindowSec = originalWindow;
    }
  });
});

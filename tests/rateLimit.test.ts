import { describe, it, expect } from 'vitest';
import { isRateLimited } from '../src/core/rate-limiter';

describe('Rate Limiter', () => {
  it('should allow first message', () => {
    expect(isRateLimited('chan-1')).toBe(false);
  });
});

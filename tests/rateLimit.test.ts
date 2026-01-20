import { describe, it, expect } from 'vitest';
import { isRateLimited } from '../src/core/safety';

describe('Rate Limiter', () => {
  it('should allow first message', () => {
    expect(isRateLimited('chan-1')).toBe(false);
  });
});

/**
 * @module tests/unit/llm/circuit-breaker.test
 * @description Validates circuit breaker guardrails and config normalization.
 */
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../../src/core/llm/circuit-breaker';

describe('CircuitBreaker', () => {
  it('uses default reset timeout when an invalid value is provided', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: -1 });

    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // If reset timeout were still -1, this would immediately transition to HALF_OPEN.
    expect(breaker.isOpen()).toBe(true);
  });

  it('uses default failure threshold when an invalid value is provided', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: -1, resetTimeoutMs: 1_000 });

    for (let i = 0; i < 4; i += 1) {
      await expect(
        breaker.execute(async () => {
          throw new Error('transient');
        }),
      ).rejects.toThrow('transient');
    }
    expect(breaker.isOpen()).toBe(false);

    await expect(
      breaker.execute(async () => {
        throw new Error('transient');
      }),
    ).rejects.toThrow('transient');
    expect(breaker.isOpen()).toBe(true);
  });
});

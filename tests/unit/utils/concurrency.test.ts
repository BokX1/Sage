/**
 * @module tests/unit/utils/concurrency.test
 * @description Defines the concurrency.test module.
 */
import { describe, expect, it } from 'vitest';

import { limitConcurrency } from '../../../src/core/utils/concurrency';

describe('limitConcurrency', () => {
  it('throws for non-positive concurrency values', () => {
    expect(() => limitConcurrency(0)).toThrow(RangeError);
    expect(() => limitConcurrency(-1)).toThrow('concurrency must be a positive integer');
  });

  it('throws for non-integer concurrency values', () => {
    expect(() => limitConcurrency(1.5)).toThrow(RangeError);
    expect(() => limitConcurrency(Number.NaN)).toThrow(RangeError);
  });

  it('executes tasks with valid concurrency', async () => {
    const limiter = limitConcurrency(1);
    const order: string[] = [];

    await Promise.all([
      limiter(async () => {
        order.push('first:start');
        await Promise.resolve();
        order.push('first:end');
      }),
      limiter(async () => {
        order.push('second:start');
        order.push('second:end');
      })
    ]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('continues draining queued tasks after a task rejection', async () => {
    const limiter = limitConcurrency(1);
    const order: string[] = [];

    const first = limiter(async () => {
      order.push('first:start');
      throw new Error('boom');
    });

    const second = limiter(async () => {
      order.push('second:start');
      return 'ok';
    });

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
    expect(order).toEqual(['first:start', 'second:start']);
  });
});

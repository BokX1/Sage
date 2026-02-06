import { beforeEach, describe, expect, it } from 'vitest';

import { clearKeyLimit, limitByKey } from '../../../src/core/utils/perKeyConcurrency';

describe('perKeyConcurrency', () => {
  beforeEach(() => {
    clearKeyLimit('user-a');
    clearKeyLimit('user-b');
  });

  it('throws for non-positive and non-integer concurrency values', () => {
    expect(() => limitByKey('user-a', 0)).toThrow(RangeError);
    expect(() => limitByKey('user-a', -1)).toThrow(RangeError);
    expect(() => limitByKey('user-a', Number.NaN)).toThrow(RangeError);
    expect(() => limitByKey('user-a', 1.1)).toThrow(RangeError);
  });

  it('throws when an existing key is requested with a different concurrency', () => {
    limitByKey('user-a', 1);
    expect(() => limitByKey('user-a', 2)).toThrow('concurrency for key "user-a" is already set to 1');
  });

  it('allows reconfiguration after clearing a key', async () => {
    const limiter1 = limitByKey('user-a', 1);
    await limiter1(async () => Promise.resolve());

    clearKeyLimit('user-a');

    const limiter2 = limitByKey('user-a', 2);
    await Promise.all([limiter2(async () => Promise.resolve()), limiter2(async () => Promise.resolve())]);
  });
});

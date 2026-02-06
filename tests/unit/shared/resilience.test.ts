import { describe, expect, it } from 'vitest';
import { retry, withTimeout } from '../../../src/shared/async/resilience';

describe('resilience utilities', () => {
  it('withTimeout resolves when operation completes in time', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 50, 'test op');
    expect(result).toBe('ok');
  });

  it('retry retries and eventually succeeds', async () => {
    let attempts = 0;
    const result = await retry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('flaky');
        return 'done';
      },
      { retries: 3, baseDelayMs: 1, operationName: 'flaky op' },
    );

    expect(result).toBe('done');
    expect(attempts).toBe(3);
  });
});

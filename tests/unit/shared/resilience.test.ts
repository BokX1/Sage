import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/shared/errors/app-error';
import { retry, withTimeout } from '../../../src/shared/async/resilience';

describe('resilience utilities', () => {
  it('withTimeout resolves when operation completes in time', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 50, 'test op');
    expect(result).toBe('ok');
  });

  it('withTimeout rejects with TIMEOUT when operation exceeds deadline', async () => {
    await expect(withTimeout(new Promise(() => {}), 5, 'slow op')).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'slow op timed out after 5ms',
    });
  });

  it('withTimeout validates timeoutMs', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 0, 'invalid')).rejects.toThrow(
      'timeoutMs must be a positive integer',
    );
    await expect(withTimeout(Promise.resolve('ok'), Number.NaN, 'invalid')).rejects.toThrow(RangeError);
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

  it('retry surfaces AppError with cause after exhausting attempts', async () => {
    const failure = new Error('always fails');

    await expect(
      retry(async () => Promise.reject(failure), { retries: 1, baseDelayMs: 1, operationName: 'always fails op' }),
    ).rejects.toMatchObject({
      code: 'EXTERNAL_CALL_FAILED',
      message: 'always fails op failed after 2 attempts',
      cause: failure,
    } satisfies Partial<AppError>);
  });

  it('retry validates retries and baseDelayMs', async () => {
    await expect(
      retry(async () => 'ok', { retries: -1, baseDelayMs: 1, operationName: 'bad retries' }),
    ).rejects.toThrow('retries must be a non-negative integer');

    await expect(
      retry(async () => 'ok', { retries: 1.2, baseDelayMs: 1, operationName: 'bad retries' }),
    ).rejects.toThrow(RangeError);

    await expect(
      retry(async () => 'ok', { retries: 0, baseDelayMs: 0, operationName: 'bad delay' }),
    ).rejects.toThrow('baseDelayMs must be a positive integer');
  });
});

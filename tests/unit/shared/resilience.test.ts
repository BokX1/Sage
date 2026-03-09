import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/shared/errors/app-error';
import { retry, withTimeout } from '../../../src/shared/async/resilience';

describe('resilience utilities', () => {
  it('withTimeout resolves when operation completes in time', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 50, 'test op');
    expect(result).toBe('ok');
  });

  it('withTimeout registers an unref timer and clears it after resolve', async () => {
    const unref = vi.fn();
    const fakeTimer = { unref } as unknown as NodeJS.Timeout;
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((() => fakeTimer) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const result = await withTimeout(Promise.resolve('ok'), 50, 'fast op');

    expect(result).toBe('ok');
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('withTimeout clamps timer registration delay to the JS-safe max', async () => {
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((() => ({ unref: vi.fn() }) as unknown as NodeJS.Timeout) as unknown as typeof setTimeout);

    await withTimeout(Promise.resolve('ok'), Number.MAX_SAFE_INTEGER, 'clamped op');

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647);
    setTimeoutSpy.mockRestore();
  });

  it('withTimeout tolerates timer handles without unref', async () => {
    const fakeTimer = {} as NodeJS.Timeout;
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((() => fakeTimer) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout').mockImplementation(() => undefined);

    await expect(withTimeout(Promise.resolve('ok'), 50, 'no unref op')).resolves.toBe('ok');
    expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('withTimeout still throws a TIMEOUT AppError when no-unref timers fire', async () => {
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(
        ((callback: () => void) => {
          queueMicrotask(callback);
          return {} as NodeJS.Timeout;
        }) as unknown as typeof setTimeout,
      );

    await expect(withTimeout(new Promise(() => {}), 1, 'microtask timeout')).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'microtask timeout timed out after 1ms',
    });

    setTimeoutSpy.mockRestore();
  });

  it('withTimeout does not clear timeout when timer setup throws before assignment', async () => {
    const setupError = new Error('timer setup failed');
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((() => {
        throw setupError;
      }) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    await expect(withTimeout(new Promise(() => {}), 5, 'setup failure op')).rejects.toBe(setupError);
    expect(clearTimeoutSpy).not.toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
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

  it('retry makes exactly retries + 1 attempts before failing', async () => {
    let attempts = 0;
    await expect(
      retry(
        async () => {
          attempts += 1;
          throw new Error('nope');
        },
        { retries: 2, baseDelayMs: 1, operationName: 'attempt counter op' },
      ),
    ).rejects.toMatchObject({
      code: 'EXTERNAL_CALL_FAILED',
      message: 'attempt counter op failed after 3 attempts',
    });

    expect(attempts).toBe(3);
  });

  it('retry uses exponential backoff delays and unrefs sleep timers', async () => {
    const unref = vi.fn();
    const delays: number[] = [];
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(
        ((callback: () => void, delay?: number) => {
          delays.push(delay as number);
          callback();
          return { unref } as unknown as NodeJS.Timeout;
        }) as unknown as typeof setTimeout,
      );

    let attempts = 0;
    const result = await retry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('transient');
        return 'ok';
      },
      { retries: 3, baseDelayMs: 5, operationName: 'backoff op' },
    );

    expect(result).toBe('ok');
    expect(delays).toEqual([5, 10]);
    expect(unref).toHaveBeenCalledTimes(2);
    setTimeoutSpy.mockRestore();
  });

  it('retry sleep works when timer handles do not expose unref', async () => {
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(
        ((callback: () => void) => {
          callback();
          return {} as NodeJS.Timeout;
        }) as unknown as typeof setTimeout,
      );
    let attempts = 0;

    const result = await retry(
      async () => {
        attempts += 1;
        if (attempts < 2) throw new Error('retry once');
        return 'ok';
      },
      { retries: 2, baseDelayMs: 5, operationName: 'no unref retry op' },
    );

    expect(result).toBe('ok');
    setTimeoutSpy.mockRestore();
  });

  it('retry does not sleep after the final failed attempt', async () => {
    const delays: number[] = [];
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(
        ((callback: () => void, delay?: number) => {
          delays.push(delay as number);
          callback();
          return { unref: vi.fn() } as unknown as NodeJS.Timeout;
        }) as unknown as typeof setTimeout,
      );

    await expect(
      retry(async () => Promise.reject(new Error('still failing')), {
        retries: 2,
        baseDelayMs: 5,
        operationName: 'no-final-sleep-op',
      }),
    ).rejects.toMatchObject({
      code: 'EXTERNAL_CALL_FAILED',
      message: 'no-final-sleep-op failed after 3 attempts',
    });
    expect(delays).toEqual([5, 10]);

    setTimeoutSpy.mockRestore();
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

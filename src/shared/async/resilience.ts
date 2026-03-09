/**
 * @description Provides shared timeout and retry helpers for external calls.
 */
import { AppError } from '../errors/app-error';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}

/** Clamp timer delays to Node.js' maximum supported setTimeout value. */
function clampTimerDelayMs(delayMs: number): number {
  return Math.min(delayMs, MAX_TIMER_DELAY_MS);
}

function unrefTimerHandle(timer: NodeJS.Timeout): void {
  if (typeof timer.unref !== 'function') return;
  timer.unref();
}

/** Wait for the provided delay without keeping the process alive on its own. */
function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, clampTimerDelayMs(delayMs));
    unrefTimerHandle(timeoutId);
  });
}

/**
 * Resolve a promise or fail with a typed timeout error after a deadline.
 *
 * @param promise - Promise to race against the timeout.
 * @param timeoutMs - Timeout in milliseconds.
 * @param operation - Human-readable operation label used in the error message.
 * @returns Resolves with the original promise result when it completes in time.
 * @throws {RangeError} When `timeoutMs` is not a positive integer.
 * @throws {AppError} With code `TIMEOUT` when the deadline is exceeded.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  assertPositiveInteger(timeoutMs, 'timeoutMs');

  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new AppError('TIMEOUT', `${operation} timed out after ${timeoutMs}ms`));
        }, clampTimerDelayMs(timeoutMs));
        unrefTimerHandle(timeoutId);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Retry an async operation with exponential backoff.
 *
 * @param operation - Async operation to execute.
 * @param opts - Retry policy options.
 * @returns Resolves with the successful operation result.
 * @throws {RangeError} When retry options are invalid.
 * @throws {AppError} With code `EXTERNAL_CALL_FAILED` after retries are exhausted.
 */
export async function retry<T>(
  operation: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number; operationName: string },
): Promise<T> {
  if (!Number.isInteger(opts.retries) || opts.retries < 0) {
    throw new RangeError('retries must be a non-negative integer');
  }
  assertPositiveInteger(opts.baseDelayMs, 'baseDelayMs');

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === opts.retries) break;
      await sleep(opts.baseDelayMs * 2 ** attempt);
    }
  }

  throw new AppError(
    'EXTERNAL_CALL_FAILED',
    `${opts.operationName} failed after ${opts.retries + 1} attempts`,
    lastError,
  );
}

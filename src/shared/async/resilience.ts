import { AppError } from '../errors/app-error';

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  assertPositiveInteger(timeoutMs, 'timeoutMs');

  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new AppError('TIMEOUT', `${operation} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

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
      await new Promise((resolve) => setTimeout(resolve, opts.baseDelayMs * 2 ** attempt));
    }
  }

  throw new AppError(
    'EXTERNAL_CALL_FAILED',
    `${opts.operationName} failed after ${opts.retries + 1} attempts`,
    lastError,
  );
}

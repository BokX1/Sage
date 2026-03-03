/**
 * @module src/shared/errors/app-error
 * @description Defines shared typed errors and normalization helpers.
 */
export type ErrorCode =
  | 'CONFIG_INVALID'
  | 'BOOTSTRAP_FAILED'
  | 'DISCORD_LOGIN_FAILED'
  | 'EXTERNAL_CALL_FAILED'
  | 'TIMEOUT';

/**
 * Represent a first-party application error with a stable error code.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'AppError';
    Error.captureStackTrace?.(this, AppError);
  }
}

/**
 * Normalize an unknown thrown value into an `AppError`.
 *
 * @param error - Thrown value to normalize.
 * @param fallbackCode - Fallback code to use for non-`AppError` inputs.
 * @returns A typed `AppError` instance.
 */
export function toErrorWithCode(error: unknown, fallbackCode: ErrorCode): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) return new AppError(fallbackCode, error.message, error);
  return new AppError(fallbackCode, String(error));
}

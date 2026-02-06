export type ErrorCode =
  | 'CONFIG_INVALID'
  | 'BOOTSTRAP_FAILED'
  | 'DISCORD_LOGIN_FAILED'
  | 'EXTERNAL_CALL_FAILED'
  | 'TIMEOUT';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toErrorWithCode(error: unknown, fallbackCode: ErrorCode): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) return new AppError(fallbackCode, error.message, error);
  return new AppError(fallbackCode, String(error));
}

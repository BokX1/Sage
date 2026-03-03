/**
 * @description Verifies AppError construction and unknown-error normalization.
 */
import { describe, expect, it } from 'vitest';
import { AppError, toErrorWithCode } from '../../../src/shared/errors/app-error';

describe('AppError', () => {
  it('sets code and name for first-party errors', () => {
    const error = new AppError('CONFIG_INVALID', 'invalid config');

    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.name).toBe('AppError');
    expect(error).toBeInstanceOf(AppError);
  });

  it('returns the original instance when already AppError', () => {
    const original = new AppError('TIMEOUT', 'timeout');
    const normalized = toErrorWithCode(original, 'EXTERNAL_CALL_FAILED');

    expect(normalized).toBe(original);
  });

  it('wraps native errors and preserves cause', () => {
    const root = new Error('boom');
    const normalized = toErrorWithCode(root, 'BOOTSTRAP_FAILED');

    expect(normalized).toBeInstanceOf(AppError);
    expect(normalized.code).toBe('BOOTSTRAP_FAILED');
    expect(normalized.message).toBe('boom');
    expect(normalized.cause).toBe(root);
  });

  it('wraps non-error values with stringified messages', () => {
    const normalized = toErrorWithCode(1234, 'DISCORD_LOGIN_FAILED');

    expect(normalized).toBeInstanceOf(AppError);
    expect(normalized.code).toBe('DISCORD_LOGIN_FAILED');
    expect(normalized.message).toBe('1234');
  });
});

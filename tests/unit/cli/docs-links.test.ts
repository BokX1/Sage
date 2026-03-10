import { afterEach, describe, expect, it, vi } from 'vitest';

const checkerPath = '../../../scripts/docs/check-links.cjs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('docs link checker external retries', () => {
  it('retries retryable HTTP statuses before succeeding', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const checker = await import(checkerPath);
    const { fetchWithRetries } = checker.default ?? checker;
    const response = await fetchWithRetries(
      'https://example.com/docs',
      'HEAD',
      { timeout_ms: 25 },
      { maxAttempts: 2, baseDelayMs: 0 },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/docs',
      expect.objectContaining({
        method: 'HEAD',
        headers: { 'user-agent': 'SageDocsLinkChecker/1.0 (+https://github.com/BokX1/Sage)' },
      }),
    );
  });

  it('treats aborts and transient network failures as retryable', async () => {
    const checker = await import(checkerPath);
    const { isRetryableFetchError, isRetryableStatus } = checker.default ?? checker;

    const abortError = new Error('This operation timed out');
    abortError.name = 'AbortError';

    expect(isRetryableFetchError(abortError)).toBe(true);
    expect(isRetryableFetchError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableFetchError(new Error('certificate rejected'))).toBe(false);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

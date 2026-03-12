import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubFetch, type FetchMock } from '../../../testkit/fetch';
import {
  discordRestRequest,
  inspectDiscordRestRateLimitStateForTests,
  resetDiscordRestRateLimitStateForTests,
} from '@/platform/discord/discordRest';

function makeHeaders(values: Record<string, string>): { get: (name: string) => string | null } {
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    lower.set(key.toLowerCase(), value);
  }
  return {
    get: (name: string) => lower.get(name.toLowerCase()) ?? null,
  };
}

async function waitForMicrotaskCondition(check: () => boolean, maxTicks = 32): Promise<void> {
  for (let index = 0; index < maxTicks; index += 1) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for async test condition.');
}

describe('discordRestRequest reliability', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    fetchMock = stubFetch();
    fetchMock.mockReset();
    resetDiscordRestRateLimitStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDiscordRestRateLimitStateForTests();
  });

  it('retries multiple 429 responses until success within retry budget', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: makeHeaders({
          'content-type': 'application/json',
          'retry-after': '0',
          'x-ratelimit-bucket': 'bucket-1',
        }),
        text: async () => JSON.stringify({ retry_after: 0, global: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: makeHeaders({
          'content-type': 'application/json',
          'retry-after': '0',
          'x-ratelimit-bucket': 'bucket-1',
        }),
        text: async () => JSON.stringify({ retry_after: 0, global: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ id: 'me' }),
      });

    const result = await discordRestRequest({
      method: 'GET',
      path: '/users/@me',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries 429 responses for POST writes because the request was rate-limited, not processed', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: makeHeaders({
          'content-type': 'application/json',
          'retry-after': '0',
          'x-ratelimit-bucket': 'bucket-post',
        }),
        text: async () => JSON.stringify({ retry_after: 0, global: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ id: 'msg-1' }),
      });

    const result = await discordRestRequest({
      method: 'POST',
      path: '/channels/123/messages',
      body: { content: 'hello' },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries transient 5xx responses', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: makeHeaders({ 'content-type': 'application/json', 'retry-after': '0' }),
        text: async () => JSON.stringify({ message: 'Temporary outage' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ id: 'me' }),
      });

    const result = await discordRestRequest({
      method: 'GET',
      path: '/users/@me',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry transient 5xx responses for non-idempotent POST writes by default', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: makeHeaders({ 'content-type': 'application/json', 'retry-after': '0' }),
      text: async () => JSON.stringify({ message: 'Temporary outage' }),
    });

    const result = await discordRestRequest({
      method: 'POST',
      path: '/channels/123/messages',
      body: { content: 'hello' },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows explicit non-idempotent retries when opted-in', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: makeHeaders({ 'content-type': 'application/json', 'retry-after': '0' }),
        text: async () => JSON.stringify({ message: 'Temporary outage' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ id: 'msg-1' }),
      });

    const result = await discordRestRequest({
      method: 'POST',
      path: '/channels/123/messages',
      body: { content: 'hello' },
      allowNonIdempotentRetries: true,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-idempotent POST writes after transport failures by default', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(
      discordRestRequest({
        method: 'POST',
        path: '/channels/123/messages',
        body: { content: 'hello' },
      }),
    ).rejects.toThrow(/socket hang up/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coordinates global rate-limit holds across concurrent requests', async () => {
    vi.useFakeTimers();
    const callTimes: number[] = [];

    fetchMock.mockImplementation(async () => {
      callTimes.push(Date.now());
      const callIndex = callTimes.length;
      if (callIndex === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: makeHeaders({
            'content-type': 'application/json',
            'retry-after': '0.2',
            'x-ratelimit-scope': 'global',
          }),
          text: async () => JSON.stringify({ retry_after: 0.2, global: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ id: `req-${callIndex}` }),
      };
    });

    const firstRequest = discordRestRequest({ method: 'GET', path: '/users/@me' });
    await waitForMicrotaskCondition(
      () => inspectDiscordRestRateLimitStateForTests().globalHoldUntilMs > Date.now(),
    );
    const secondRequest = discordRestRequest({ method: 'GET', path: '/users/@me' });
    await vi.advanceTimersByTimeAsync(250);

    const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(200);
    expect(callTimes[2] - callTimes[0]).toBeGreaterThanOrEqual(200);
  });

  it('tracks bucket holds on 429 responses and honors retry_after delays', async () => {
    vi.useFakeTimers();
    const callTimes: number[] = [];

    fetchMock.mockImplementation(async () => {
      callTimes.push(Date.now());
      const callIndex = callTimes.length;
      if (callIndex === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: makeHeaders({
            'content-type': 'application/json',
            'retry-after': '0.15',
            'x-ratelimit-bucket': 'bucket-chan-123',
          }),
          text: async () => JSON.stringify({ retry_after: 0.15, global: false }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({
          'content-type': 'application/json',
          'x-ratelimit-bucket': 'bucket-chan-123',
        }),
        text: async () => JSON.stringify({ ok: true }),
      };
    });

    const request = discordRestRequest({
      method: 'GET',
      path: '/channels/123/messages',
      query: { limit: 1 },
    });
    await waitForMicrotaskCondition(() => {
      const state = inspectDiscordRestRateLimitStateForTests();
      const holdUntilMs = state.bucketHoldUntilMs['bucket-chan-123'] ?? 0;
      return holdUntilMs > Date.now();
    });
    await vi.advanceTimersByTimeAsync(200);

    const result = await request;
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(150);
  });

  it('tracks remaining=0 reset-after windows to delay subsequent route calls', async () => {
    vi.useFakeTimers();

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({
          'content-type': 'application/json',
          'x-ratelimit-bucket': 'bucket-chan-123',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset-after': '0.2',
        }),
        text: async () => JSON.stringify({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: makeHeaders({
          'content-type': 'application/json',
          'x-ratelimit-bucket': 'bucket-chan-123',
        }),
        text: async () => JSON.stringify({ ok: true }),
      });

    const firstResult = await discordRestRequest({
      method: 'GET',
      path: '/channels/123/messages',
      query: { limit: 1 },
    });

    expect(firstResult.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const secondRequest = discordRestRequest({
      method: 'GET',
      path: '/channels/123/messages',
      query: { limit: 1 },
    });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    const secondResult = await secondRequest;
    expect(secondResult.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('encodes and bounds audit-log-reason headers to Discord limits', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      statusText: 'No Content',
      headers: makeHeaders({ 'content-type': 'application/json' }),
      text: async () => '',
    });

    const reason = `${'é'.repeat(400)}\nraid cleanup`;
    const result = await discordRestRequest({
      method: 'DELETE',
      path: '/channels/123/messages/456',
      reason,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const encodedReason = (init?.headers as Record<string, string>)['X-Audit-Log-Reason'];
    expect(encodedReason).toBeDefined();
    expect(encodedReason.length).toBeLessThanOrEqual(512);
    expect(() => decodeURIComponent(encodedReason)).not.toThrow();
    const decodedReason = decodeURIComponent(encodedReason);
    expect(reason.startsWith(decodedReason)).toBe(true);
  });
});

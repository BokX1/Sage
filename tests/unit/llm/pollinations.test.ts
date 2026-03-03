/**
 * @module tests/unit/llm/pollinations.test
 * @description Defines the pollinations.test module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PollinationsClient } from '@/core/llm/pollinations-client';
import { stubFetch, type FetchMock } from '../../testkit/fetch';

type RequestBody = {
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ function?: { name?: string; parameters?: unknown } }>;
  response_format?: unknown;
};

function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasKeyDeep(item, key));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return true;
    }
    return Object.values(record).some((nested) => hasKeyDeep(nested, key));
  }

  return false;
}

function parseRequestBody(fetchMock: FetchMock, callIndex: number): RequestBody {
  const call = fetchMock.mock.calls[callIndex];
  const init = call?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? '{}') as RequestBody;
}

describe('PollinationsClient', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = stubFetch();
  });

  it('rejects non-HTTPS base URLs', () => {
    expect(() => new PollinationsClient({ baseUrl: 'http://api.test/v1' })).toThrow(
      'LLM base URL must use HTTPS.',
    );
  });

  it('normalizes baseUrl by removing suffixes', async () => {
    const client = new PollinationsClient({ baseUrl: 'https://api.test/v1/chat/completions' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => 'ok',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({ messages: [] });

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/v1/chat/completions', expect.anything());
  });

  it('normalizes baseUrl by removing a trailing slash', async () => {
    const client = new PollinationsClient({ baseUrl: 'https://api.test/v1/' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => 'ok',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({ messages: [] });

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/v1/chat/completions', expect.anything());
  });

  it('clamps negative maxRetries and still performs the initial request attempt', async () => {
    const client = new PollinationsClient({ maxRetries: -5 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Internal Server Error',
      json: async () => ({}),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    });

    await expect(client.chat({ messages: [] })).rejects.toThrow('Pollinations API error: 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the configured timeout when request timeout override is invalid', async () => {
    const client = new PollinationsClient({ timeoutMs: 2_500, maxRetries: 0 });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    try {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        text: async () => 'ok',
      } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

      await client.chat({ messages: [], timeout: -10 });
      expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toContain(2_500);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('clamps oversized request timeout overrides to safe bounds', async () => {
    const client = new PollinationsClient({ maxRetries: 0 });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    try {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        text: async () => 'ok',
      } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

      await client.chat({ messages: [], timeout: Number.MAX_SAFE_INTEGER });
      expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toContain(300_000);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('collapses multiple system messages into one consolidated block', async () => {
    const client = new PollinationsClient({ baseUrl: 'https://api.test/v1' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => 'ok',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [
        { role: 'system', content: 'System A' },
        { role: 'user', content: 'User 1' },
        { role: 'system', content: 'System B' },
        { role: 'assistant', content: 'Assistant 1' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = parseRequestBody(fetchMock, 0);
    const systemMessages = body.messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(String(systemMessages[0]?.content)).toContain('System A');
    expect(String(systemMessages[0]?.content)).toContain('System B');
    expect(body.messages[0]?.role).toBe('system');
  });

  it('strips unsupported $schema keys from tool parameters before sending requests', async () => {
    const client = new PollinationsClient({ baseUrl: 'https://api.test/v1' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => 'ok',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [{ role: 'user', content: 'run tool' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'google_search',
            parameters: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  $schema: 'http://json-schema.org/draft-07/schema#',
                },
              },
              required: ['query'],
            },
          },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = parseRequestBody(fetchMock, 0);

    expect(body.tools).toHaveLength(1);
    expect(body.tools?.[0]?.function?.parameters).toMatchObject({
      type: 'object',
      properties: {
        query: {
          type: 'string',
        },
      },
      required: ['query'],
    });
    expect(hasKeyDeep(body.tools?.[0]?.function?.parameters, '$schema')).toBe(false);
  });

  it('retries without response_format on 400 response_format errors', async () => {
    const client = new PollinationsClient({ maxRetries: 1 });

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Error: response_format is not supported by this model',
        json: async () => ({}),
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
        json: () => Promise<unknown>;
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: '{"json": true}' } }] }),
        text: async () => '{"json": true}',
      } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({ messages: [], responseFormat: 'json_object' });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const body1 = parseRequestBody(fetchMock, 0);
    expect(body1).toHaveProperty('response_format');

    const body2 = parseRequestBody(fetchMock, 1);
    expect(body2).not.toHaveProperty('response_format');

    const systemMsg = body2.messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(String(systemMsg?.content)).toContain('IMPORTANT: You must output strictly valid JSON only');
  });

  it('does not retry when error is unrelated to json mode', async () => {
    const client = new PollinationsClient({ maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Internal Server Error',
      json: async () => ({}),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    });

    await expect(client.chat({ messages: [], responseFormat: 'json_object' })).rejects.toThrow(
      'Pollinations API error: 500',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast (no retry) on 400 model validation errors', async () => {
    const client = new PollinationsClient({ maxRetries: 3 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'Model validation failed. Expected one of: openai, ...',
      json: async () => ({}),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    });

    await expect(client.chat({ messages: [] })).rejects.toThrow('Pollinations Model Error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('disables response_format and injects prompts for gemini-search when tools + json_object are requested', async () => {
    const client = new PollinationsClient({ model: 'gemini-search' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
      text: async () => '{}',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      responseFormat: 'json_object',
      tools: [
        {
          type: 'function',
          function: {
            name: 'google_search',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = parseRequestBody(fetchMock, 0);

    expect(body).not.toHaveProperty('response_format');
    expect(body.tools).toHaveLength(1);
    expect(body.tools?.[0]?.function?.name).toBe('google_search');

    const systemMsg = body.messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(String(systemMsg?.content)).toContain('IMPORTANT: You must output strictly valid JSON only');
    expect(String(systemMsg?.content)).toContain('You have access to google_search tool');
  });

  it('disables response_format for gemini-search without tools', async () => {
    const client = new PollinationsClient({ model: 'gemini-search' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
      text: async () => '{}',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      responseFormat: 'json_object',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = parseRequestBody(fetchMock, 0);

    expect(body).not.toHaveProperty('response_format');

    const systemMsg = body.messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(String(systemMsg?.content)).toContain('IMPORTANT: You must output strictly valid JSON only');
    expect(String(systemMsg?.content)).not.toContain('You have access to google_search tool');
  });

  it('keeps native response_format for non-gemini models when tools + json_object are requested', async () => {
    const client = new PollinationsClient({ model: 'kimi' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
      text: async () => '{}',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      responseFormat: 'json_object',
      tools: [
        {
          type: 'function',
          function: {
            name: 'google_search',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = parseRequestBody(fetchMock, 0);

    expect(body).toHaveProperty('response_format');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages.some((m) => m.role === 'system')).toBe(false);
  });
});

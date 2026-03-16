import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiProviderClient } from '@/platform/llm/ai-provider-client';
import { stubFetch, type FetchMock } from '../../../testkit/fetch';

type RequestBody = {
  messages: Array<{
    role: string;
    content: unknown;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
    tool_call_id?: string;
  }>;
  tools?: Array<{ function?: { name?: string; parameters?: unknown } }>;
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

describe('AiProviderClient', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = stubFetch();
  });

  it('rejects non-HTTP(S) base URLs', () => {
    expect(() =>
      new AiProviderClient({ baseUrl: 'ftp://api.test/v1', model: 'test-chat-model' }),
    ).toThrow('AI provider base URL must use HTTP(S).');
  });

  it('normalizes baseUrl by removing suffixes', async () => {
    const client = new AiProviderClient({
      baseUrl: 'https://api.test/v1/chat/completions',
      model: 'test-chat-model',
    });

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
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1/', model: 'test-chat-model' });

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
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: -5 });

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

    await expect(client.chat({ messages: [] })).rejects.toThrow('AI provider API error: 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the configured timeout when request timeout override is invalid', async () => {
    const client = new AiProviderClient({
      baseUrl: 'https://api.test/v1',
      model: 'test-chat-model',
      timeoutMs: 2_500,
      maxRetries: 0,
    });
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
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });
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
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model' });

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

    const body = parseRequestBody(fetchMock, 0);
    const systemMessages = body.messages.filter((message) => message.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(String(systemMessages[0]?.content)).toContain('System A');
    expect(String(systemMessages[0]?.content)).toContain('System B');
    expect(body.messages[0]?.role).toBe('system');
  });

  it('preserves multimodal user history instead of rewriting older images into text-only placeholders', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => 'ok',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [
        { role: 'system', content: 'System' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'First turn' },
            { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
          ],
        },
        { role: 'user', content: 'Second turn' },
      ],
    });

    const body = parseRequestBody(fetchMock, 0);
    const userMessages = body.messages.filter((message) => message.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(Array.isArray(userMessages[0]?.content)).toBe(true);
    const parts = userMessages[0]?.content as Array<Record<string, unknown>>;
    expect(parts).toEqual(
      expect.arrayContaining([
        { type: 'text', text: 'First turn' },
        { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
        { type: 'text', text: 'Second turn' },
      ]),
    );
  });

  it('strips unsupported $schema keys from tool parameters before sending requests', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model' });

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

  it('fails when tool parameter schemas omit the top-level object type', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model' });

    await expect(
      client.chat({
      messages: [{ role: 'user', content: 'run tool' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'discord_server',
            parameters: {
              properties: {
                action: {
                  type: 'string',
                },
              },
              required: ['action'],
            },
          },
        },
      ],
      }),
    ).rejects.toThrow('must expose top-level parameters with type="object"');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when tool parameter schemas use unsupported top-level union keywords', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model' });

    await expect(
      client.chat({
      messages: [{ role: 'user', content: 'run tool' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'discord_server',
            parameters: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    action: { type: 'string' },
                  },
                  required: ['action'],
                },
              ],
            },
          },
        },
      ],
      }),
    ).rejects.toThrow('must expose top-level parameters with type="object"');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails fast (no retry) on 400 model validation errors', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 3 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'Model validation failed.',
      json: async () => ({}),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    });

    await expect(client.chat({ messages: [] })).rejects.toThrow('AI provider model error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry after an abort error', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 3 });
    const abortError = new DOMException('The operation was aborted.', 'AbortError');

    fetchMock.mockRejectedValueOnce(abortError);

    await expect(
      client.chat({
        messages: [{ role: 'user', content: 'test' }],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/aborted/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns structured tool calls instead of serializing them into text envelopes', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Need a quick lookup first.',
              tool_calls: [
                {
                  id: 'call-1',
                  function: {
                    name: 'google_search',
                    arguments: '{"query":"latest discord components v2"}',
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => 'ok',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'test' }],
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

    expect(result.text).toBe('');
    expect(result.reasoningText).toBe('Need a quick lookup first.');
    expect(result.toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'google_search',
        args: { query: 'latest discord components v2' },
      },
    ]);
  });

  it('preserves assistant tool-call transcript messages in provider payloads', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'done' } }] }),
      text: async () => 'done',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [
        { role: 'user', content: 'Look it up' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'google_search',
              args: { query: 'discord components v2' },
            },
          ],
        },
      ],
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

    const body = parseRequestBody(fetchMock, 0);
    expect(body.messages[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'google_search',
            arguments: '{"query":"discord components v2"}',
          },
        },
      ],
    });
  });

  it('preserves tool result messages in provider payloads instead of rewriting them as user text', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'done' } }] }),
      text: async () => 'done',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [
        { role: 'user', content: 'Look it up' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'google_search',
              args: { query: 'discord components v2' },
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'call-1',
          content: '{"results":[{"title":"Docs"}]}',
        },
      ],
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

    const body = parseRequestBody(fetchMock, 0);
    expect(body.messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1',
      content: '{"results":[{"title":"Docs"}]}',
    });
  });

  it('fails when the provider returns malformed tool-call argument JSON', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Need a tool.',
              tool_calls: [
                {
                  id: 'call-1',
                  function: {
                    name: 'google_search',
                    arguments: '{"query":',
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => 'ok',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await expect(
      client.chat({
        messages: [{ role: 'user', content: 'test' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'google_search',
              parameters: { type: 'object', properties: {}, required: [] },
            },
          },
        ],
      }),
    ).rejects.toThrow('malformed JSON arguments');
  });
});

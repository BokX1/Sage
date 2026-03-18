import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiProviderClient } from '../../../../src/platform/llm/ai-provider-client';
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
    AiProviderClient.resetProviderToolControlsSupportCacheForTests();
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
    expect(userMessages).toHaveLength(2);
    expect(Array.isArray(userMessages[0]?.content)).toBe(true);
    const parts = userMessages[0]?.content as Array<Record<string, unknown>>;
    expect(parts).toEqual(
      expect.arrayContaining([
        { type: 'text', text: 'First turn' },
        { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
      ]),
    );
    expect(userMessages[1]?.content).toBe('Second turn');
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

  it('fails when tools use unsupported top-level union schemas', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model' });

    await expect(
      client.chat({
        messages: [{ role: 'user', content: 'run tool' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'discord_server_list_channels',
              parameters: {
                oneOf: [
                  {
                    type: 'object',
                    properties: {
                      limit: { type: 'integer', minimum: 1 },
                    },
                  },
                  {
                    type: 'object',
                    properties: {
                      channelId: { type: 'string' },
                    },
                  },
                ],
              },
            },
          },
        ],
      }),
    ).rejects.toThrow('unsupported top-level schema keyword "oneOf"');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails fast (no retry) on 400 model validation errors', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 3 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () =>
        JSON.stringify({
          error: {
            code: 'validation_error',
            type: 'validation_error',
            message: 'Model validation failed.',
          },
        }),
      json: async () => ({
        error: {
          code: 'validation_error',
          type: 'validation_error',
          message: 'Model validation failed.',
        },
      }),
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

  it('sends allowed_tools and parallel_tool_calls when the caller narrows the active subset explicitly', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'done' } }] }),
      text: async () => 'done',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [{ role: 'user', content: 'Search it' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'google_search',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'web_read',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
      allowedTools: [{ type: 'function', function: { name: 'google_search' } }],
      parallelToolCalls: false,
    });

    const body = parseRequestBody(fetchMock, 0) as RequestBody & {
      parallel_tool_calls?: boolean;
      tool_choice?: Record<string, unknown>;
    };
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.tool_choice).toMatchObject({
      type: 'allowed_tools',
      mode: 'auto',
      tools: [{ type: 'function', function: { name: 'google_search' } }],
    });
  });

  it('retries without provider tool controls when the provider returns a structured unsupported-parameter error', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: {
            code: 'unknown_parameter',
            type: 'invalid_request_error',
            param: 'tool_choice',
            message: 'tool_choice is not supported by this endpoint.',
          },
        }),
        text: async () =>
          JSON.stringify({
            error: {
              code: 'unknown_parameter',
              type: 'invalid_request_error',
              param: 'tool_choice',
              message: 'tool_choice is not supported by this endpoint.',
            },
          }),
      } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: 'done' } }] }),
        text: async () => 'done',
      } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await client.chat({
      messages: [{ role: 'user', content: 'Search it' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'google_search',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
      allowedTools: [{ type: 'function', function: { name: 'google_search' } }],
      parallelToolCalls: false,
      toolChoice: 'auto',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = parseRequestBody(fetchMock, 1) as RequestBody & {
      parallel_tool_calls?: boolean;
      tool_choice?: unknown;
    };
    expect(retryBody.parallel_tool_calls).toBeUndefined();
    expect(retryBody.tool_choice).toBe('auto');
  });

  it('does not retry without provider tool controls when the provider only returns an unstructured 400 message', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({}),
      text: async () => 'unknown field: allowed_tools',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await expect(
      client.chat({
        messages: [{ role: 'user', content: 'Search it' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'google_search',
              parameters: { type: 'object', properties: {}, required: [] },
            },
          },
        ],
        allowedTools: [{ type: 'function', function: { name: 'google_search' } }],
        parallelToolCalls: false,
        toolChoice: 'auto',
      }),
    ).rejects.toThrow('AI provider bad request');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies generic structured invalid_request_error responses as AI_PROVIDER_BAD_REQUEST', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        error: {
          code: 'unknown_parameter',
          type: 'invalid_request_error',
          param: 'response_format',
          message: 'response_format is not supported by this endpoint.',
        },
      }),
      text: async () =>
        JSON.stringify({
          error: {
            code: 'unknown_parameter',
            type: 'invalid_request_error',
            param: 'response_format',
            message: 'response_format is not supported by this endpoint.',
          },
        }),
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await expect(client.chat({ messages: [] })).rejects.toMatchObject({
      code: 'AI_PROVIDER_BAD_REQUEST',
      message: expect.stringContaining('AI provider bad request'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches unsupported provider tool controls so later requests skip the failed first attempt', async () => {
    const firstClient = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });
    const secondClient = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: {
            code: 'unsupported_parameter',
            type: 'invalid_request_error',
            param: 'parallel_tool_calls',
            message: 'parallel_tool_calls is not supported by this endpoint.',
          },
        }),
        text: async () =>
          JSON.stringify({
            error: {
              code: 'unsupported_parameter',
              type: 'invalid_request_error',
              param: 'parallel_tool_calls',
              message: 'parallel_tool_calls is not supported by this endpoint.',
            },
          }),
      } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: 'done' } }] }),
        text: async () => 'done',
      } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: 'done again' } }] }),
        text: async () => 'done again',
      } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await firstClient.chat({
      messages: [{ role: 'user', content: 'Search it' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'google_search',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
      allowedTools: [{ type: 'function', function: { name: 'google_search' } }],
      parallelToolCalls: false,
      toolChoice: 'auto',
    });

    await secondClient.chat({
      messages: [{ role: 'user', content: 'Search it again' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'google_search',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
      allowedTools: [{ type: 'function', function: { name: 'google_search' } }],
      parallelToolCalls: false,
      toolChoice: 'auto',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const cachedBody = parseRequestBody(fetchMock, 2) as RequestBody & {
      parallel_tool_calls?: boolean;
      tool_choice?: unknown;
    };
    expect(cachedBody.parallel_tool_calls).toBeUndefined();
    expect(cachedBody.tool_choice).toBe('auto');
  });

  it('classifies structured 404 model errors as AI_PROVIDER_MODEL', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 0 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({
        error: {
          code: 'model_not_found',
          type: 'invalid_model',
          message: 'Model not found.',
        },
      }),
      text: async () =>
        JSON.stringify({
          error: {
            code: 'model_not_found',
            type: 'invalid_model',
            message: 'Model not found.',
          },
        }),
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await expect(client.chat({ messages: [] })).rejects.toThrow('AI provider model error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies unstructured 404 responses as AI_PROVIDER_ENDPOINT instead of AI_PROVIDER_MODEL', async () => {
    const client = new AiProviderClient({ baseUrl: 'https://api.test/v1', model: 'test-chat-model', maxRetries: 3 });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
      text: async () => 'route not found',
    } satisfies { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> });

    await expect(client.chat({ messages: [] })).rejects.toMatchObject({
      code: 'AI_PROVIDER_ENDPOINT',
      message: expect.stringContaining('AI provider endpoint error'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

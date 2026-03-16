import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  probeAiProviderPing,
  probeAiProviderToolCalling,
} from '@/platform/llm/ai-provider-probe';

describe('ai-provider probe helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a successful basic ping', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'OK' } }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await probeAiProviderPing({
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('succeeded');
  });

  it('reports successful Chat Completions tool-calling support', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'call-1',
                      function: {
                        name: 'sage_probe_echo',
                        arguments: '{"value":"tool_call_roundtrip_ok"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Tool roundtrip complete.' } }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const result = await probeAiProviderToolCalling({
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails the tool-calling probe when the provider rejects tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('tools are unsupported', {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await probeAiProviderToolCalling({
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('failed (400)');
    expect(result.details?.[0]).toContain('unsupported');
  });

  it('fails the tool-calling probe when the provider returns malformed tool-call arguments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'call-1',
                    function: {
                      name: 'sage_probe_echo',
                      arguments: '{"value":',
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await probeAiProviderToolCalling({
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('malformed tool-call arguments');
  });
});

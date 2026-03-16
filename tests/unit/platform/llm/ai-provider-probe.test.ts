import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  probeAiProviderPing,
  probeAiProviderStrictStructuredOutputs,
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

  it('reports successful strict structured-output support', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"verdict":"strict_json_schema_ok"}' } }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await probeAiProviderStrictStructuredOutputs({
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('succeeded');
  });

  it('fails the strict probe when the provider rejects json_schema mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('response_format json_schema is unsupported', {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await probeAiProviderStrictStructuredOutputs({
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('failed (400)');
    expect(result.details?.[0]).toContain('unsupported');
  });
});


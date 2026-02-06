import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PollinationsClient } from '../../../src/core/llm/pollinations-client';

// Mock fetch globally
global.fetch = vi.fn();

describe('PollinationsClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should reject non-HTTPS base URLs', () => {
    expect(() => new PollinationsClient({ baseUrl: 'http://api.test/v1' })).toThrow(
      'LLM base URL must use HTTPS.',
    );
  });

  it('should normalize baseUrl correctly (removing suffixes)', async () => {
    const client1 = new PollinationsClient({ baseUrl: 'https://api.test/v1/chat/completions' });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    await client1.chat({ messages: [] });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/v1/chat/completions',
      expect.anything(),
    );
  });

  it('should normalize baseUrl correctly (removing trailing slash)', async () => {
    const client2 = new PollinationsClient({ baseUrl: 'https://api.test/v1/' });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    await client2.chat({ messages: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/v1/chat/completions',
      expect.anything(),
    );
  });

  it('should retry without response_format on 400 response_format error', async () => {
    const client = new PollinationsClient({ maxRetries: 1 });

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Error: response_format is not supported by this model',
        json: async () => ({}),
      })
      // Second call succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"json": true}' } }] }),
      });

    await client.chat({ messages: [], responseFormat: 'json_object' });

    expect(global.fetch).toHaveBeenCalledTimes(2);

    const call1 = (global.fetch as any).mock.calls[0];
    const body1 = JSON.parse(call1[1].body);
    expect(body1).toHaveProperty('response_format');

    const call2 = (global.fetch as any).mock.calls[1];
    const body2 = JSON.parse(call2[1].body);
    expect(body2).not.toHaveProperty('response_format');

    const systemMsg = body2.messages.find((m: any) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('IMPORTANT: You must output strictly valid JSON only');
  });

  it('should NOT retry if error is unrelated to json mode', async () => {
    const client = new PollinationsClient({ maxRetries: 0 }); // No normal retries

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500, // unrelated
      text: async () => 'Internal Server Error',
    });

    await expect(client.chat({ messages: [], responseFormat: 'json_object' })).rejects.toThrow(
      'Pollinations API error: 500',
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should fail fast (no retry) on 400 Model Validation error', async () => {
    const client = new PollinationsClient({ maxRetries: 3 });

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Model validation failed. Expected one of: openai, ...',
    });

    await expect(client.chat({ messages: [] })).rejects.toThrow('Pollinations Model Error');

    // Should catch quickly, definitely not after 3 retries
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should preemptively disable response_format and inject prompts when tools + json_object are requested', async () => {
    const client = new PollinationsClient();

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    });

    await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      responseFormat: 'json_object',
      tools: [{ type: 'function', function: { name: 'google_search' } }] as any,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);

    // 1. response_format should be gone
    expect(body).not.toHaveProperty('response_format');

    // 2. tools should still be there
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe('google_search');

    // 3. system prompt should have injected instructions
    const systemMsg = body.messages.find((m: any) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('IMPORTANT: You must output strictly valid JSON only');
    expect(systemMsg.content).toContain('You have access to google_search tool');
  });
});

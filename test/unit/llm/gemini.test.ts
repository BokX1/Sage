import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiClient } from '../../../src/core/llm/providers/gemini';

// Mock fetch global
global.fetch = vi.fn();

describe('GeminiClient', () => {
  let client: GeminiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GeminiClient({ apiKey: 'test-key', model: 'gemini-test' });
  });

  it('should map chat request to Gemini API format', async () => {
    // Mock successful response
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'Gemini Reply' }],
            },
          },
        ],
        usageMetadata: {
          totalTokenCount: 10,
        },
      }),
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.5,
    });

    expect(response.content).toBe('Gemini Reply');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
      ),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"role":"user"'),
      }),
    );
  });

  it('should map system prompt to systemInstruction', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }),
    });

    await client.chat({
      messages: [
        { role: 'system', content: 'Be nice' },
        { role: 'user', content: 'Hi' },
      ],
    });

    const call = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.systemInstruction).toBeDefined();
    expect(body.systemInstruction.parts[0].text).toBe('Be nice');
  });

  it('should include google_search tool when requested', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }),
    });

    await client.chat({
      messages: [{ role: 'user', content: 'Search this' }],
      tools: [{ googleSearch: {} }], // Simulating internal call
    });

    const call = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.tools).toBeDefined();
    expect(body.tools[0].googleSearch).toBeDefined();
  });
});

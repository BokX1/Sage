import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { callWithSchema } from '../../../../src/platform/llm/schema-call';
import { LLMClient } from '../../../../src/platform/llm/llm-types';

describe('callWithSchema', () => {
  it('should build a sanitized JSON schema prompt without $schema metadata', async () => {
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({ summary: 'ok' }),
    });

    const client: LLMClient = {
      chat,
    };

    const result = await callWithSchema(
      client,
      z.object({
        summary: z.string(),
      }),
      [{ role: 'user', content: 'Summarize this' }],
    );

    expect(result).toEqual({ summary: 'ok' });
    expect(chat).toHaveBeenCalledTimes(1);

    const request = chat.mock.calls[0][0];
    expect(request.responseFormat).toBe('json_object');
    expect(request.messages[0].role).toBe('system');
    const systemPrompt = request.messages[0].content as string;
    expect(systemPrompt).toContain('"type": "object"');
    expect(systemPrompt).toContain('"summary"');
    expect(systemPrompt).not.toContain('"$schema"');
  });

  it('retries with the schema-bearing system prompt after an initial failure', async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new Error('invalid json'))
      .mockResolvedValueOnce({
        text: JSON.stringify({ summary: 'repaired' }),
      });

    const client: LLMClient = {
      chat,
    };

    const result = await callWithSchema(
      client,
      z.object({
        summary: z.string(),
      }),
      [{ role: 'user', content: 'Summarize this' }],
      'Use concise wording.',
    );

    expect(result).toEqual({ summary: 'repaired' });
    expect(chat).toHaveBeenCalledTimes(2);

    const repairRequest = chat.mock.calls[1][0];
    expect(repairRequest.messages[0].role).toBe('system');
    expect(repairRequest.messages[0].content).toContain('Use concise wording.');
    expect(repairRequest.messages[0].content).toContain('"type": "object"');
  });
});

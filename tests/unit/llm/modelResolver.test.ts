import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveModelForRequest } from '../../../src/core/llm/modelResolver';

vi.mock('../../../src/core/llm/modelCatalog', () => ({
  getDefaultModelId: () => 'gemini',
}));

describe('resolveModelForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the default model for text requests', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(model).toBe('gemini');
  });

  it('returns the default model for vision requests', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }],
        },
      ],
    });

    expect(model).toBe('gemini');
  });
});

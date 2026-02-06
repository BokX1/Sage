import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveModelForRequest } from '../../../src/core/llm/model-resolver';

vi.mock('../../../src/core/llm/model-catalog', () => ({
  getDefaultModelId: () => 'kimi',
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

    expect(model).toBe('kimi');
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

    expect(model).toBe('kimi');
  });
});

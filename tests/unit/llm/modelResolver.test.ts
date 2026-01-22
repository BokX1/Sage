import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveModelForRequest } from '../../../src/core/llm/modelResolver';

const getGuildModel = vi.fn();

vi.mock('../../../src/core/settings/guildModelSettings', () => ({
  getGuildModel: (...args: unknown[]) => getGuildModel(...args),
}));

vi.mock('../../../src/core/llm/modelCatalog', () => ({
  getDefaultModelId: () => 'gemini',
  loadModelCatalog: async () => ({
    gemini: { id: 'gemini', caps: { vision: true } },
    'text-only': { id: 'text-only', caps: { vision: false }, inputModalities: ['text'] },
  }),
  modelSupports: (info: { caps?: { vision?: boolean }; inputModalities?: string[] }, required: { vision?: boolean }) => {
    if (required.vision) {
      return info.caps?.vision === true || info.inputModalities?.includes('image');
    }
    return true;
  },
}));

describe('resolveModelForRequest', () => {
  beforeEach(() => {
    getGuildModel.mockReset();
  });

  it('returns default when no guild preference is set', async () => {
    getGuildModel.mockResolvedValue(null);

    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(model).toBe('gemini');
  });

  it('returns default when preferred model is unknown', async () => {
    getGuildModel.mockResolvedValue('unknown-model');

    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(model).toBe('gemini');
  });

  it('uses preferred model for text-only requests', async () => {
    getGuildModel.mockResolvedValue('text-only');

    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(model).toBe('text-only');
  });

  it('falls back to default when vision is required', async () => {
    getGuildModel.mockResolvedValue('text-only');

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

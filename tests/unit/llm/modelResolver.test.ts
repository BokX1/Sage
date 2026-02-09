import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveModelForRequest,
  resolveModelForRequestDetailed,
} from '../../../src/core/llm/model-resolver';
import { recordModelOutcome, resetModelHealth } from '../../../src/core/llm/model-health';

const mockFindModelInCatalog = vi.hoisted(() => vi.fn());
const mockModelSupports = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/llm/model-catalog', () => ({
  getDefaultModelId: () => 'openai-fast',
  findModelInCatalog: mockFindModelInCatalog,
  modelSupports: mockModelSupports,
}));

describe('resolveModelForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModelHealth();
    mockFindModelInCatalog.mockImplementation(async (modelId: string) => ({
      model: {
        id: modelId,
        caps: {},
        inputModalities: ['text', 'image', 'audio'],
        outputModalities: ['text', 'audio'],
      },
      catalog: {},
      refreshed: false,
    }));
    mockModelSupports.mockReturnValue(true);
  });

  it('returns the default model for text requests', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(model).toBe('openai-large');
  });

  it('returns kimi for coding route', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'write code' }],
      route: 'coding',
    });

    expect(model).toBe('kimi');
  });

  it('returns gemini-search for search route', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'what happened today in AI news?' }],
      route: 'search',
    });

    expect(model).toBe('gemini-search');
  });

  it('prefers openai-audio when audio I/O is requested', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'read this out loud' }],
      route: 'chat',
      featureFlags: {
        audioOut: true,
      },
    });

    expect(model).toBe('openai-audio');
  });
  it('falls back when the first candidate does not satisfy requirements', async () => {
    mockModelSupports.mockImplementation((model: { id: string }) => model.id !== 'openai-large');

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

  it('applies an allowlist when provided', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'write code' }],
      route: 'coding',
      allowedModels: ['deepseek'],
    });

    expect(model).toBe('deepseek');
  });

  it('prefers healthier candidates when capability is equivalent', async () => {
    recordModelOutcome({ model: 'openai-large', success: false });
    recordModelOutcome({ model: 'claude-fast', success: true, latencyMs: 2000 });

    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
      route: 'chat',
    });

    expect(model).toBe('claude-fast');
  });

  it('returns detailed fallback reasons for candidate selection', async () => {
    mockModelSupports.mockImplementation((model: { id: string }) => model.id !== 'openai-large');

    const details = await resolveModelForRequestDetailed({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
      route: 'chat',
    });

    expect(details.model).toBe('kimi');
    expect(details.decisions.some((d) => d.model === 'openai-large' && d.reason === 'capability_mismatch')).toBe(
      true,
    );
    expect(details.decisions.some((d) => d.model === 'kimi' && d.reason === 'selected')).toBe(true);
  });
});

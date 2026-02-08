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

    expect(model).toBe('openai-fast');
  });

  it('returns qwen-coder for coding route', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'write code' }],
      route: 'coding',
    });

    expect(model).toBe('qwen-coder');
  });

  it('returns perplexity-fast for search route', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'what happened today in AI news?' }],
      route: 'search',
    });

    expect(model).toBe('perplexity-fast');
  });

  it('prefers openai-audio when audio I/O is requested', async () => {
    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'read this out loud' }],
      route: 'qa',
      featureFlags: {
        audioOut: true,
      },
    });

    expect(model).toBe('openai-audio');
  });

  it('falls back when the first candidate does not satisfy requirements', async () => {
    mockModelSupports.mockImplementation((model: { id: string }) => model.id !== 'openai-fast');

    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }],
        },
      ],
    });

    expect(model).toBe('gemini-fast');
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
    recordModelOutcome({ model: 'openai-fast', success: false });
    recordModelOutcome({ model: 'gemini-fast', success: true, latencyMs: 2000 });

    const model = await resolveModelForRequest({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
      route: 'qa',
    });

    expect(model).toBe('gemini-fast');
  });

  it('returns detailed fallback reasons for candidate selection', async () => {
    mockModelSupports.mockImplementation((model: { id: string }) => model.id !== 'openai-fast');

    const details = await resolveModelForRequestDetailed({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
      route: 'qa',
    });

    expect(details.model).toBe('gemini-fast');
    expect(details.decisions.some((d) => d.model === 'openai-fast' && d.reason === 'capability_mismatch')).toBe(true);
    expect(details.decisions.some((d) => d.model === 'gemini-fast' && d.reason === 'selected')).toBe(true);
  });
});

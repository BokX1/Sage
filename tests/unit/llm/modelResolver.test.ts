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

  it('keeps search route candidates search-native when reasoning is requested', async () => {
    const details = await resolveModelForRequestDetailed({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'latest ai release notes' }],
      route: 'search',
      featureFlags: {
        search: true,
        reasoning: true,
      },
    });

    expect(details.candidates).not.toContain('deepseek');
    expect(details.candidates[0]).toBe('gemini-search');
  });

  it('adds nomnom for search route when link scraping is requested', async () => {
    const details = await resolveModelForRequestDetailed({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'summarize https://example.com/release-notes' }],
      route: 'search',
      featureFlags: {
        search: true,
        linkScrape: true,
      },
    });

    expect(details.candidates[0]).toBe('nomnom');
    expect(details.candidates).toContain('gemini-search');
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

  it('falls back to route-default search model when no candidates satisfy capabilities', async () => {
    mockModelSupports.mockReturnValue(false);
    recordModelOutcome({ model: 'perplexity-fast', success: true });
    recordModelOutcome({ model: 'perplexity-fast', success: true });

    const details = await resolveModelForRequestDetailed({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'latest ai updates' }],
      route: 'search',
      featureFlags: {
        search: true,
        reasoning: true,
      },
    });

    expect(details.model).toBe('gemini-search');
    const lastDecision = details.decisions[details.decisions.length - 1];
    expect(lastDecision.model).toBe('gemini-search');
    expect(lastDecision.reason).toBe('fallback_first_candidate');
  });

  it('falls back to route-default chat model even when deepseek has higher health', async () => {
    mockModelSupports.mockReturnValue(false);
    recordModelOutcome({ model: 'deepseek', success: true });
    recordModelOutcome({ model: 'deepseek', success: true, latencyMs: 1000 });

    const details = await resolveModelForRequestDetailed({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'summarize this clearly' }],
      route: 'chat',
      featureFlags: {
        reasoning: true,
      },
    });

    expect(details.candidates[0]).toBe('deepseek');
    expect(details.model).toBe('openai-large');
    const lastDecision = details.decisions[details.decisions.length - 1];
    expect(lastDecision.model).toBe('openai-large');
    expect(lastDecision.reason).toBe('fallback_first_candidate');
  });

  it('rejects unknown catalog candidates in strict capability mode', async () => {
    mockFindModelInCatalog.mockImplementation(async (modelId: string) => {
      if (modelId === 'deepseek') {
        return {
          model: null,
          catalog: {},
          refreshed: true,
        };
      }
      return {
        model: {
          id: modelId,
          caps: {},
          inputModalities: ['text', 'image', 'audio'],
          outputModalities: ['text', 'audio'],
        },
        catalog: {},
        refreshed: false,
      };
    });
    mockModelSupports.mockReturnValue(true);

    const details = await resolveModelForRequestDetailed({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'reason carefully' }],
      route: 'chat',
      featureFlags: {
        reasoning: true,
      },
    });

    expect(details.model).toBe('openai-large');
    const deepseekDecision = details.decisions.find((d) => d.model === 'deepseek');
    expect(deepseekDecision?.reason).toBe('capability_mismatch');
    expect(deepseekDecision?.accepted).toBe(false);
  });

  it('keeps unknown-model acceptance in non-strict mode for alias compatibility', async () => {
    mockFindModelInCatalog.mockImplementation(async (modelId: string) => {
      if (modelId === 'openai-large') {
        return {
          model: null,
          catalog: {},
          refreshed: false,
        };
      }
      return {
        model: {
          id: modelId,
          caps: {},
          inputModalities: ['text', 'image', 'audio'],
          outputModalities: ['text', 'audio'],
        },
        catalog: {},
        refreshed: false,
      };
    });
    mockModelSupports.mockReturnValue(true);

    const details = await resolveModelForRequestDetailed({
      guildId: 'guild-1',
      messages: [{ role: 'user', content: 'hello' }],
      route: 'chat',
    });

    expect(details.model).toBe('openai-large');
    const decision = details.decisions[0];
    expect(decision.model).toBe('openai-large');
    expect(decision.reason).toBe('catalog_miss_accept_unknown');
    expect(decision.accepted).toBe(true);
  });
});

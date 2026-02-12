import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunWebSearch,
  mockScrapeWebPage,
  mockLookupGitHubRepo,
  mockLookupGitHubFile,
  mockLookupNpmPackage,
  mockLookupWikipedia,
  mockSearchStackOverflow,
  mockListLocalOllamaModels,
  mockRunLocalLlmInfer,
  mockLookupChannelFileCache,
} = vi.hoisted(() => ({
  mockRunWebSearch: vi.fn(),
  mockScrapeWebPage: vi.fn(),
  mockLookupGitHubRepo: vi.fn(),
  mockLookupGitHubFile: vi.fn(),
  mockLookupNpmPackage: vi.fn(),
  mockLookupWikipedia: vi.fn(),
  mockSearchStackOverflow: vi.fn(),
  mockListLocalOllamaModels: vi.fn(),
  mockRunLocalLlmInfer: vi.fn(),
  mockLookupChannelFileCache: vi.fn(),
}));

vi.mock('../../../src/core/agentRuntime/toolIntegrations', () => ({
  runWebSearch: mockRunWebSearch,
  scrapeWebPage: mockScrapeWebPage,
  sanitizePublicUrl: (url: string) => url,
  lookupGitHubRepo: mockLookupGitHubRepo,
  lookupGitHubFile: mockLookupGitHubFile,
  lookupNpmPackage: mockLookupNpmPackage,
  lookupWikipedia: mockLookupWikipedia,
  searchStackOverflow: mockSearchStackOverflow,
  listLocalOllamaModels: mockListLocalOllamaModels,
  runLocalLlmInfer: mockRunLocalLlmInfer,
  lookupChannelFileCache: mockLookupChannelFileCache,
}));

import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../src/core/agentRuntime/defaultTools';

describe('default tools complex-search execution profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunWebSearch.mockResolvedValue({ provider: 'searxng', results: [] });
    mockScrapeWebPage.mockResolvedValue({ provider: 'crawl4ai', content: 'ok' });
    mockLookupGitHubRepo.mockResolvedValue({});
    mockLookupGitHubFile.mockResolvedValue({});
    mockLookupNpmPackage.mockResolvedValue({});
    mockLookupWikipedia.mockResolvedValue({});
    mockSearchStackOverflow.mockResolvedValue({});
    mockListLocalOllamaModels.mockResolvedValue({});
    mockRunLocalLlmInfer.mockResolvedValue({});
    mockLookupChannelFileCache.mockResolvedValue({});
  });

  it('forces non-LLM web_search providers for search complex mode', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'web_search',
        args: { query: 'latest sdk release notes' },
      },
      {
        traceId: 'trace-1',
        userId: 'user-1',
        channelId: 'channel-1',
        routeKind: 'search',
        searchMode: 'complex',
      },
    );

    expect(result.success).toBe(true);
    expect(mockRunWebSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'latest sdk release notes',
        depth: 'deep',
        allowLlmFallback: false,
        providerOrder: ['searxng', 'tavily', 'exa'],
      }),
    );
  });

  it('forces local-first web_scrape providers for search complex mode', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'web_scrape',
        args: { url: 'https://example.com/docs' },
      },
      {
        traceId: 'trace-2',
        userId: 'user-1',
        channelId: 'channel-1',
        routeKind: 'search',
        searchMode: 'complex',
      },
    );

    expect(result.success).toBe(true);
    expect(mockScrapeWebPage).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/docs',
        providerOrder: ['crawl4ai', 'jina', 'raw_fetch', 'firecrawl'],
      }),
    );
  });
});

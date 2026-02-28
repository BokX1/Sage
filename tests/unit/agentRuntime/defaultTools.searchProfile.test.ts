import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunWebSearch,
  mockScrapeWebPage,
  mockLookupGitHubRepo,
  mockLookupGitHubCodeSearch,
  mockLookupGitHubFile,
  mockLookupNpmPackage,
  mockLookupWikipedia,
  mockSearchStackOverflow,
  mockListLocalOllamaModels,
  mockRunLocalLlmInfer,
  mockLookupChannelFileCache,
  mockLookupUserMemory,
  mockLookupChannelMemory,
  mockLookupSocialGraph,
  mockLookupVoiceAnalytics,
  mockSearchChannelArchives,
  mockSearchAttachmentChunksInChannel,
  mockSearchAttachmentChunksInGuild,
  mockLookupServerFileCache,
  mockGenerateImage,
} = vi.hoisted(() => ({
  mockRunWebSearch: vi.fn(),
  mockScrapeWebPage: vi.fn(),
  mockLookupGitHubRepo: vi.fn(),
  mockLookupGitHubCodeSearch: vi.fn(),
  mockLookupGitHubFile: vi.fn(),
  mockLookupNpmPackage: vi.fn(),
  mockLookupWikipedia: vi.fn(),
  mockSearchStackOverflow: vi.fn(),
  mockListLocalOllamaModels: vi.fn(),
  mockRunLocalLlmInfer: vi.fn(),
  mockLookupChannelFileCache: vi.fn(),
  mockLookupUserMemory: vi.fn(),
  mockLookupChannelMemory: vi.fn(),
  mockLookupSocialGraph: vi.fn(),
  mockLookupVoiceAnalytics: vi.fn(),
  mockSearchChannelArchives: vi.fn(),
  mockSearchAttachmentChunksInChannel: vi.fn(),
  mockSearchAttachmentChunksInGuild: vi.fn(),
  mockLookupServerFileCache: vi.fn(),
  mockGenerateImage: vi.fn(),
}));

vi.mock('../../../src/core/agentRuntime/toolIntegrations', () => ({
  runWebSearch: mockRunWebSearch,
  scrapeWebPage: mockScrapeWebPage,
  sanitizePublicUrl: (url: string) => url,
  lookupGitHubRepo: mockLookupGitHubRepo,
  lookupGitHubCodeSearch: mockLookupGitHubCodeSearch,
  lookupGitHubFile: mockLookupGitHubFile,
  lookupNpmPackage: mockLookupNpmPackage,
  lookupWikipedia: mockLookupWikipedia,
  searchStackOverflow: mockSearchStackOverflow,
  listLocalOllamaModels: mockListLocalOllamaModels,
  runLocalLlmInfer: mockRunLocalLlmInfer,
  lookupChannelFileCache: mockLookupChannelFileCache,
  lookupUserMemory: mockLookupUserMemory,
  lookupChannelMemory: mockLookupChannelMemory,
  lookupSocialGraph: mockLookupSocialGraph,
  lookupVoiceAnalytics: mockLookupVoiceAnalytics,
  searchChannelArchives: mockSearchChannelArchives,
  searchAttachmentChunksInChannel: mockSearchAttachmentChunksInChannel,
  searchAttachmentChunksInGuild: mockSearchAttachmentChunksInGuild,
  lookupServerFileCache: mockLookupServerFileCache,
  generateImage: mockGenerateImage,
}));

import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../src/core/agentRuntime/defaultTools';

describe('default tools search-high execution profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunWebSearch.mockResolvedValue({ provider: 'searxng', results: [] });
    mockScrapeWebPage.mockResolvedValue({ provider: 'crawl4ai', content: 'ok' });
    mockLookupGitHubRepo.mockResolvedValue({});
    mockLookupGitHubCodeSearch.mockResolvedValue({});
    mockLookupGitHubFile.mockResolvedValue({});
    mockLookupNpmPackage.mockResolvedValue({});
    mockLookupWikipedia.mockResolvedValue({});
    mockSearchStackOverflow.mockResolvedValue({});
    mockListLocalOllamaModels.mockResolvedValue({});
    mockRunLocalLlmInfer.mockResolvedValue({});
    mockLookupChannelFileCache.mockResolvedValue({});
    mockLookupUserMemory.mockResolvedValue({});
    mockLookupChannelMemory.mockResolvedValue({});
    mockLookupSocialGraph.mockResolvedValue({});
    mockLookupVoiceAnalytics.mockResolvedValue({});
    mockSearchChannelArchives.mockResolvedValue({});
    mockSearchAttachmentChunksInChannel.mockResolvedValue({});
    mockSearchAttachmentChunksInGuild.mockResolvedValue({});
    mockLookupServerFileCache.mockResolvedValue({});
    mockGenerateImage.mockResolvedValue({});
  });

  it('forces non-LLM web_search providers for search-high profile', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'web_search',
        args: { think: 'Searching new SDK docs', query: 'latest sdk release notes' },
      },
      {
        traceId: 'trace-1',
        userId: 'user-1',
        channelId: 'channel-1',
        routeKind: 'search',
        toolExecutionProfile: 'search_high',
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

  it('forces local-first web_get_page_text providers for search-high profile', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'web_get_page_text',
        args: { think: 'Scraping docs page', url: 'https://example.com/docs' },
      },
      {
        traceId: 'trace-2',
        userId: 'user-1',
        channelId: 'channel-1',
        routeKind: 'search',
        toolExecutionProfile: 'search_high',
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

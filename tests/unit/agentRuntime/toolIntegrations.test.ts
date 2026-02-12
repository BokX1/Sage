import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/config';
const { mockFindIngestedAttachmentsForLookup } = vi.hoisted(() => ({
  mockFindIngestedAttachmentsForLookup: vi.fn(),
}));
vi.mock('../../../src/core/attachments/ingestedAttachmentRepo', () => ({
  findIngestedAttachmentsForLookup: mockFindIngestedAttachmentsForLookup,
}));
import {
  __resetLocalProviderCooldownForTests,
  listLocalOllamaModels,
  lookupChannelFileCache,
  lookupGitHubFile,
  lookupNpmPackage,
  runWebSearch,
  sanitizePublicUrl,
  sanitizeUrl,
  scrapeWebPage,
} from '../../../src/core/agentRuntime/toolIntegrations';

global.fetch = vi.fn();

describe('toolIntegrations', () => {
  const originalSearchOrder = config.TOOL_WEB_SEARCH_PROVIDER_ORDER;
  const originalSearxngBase = config.SEARXNG_BASE_URL;
  const originalScrapeOrder = config.TOOL_WEB_SCRAPE_PROVIDER_ORDER;
  const originalCrawl4aiBase = config.CRAWL4AI_BASE_URL;
  const originalOllamaBase = config.OLLAMA_BASE_URL;

  beforeEach(() => {
    vi.resetAllMocks();
    __resetLocalProviderCooldownForTests();
    mockFindIngestedAttachmentsForLookup.mockReset();
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = originalSearchOrder;
    config.SEARXNG_BASE_URL = originalSearxngBase;
    config.TOOL_WEB_SCRAPE_PROVIDER_ORDER = originalScrapeOrder;
    config.CRAWL4AI_BASE_URL = originalCrawl4aiBase;
    config.OLLAMA_BASE_URL = originalOllamaBase;
  });

  it('sanitizes URLs and strips fragments', () => {
    expect(sanitizeUrl('https://example.com/docs#section')).toBe('https://example.com/docs');
    expect(sanitizeUrl('ftp://example.com/resource')).toBeNull();
    expect(sanitizeUrl('not-a-url')).toBeNull();
  });

  it('rejects private URLs for public-web tools', () => {
    expect(sanitizePublicUrl('http://localhost:3000/admin')).toBeNull();
    expect(sanitizePublicUrl('http://127.0.0.1:8080')).toBeNull();
    expect(sanitizePublicUrl('https://example.com/docs#section')).toBe('https://example.com/docs');
  });

  it('looks up npm package metadata for latest version', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          'dist-tags': { latest: '1.2.3' },
          versions: {
            '1.2.3': {
              description: 'pkg',
              license: 'MIT',
              dependencies: { a: '^1.0.0', b: '^2.0.0' },
              repository: { url: 'https://github.com/acme/pkg' },
            },
          },
          maintainers: [{ name: 'alice' }],
          time: { '1.2.3': '2026-01-01T00:00:00.000Z' },
        }),
    });

    const result = await lookupNpmPackage({ packageName: 'acme-pkg' });

    expect(result.version).toBe('1.2.3');
    expect(result.latestVersion).toBe('1.2.3');
    expect(result.dependencyCount).toBe(2);
    expect(result.repositoryUrl).toBe('https://github.com/acme/pkg');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('scrapes content via Jina fallback when Firecrawl/Crawl4AI are unavailable', async () => {
    config.TOOL_WEB_SCRAPE_PROVIDER_ORDER = 'jina';
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'Example page content',
    });

    const result = await scrapeWebPage({
      url: 'https://example.com',
      maxChars: 1_000,
    });

    expect(result.provider).toBe('jina');
    expect(result.url).toBe('https://example.com/');
    expect(typeof result.content).toBe('string');
    expect((result.content as string).length).toBeGreaterThan(0);
  });

  it('falls back to raw_fetch even when provider order only lists jina', async () => {
    config.TOOL_WEB_SCRAPE_PROVIDER_ORDER = 'jina';
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'jina down',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html><body>Fallback content</body></html>',
      });

    const result = await scrapeWebPage({
      url: 'https://example.com',
      maxChars: 1_000,
    });

    expect(result.provider).toBe('raw_fetch');
    expect(result.content).toContain('Fallback content');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('runs web_search through SearXNG when configured', async () => {
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = 'searxng';
    config.SEARXNG_BASE_URL = 'http://localhost:8080';

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          results: [
            {
              title: 'Sage docs',
              url: 'https://example.com/sage',
              content: 'Sage guide',
            },
          ],
        }),
    });

    const result = await runWebSearch({
      query: 'sage docs',
      depth: 'quick',
      maxResults: 3,
    });

    expect(result.provider).toBe('searxng');
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Sage docs',
          url: 'https://example.com/sage',
        }),
      ]),
    );
  });

  it('falls back to SearXNG HTML parsing when JSON format is unavailable', async () => {
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = 'searxng';
    config.SEARXNG_BASE_URL = 'http://localhost:8080';

    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'forbidden',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          '<article class="result"><h3><a href="https://example.com/docs">Sage Docs</a></h3><p class="content">Official docs</p></article>',
      });

    const result = await runWebSearch({
      query: 'sage docs',
      depth: 'quick',
      maxResults: 3,
    });

    expect(result.provider).toBe('searxng');
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Sage Docs',
          url: 'https://example.com/docs',
        }),
      ]),
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('disables pollinations fallback when allowLlmFallback is false', async () => {
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = 'pollinations';

    let thrown: unknown = null;
    try {
      await runWebSearch({
        query: 'sage docs',
        depth: 'quick',
        maxResults: 3,
        allowLlmFallback: false,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const errorText = (thrown as Error).message;
    expect(errorText).toContain('Providers attempted: tavily, exa');
    expect(errorText).toContain('Skipped local providers: searxng');
    expect(errorText).not.toContain('pollinations');
  });

  it('skips local searxng when not configured', async () => {
    config.SEARXNG_BASE_URL = '';
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = 'searxng';

    await expect(
      runWebSearch({
        query: 'sage docs',
        depth: 'quick',
        maxResults: 3,
        providerOrder: ['searxng'],
        allowLlmFallback: false,
      }),
    ).rejects.toThrow('searxng: skipped (not configured');

    expect(global.fetch).toHaveBeenCalledTimes(0);
  });

  it('uses explicit scrape providerOrder override with local-first behavior', async () => {
    config.CRAWL4AI_BASE_URL = 'http://localhost:11235';
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'crawl4ai down',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html><body>raw fallback content</body></html>',
      });

    const result = await scrapeWebPage({
      url: 'https://example.com',
      maxChars: 1_000,
      providerOrder: ['crawl4ai', 'raw_fetch'],
    });

    expect(result.provider).toBe('raw_fetch');
    expect(result.content).toContain('raw fallback content');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('skips local crawl4ai when not configured and uses raw fallback', async () => {
    config.CRAWL4AI_BASE_URL = '';
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<html><body>raw fallback content</body></html>',
    });

    const result = await scrapeWebPage({
      url: 'https://example.com',
      maxChars: 1_000,
      providerOrder: ['crawl4ai', 'raw_fetch'],
    });

    expect(result.provider).toBe('raw_fetch');
    expect(result.providersSkipped).toEqual(expect.arrayContaining(['crawl4ai']));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('cooldowns unreachable local searxng provider and skips it on next call', async () => {
    config.SEARXNG_BASE_URL = 'http://127.0.0.1:8080';

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:8080'),
    );

    await expect(
      runWebSearch({
        query: 'sage docs',
        depth: 'quick',
        maxResults: 3,
        providerOrder: ['searxng'],
        allowLlmFallback: false,
      }),
    ).rejects.toThrow('Providers attempted: searxng');

    const firstCallCount = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(firstCallCount).toBe(2);

    await expect(
      runWebSearch({
        query: 'sage docs',
        depth: 'quick',
        maxResults: 3,
        providerOrder: ['searxng'],
        allowLlmFallback: false,
      }),
    ).rejects.toThrow('Skipped local providers: searxng');

    const secondCallCount = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(secondCallCount).toBe(firstCallCount);
  });

  it('cooldowns unreachable local crawl4ai provider and skips it on next scrape', async () => {
    config.CRAWL4AI_BASE_URL = 'http://127.0.0.1:11235';
    let crawlCalls = 0;

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('127.0.0.1:11235')) {
        crawlCalls += 1;
        throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:11235');
      }
      return {
        ok: true,
        status: 200,
        text: async () => '<html><body>raw fallback content</body></html>',
      };
    });

    const first = await scrapeWebPage({
      url: 'https://example.com',
      maxChars: 1_000,
      providerOrder: ['crawl4ai', 'raw_fetch'],
    });
    expect(first.provider).toBe('raw_fetch');
    expect(crawlCalls).toBe(1);

    const second = await scrapeWebPage({
      url: 'https://example.com',
      maxChars: 1_000,
      providerOrder: ['crawl4ai', 'raw_fetch'],
    });
    expect(second.provider).toBe('raw_fetch');
    expect(crawlCalls).toBe(1);
  });

  it('decodes GitHub file content', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('hello from file', 'utf8').toString('base64'),
          html_url: 'https://github.com/acme/repo/blob/main/README.md',
        }),
    });

    const result = await lookupGitHubFile({
      repo: 'acme/repo',
      path: 'README.md',
    });

    expect(result.path).toBe('README.md');
    expect(result.content).toContain('hello from file');
  });

  it('lists local ollama models', async () => {
    config.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          models: [
            {
              name: 'llama3.1:8b',
              size: 1_234_567,
              modified_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
    });

    const result = await listLocalOllamaModels();

    expect(result.modelCount).toBe(1);
    expect(result.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'llama3.1:8b',
        }),
      ]),
    );
  });

  it('looks up cached channel files', async () => {
    mockFindIngestedAttachmentsForLookup.mockResolvedValueOnce([
      {
        id: 'att-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'msg-100',
        attachmentIndex: 0,
        filename: 'report.md',
        sourceUrl: 'https://cdn.discordapp.com/report.md',
        contentType: 'text/markdown',
        declaredSizeBytes: 128,
        readSizeBytes: 128,
        extractor: 'tika',
        status: 'ok',
        errorText: null,
        extractedText: 'hello from cache',
        extractedTextChars: 16,
        createdAt: new Date('2026-02-11T00:00:00.000Z'),
        updatedAt: new Date('2026-02-11T00:00:00.000Z'),
      },
    ]);

    const result = await lookupChannelFileCache({
      guildId: 'guild-1',
      channelId: 'channel-1',
      query: 'report',
      includeContent: true,
    });

    expect(mockFindIngestedAttachmentsForLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        query: 'report',
      }),
    );
    expect(result.count).toBe(1);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: 'report.md',
          messageId: 'msg-100',
          content: 'hello from cache',
        }),
      ]),
    );
  });
});

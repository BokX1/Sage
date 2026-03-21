import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/platform/config/env';
import * as llm from '@/platform/llm';
import { stubFetch, type FetchMock } from '../../../testkit/fetch';

const {
  mockFindIngestedAttachmentsForLookup,
  mockFindIngestedAttachmentsForLookupInGuild,
  mockListIngestedAttachmentsByIds,
} = vi.hoisted(() => ({
  mockFindIngestedAttachmentsForLookup: vi.fn(),
  mockFindIngestedAttachmentsForLookupInGuild: vi.fn(),
  mockListIngestedAttachmentsByIds: vi.fn(),
}));

vi.mock('@/features/attachments/ingestedAttachmentRepo', () => ({
  findIngestedAttachmentsForLookup: mockFindIngestedAttachmentsForLookup,
  findIngestedAttachmentsForLookupInGuild: mockFindIngestedAttachmentsForLookupInGuild,
  listIngestedAttachmentsByIds: mockListIngestedAttachmentsByIds,
}));

const { mockFilterChannelIdsByMemberAccess } = vi.hoisted(() => ({
  mockFilterChannelIdsByMemberAccess: vi.fn(),
}));

vi.mock('@/platform/discord/channel-access', () => ({
  filterChannelIdsByMemberAccess: mockFilterChannelIdsByMemberAccess,
}));

const { mockRequestDiscordInteractionForTool } = vi.hoisted(() => ({
  mockRequestDiscordInteractionForTool: vi.fn(),
}));

vi.mock('@/features/admin/adminActionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/admin/adminActionService')>();
  return {
    ...actual,
    requestDiscordInteractionForTool: mockRequestDiscordInteractionForTool,
  };
});

const { mockDiscordChannelFetch } = vi.hoisted(() => ({
  mockDiscordChannelFetch: vi.fn(),
}));

vi.mock('@/platform/discord/client', () => ({
  client: {
    channels: {
      fetch: mockDiscordChannelFetch,
    },
  },
}));

import {
  __resetLocalProviderCooldownForTests,
  lookupChannelFileCache,
  lookupServerFileCache,
  readIngestedAttachmentText,
  sendCachedAttachment,
  lookupNpmPackage,
  runAgenticWebScrape,
  runWebSearch,
  sanitizePublicUrl,
  sanitizeUrl,
  scrapeWebPage,
  searchStackOverflow,
} from '@/features/agent-runtime/toolIntegrations';

describe('toolIntegrations', () => {
  const originalSearchOrder = config.TOOL_WEB_SEARCH_PROVIDER_ORDER;
  const originalSearxngBase = config.SEARXNG_BASE_URL;
  const originalScrapeOrder = config.TOOL_WEB_SCRAPE_PROVIDER_ORDER;
  const originalCrawl4aiBase = config.CRAWL4AI_BASE_URL;
  const originalTavilyApiKey = config.TAVILY_API_KEY;
  const originalExaApiKey = config.EXA_API_KEY;

  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = stubFetch();
    __resetLocalProviderCooldownForTests();
    mockFindIngestedAttachmentsForLookup.mockReset();
    mockFindIngestedAttachmentsForLookupInGuild.mockReset();
    mockListIngestedAttachmentsByIds.mockReset();
    mockFilterChannelIdsByMemberAccess.mockReset();
    mockRequestDiscordInteractionForTool.mockReset();
    mockDiscordChannelFetch.mockReset();
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = originalSearchOrder;
    config.SEARXNG_BASE_URL = originalSearxngBase;
    config.TOOL_WEB_SCRAPE_PROVIDER_ORDER = originalScrapeOrder;
    config.CRAWL4AI_BASE_URL = originalCrawl4aiBase;
    config.TAVILY_API_KEY = originalTavilyApiKey;
    config.EXA_API_KEY = originalExaApiKey;
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
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
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
    });

    const result = await lookupNpmPackage({ packageName: 'acme-pkg' });

    expect(result.version).toBe('1.2.3');
    expect(result.latestVersion).toBe('1.2.3');
    expect(result.dependencyCount).toBe(2);
    expect(result.repositoryUrl).toBe('https://github.com/acme/pkg');
    expect(result.repositoryUrlNormalized).toBe('https://github.com/acme/pkg');
    expect(result.githubRepo).toBe('acme/pkg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('decodes stack overflow title entities in a single pass', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          items: [
            {
              title: 'AT&amp;T &lt;3 and &amp;lt;code&amp;gt;',
              link: 'https://stackoverflow.com/questions/1/example',
              score: 7,
              answer_count: 2,
              is_answered: true,
            },
          ],
        }),
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
    });

    const result = await searchStackOverflow({ query: 'entity decode', maxResults: 1 });

    const typed = result as { results: Array<{ title: string }> };
    expect(typed.results).toHaveLength(1);
    expect(typed.results[0]?.title).toContain('AT&T <3');
    expect(typed.results[0]?.title).toContain('&lt;code&gt;');
    expect(typed.results[0]?.title).not.toContain('<code>');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can include the accepted answer body when requested', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            items: [
              {
                title: 'Example',
                link: 'https://stackoverflow.com/questions/42/example',
                score: 10,
                answer_count: 3,
                accepted_answer_id: 123,
                is_answered: true,
                creation_date: 1,
                last_activity_date: 2,
              },
            ],
          }),
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            items: [
              {
                link: 'https://stackoverflow.com/a/123',
                score: 5,
                creation_date: 3,
                last_activity_date: 4,
                body: '<p>Try this:</p><pre><code>console.log(&quot;hi&quot;)\\n</code></pre>',
              },
            ],
          }),
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
      });

    const result = await searchStackOverflow({
      query: 'include accepted answer',
      maxResults: 1,
      includeAcceptedAnswer: true,
    });

    const typed = result as {
      acceptedAnswer?: { answerId?: number; url?: string | null; body?: string } | null;
      acceptedAnswerError?: string | null;
    };

    expect(typed.acceptedAnswerError).toBeNull();
    expect(typed.acceptedAnswer).toEqual(
      expect.objectContaining({
        answerId: 123,
        url: 'https://stackoverflow.com/a/123',
      }),
    );
    expect(String(typed.acceptedAnswer?.body ?? '')).toContain('```');
    expect(String(typed.acceptedAnswer?.body ?? '')).toContain('console.log("hi")');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('scrapes content via Jina fallback when Firecrawl/Crawl4AI are unavailable', async () => {
    config.TOOL_WEB_SCRAPE_PROVIDER_ORDER = 'jina';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'Example page content',
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
    });

    const result = await scrapeWebPage({
      url: 'https://example.com',
    });

    const typed = result as { provider: string; url: string; content: unknown };
    expect(typed.provider).toBe('jina');
    expect(typed.url).toBe('https://example.com/');
    expect(typeof typed.content).toBe('string');
    expect(String(typed.content).length).toBeGreaterThan(0);
  });

  it('falls back to nomnom and raw_fetch even when provider order only lists jina', async () => {
    config.TOOL_WEB_SCRAPE_PROVIDER_ORDER = 'jina';
    const mockChat = vi.fn().mockRejectedValue(new Error('nomnom unavailable'));
    const createClientSpy = vi
      .spyOn(llm, 'createLLMClient')
      .mockReturnValue({ chat: mockChat } as unknown as ReturnType<typeof llm.createLLMClient>);
    try {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'jina down',
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          text: () => Promise<string>;
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => '<html><body>Fallback content</body></html>',
        } satisfies {
          ok: boolean;
          status: number;
          statusText: string;
          text: () => Promise<string>;
        });

      const result = await scrapeWebPage({
        url: 'https://example.com',
      });

      const typed = result as { provider: string; content: unknown };
      expect(typed.provider).toBe('raw_fetch');
      expect(String(typed.content)).toContain('Fallback content');
      expect(createClientSpy).toHaveBeenCalledWith({ agentModel: 'nomnom' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      createClientSpy.mockRestore();
    }
  });

  it('strips script/style blocks with whitespace-padded closing tags in raw fetch', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        '<html><body>Before<script>first()</script >Visible<style>.x{color:red}</style   >After</body></html>',
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
    });

    const result = await scrapeWebPage({
      url: 'https://example.com',
      providerOrder: ['raw_fetch'],
    });

    const typed = result as { provider: string; content: unknown };
    expect(typed.provider).toBe('raw_fetch');
    const content = String(typed.content);
    expect(content).toContain('Before');
    expect(content).toContain('Visible');
    expect(content).toContain('After');
    expect(content).not.toContain('first()');
    expect(content).not.toContain('.x{color:red}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs agentic web scrape with instruction and sanitized URL', async () => {
    const mockChat = vi.fn().mockResolvedValue({ text: '## Extracted\n\nDetails' });
    const createClientSpy = vi
      .spyOn(llm, 'createLLMClient')
      .mockReturnValue({ chat: mockChat } as unknown as ReturnType<typeof llm.createLLMClient>);

    const result = await runAgenticWebScrape({
      url: 'https://example.com#section',
      instruction: 'Extract the key points.',
    });

    expect(createClientSpy).toHaveBeenCalledWith({ agentModel: 'nomnom' });
    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'nomnom',
        temperature: 0.1,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('URL: https://example.com/'),
          }),
        ]),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'nomnom',
        url: 'https://example.com/',
        instruction: 'Extract the key points.',
        content: '## Extracted\n\nDetails',
      }),
    );
  });

  it('rejects private URLs for agentic web scrape before creating llm client', async () => {
    const createClientSpy = vi.spyOn(llm, 'createLLMClient');

    await expect(
      runAgenticWebScrape({
        url: 'http://localhost:3000/private',
        instruction: 'Extract the key points.',
      }),
    ).rejects.toThrow('URL must be a public HTTP(S) URL.');
    expect(createClientSpy).not.toHaveBeenCalled();
  });

  it('runs web_search through SearXNG when configured', async () => {
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = 'searxng';
    config.SEARXNG_BASE_URL = 'http://localhost:8080';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
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
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
    });

    const result = await runWebSearch({
      query: 'sage docs',
      depth: 'quick',
      maxResults: 3,
    });

    const typed = result as { provider: string; results: unknown[] };
    expect(typed.provider).toBe('searxng');
    expect(typed.results).toEqual(
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

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'forbidden',
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          '<article class="result"><h3><a href="https://example.com/docs">Sage Docs</a></h3><p class="content">Official docs</p></article>',
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
      });

    const result = await runWebSearch({
      query: 'sage docs',
      depth: 'quick',
      maxResults: 3,
    });

    const typed = result as { provider: string; results: unknown[] };
    expect(typed.provider).toBe('searxng');
    expect(typed.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Sage Docs',
          url: 'https://example.com/docs',
        }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back from tavily to exa when tavily returns empty payload', async () => {
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = 'tavily,exa';
    config.TAVILY_API_KEY = 'tvly-test-key';
    config.EXA_API_KEY = 'exa-test-key';

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            answer: '',
            results: [],
          }),
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            results: [
              {
                title: 'Exa result',
                url: 'https://example.com/exa-result',
                text: 'Found by Exa',
              },
            ],
          }),
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
      });

    const result = await runWebSearch({
      query: 'sage docs',
      depth: 'quick',
      maxResults: 3,
      providerOrder: ['tavily', 'exa'],
    });

    const typed = result as { provider: string; providersTried: string[]; results: unknown[] };
    expect(typed.provider).toBe('exa');
    expect(typed.providersTried).toEqual(['tavily', 'exa']);
    expect(typed.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Exa result',
          url: 'https://example.com/exa-result',
        }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps web search scoped to configured search providers only', async () => {
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = 'tavily,exa,searxng';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'error',
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
    });

    let thrown: unknown = null;
    try {
      await runWebSearch({
        query: 'sage docs',
        depth: 'quick',
        maxResults: 3,
        providerOrder: ['tavily', 'exa', 'searxng'],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const errorText = (thrown as Error).message;
    expect(errorText).toContain('Providers attempted: tavily, exa');
    expect(errorText).not.toContain('ai_provider');
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
      }),
    ).rejects.toThrow('searxng: skipped (not configured');

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('uses explicit scrape providerOrder override with local-first behavior', async () => {
    config.CRAWL4AI_BASE_URL = 'http://localhost:11235';
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'crawl4ai down',
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<html><body>raw fallback content</body></html>',
      } satisfies {
        ok: boolean;
        status: number;
        statusText: string;
        text: () => Promise<string>;
      });

    const result = await scrapeWebPage({
      url: 'https://example.com',
      providerOrder: ['crawl4ai', 'raw_fetch'],
    });

    const typed = result as { provider: string; content: unknown };
    expect(typed.provider).toBe('raw_fetch');
    expect(String(typed.content)).toContain('raw fallback content');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips local crawl4ai when not configured and uses raw fallback', async () => {
    config.CRAWL4AI_BASE_URL = '';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html><body>raw fallback content</body></html>',
    } satisfies {
      ok: boolean;
      status: number;
      statusText: string;
      text: () => Promise<string>;
    });

    const result = await scrapeWebPage({
      url: 'https://example.com',
      providerOrder: ['crawl4ai', 'raw_fetch'],
    });

    const typed = result as { provider: string; providersSkipped: unknown[] };
    expect(typed.provider).toBe('raw_fetch');
    expect(typed.providersSkipped).toEqual(expect.arrayContaining(['crawl4ai']));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cooldowns unreachable local searxng provider and skips it on next call', async () => {
    config.SEARXNG_BASE_URL = 'http://127.0.0.1:8080';

    fetchMock.mockRejectedValue(
      new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:8080'),
    );

    await expect(
      runWebSearch({
        query: 'sage docs',
        depth: 'quick',
        maxResults: 3,
        providerOrder: ['searxng'],
      }),
    ).rejects.toThrow('Providers attempted: searxng');

    const firstCallCount = fetchMock.mock.calls.length;
    expect(firstCallCount).toBe(2);

    await expect(
      runWebSearch({
        query: 'sage docs',
        depth: 'quick',
        maxResults: 3,
        providerOrder: ['searxng'],
      }),
    ).rejects.toThrow('Skipped local providers: searxng');

    const secondCallCount = fetchMock.mock.calls.length;
    expect(secondCallCount).toBe(firstCallCount);
  });

  it('cooldowns unreachable local crawl4ai provider and skips it on next scrape', async () => {
    config.CRAWL4AI_BASE_URL = 'http://127.0.0.1:11235';
    let crawlCalls = 0;

    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('127.0.0.1:11235')) {
        crawlCalls += 1;
        throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:11235');
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<html><body>raw fallback content</body></html>',
      };
    });

    const first = await scrapeWebPage({
      url: 'https://example.com',
      providerOrder: ['crawl4ai', 'raw_fetch'],
    });
    expect((first as { provider: string }).provider).toBe('raw_fetch');
    expect(crawlCalls).toBe(1);

    const second = await scrapeWebPage({
      url: 'https://example.com',
      providerOrder: ['crawl4ai', 'raw_fetch'],
    });
    expect((second as { provider: string }).provider).toBe('raw_fetch');
    expect(crawlCalls).toBe(1);
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
    expect((result as { count: number }).count).toBe(1);
    expect((result as { items: unknown[] }).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: 'report.md',
          messageId: 'msg-100',
          content: 'hello from cache',
        }),
      ]),
    );
  });

  it('looks up cached server files and filters by channel access', async () => {
    mockFindIngestedAttachmentsForLookupInGuild.mockResolvedValueOnce([
      {
        id: 'att-1',
        guildId: 'guild-1',
        channelId: 'channel-allowed',
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
      {
        id: 'att-2',
        guildId: 'guild-1',
        channelId: 'channel-private',
        messageId: 'msg-200',
        attachmentIndex: 0,
        filename: 'secret.md',
        sourceUrl: 'https://cdn.discordapp.com/secret.md',
        contentType: 'text/markdown',
        declaredSizeBytes: 128,
        readSizeBytes: 128,
        extractor: 'tika',
        status: 'ok',
        errorText: null,
        extractedText: 'top secret',
        extractedTextChars: 10,
        createdAt: new Date('2026-02-11T00:00:00.000Z'),
        updatedAt: new Date('2026-02-11T00:00:00.000Z'),
      },
    ]);

    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set(['channel-allowed']));

    const result = await lookupServerFileCache({
      guildId: 'guild-1',
      requesterUserId: 'user-1',
      query: 'report',
      includeContent: true,
    });

    expect(mockFindIngestedAttachmentsForLookupInGuild).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        query: 'report',
      }),
    );
    expect(mockFilterChannelIdsByMemberAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        userId: 'user-1',
        channelIds: expect.arrayContaining(['channel-allowed', 'channel-private']),
      }),
    );

    expect((result as { count: number }).count).toBe(1);
    expect((result as { items: unknown[] }).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: 'report.md',
          channelId: 'channel-allowed',
          messageId: 'msg-100',
        }),
      ]),
    );
  });

  it('reads stored image recall text from cached attachments', async () => {
    mockListIngestedAttachmentsByIds.mockResolvedValueOnce([
      {
        id: 'att-image',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'msg-100',
        attachmentIndex: 0,
        filename: 'meme.png',
        sourceUrl: 'https://cdn.discordapp.com/meme.png',
        contentType: 'image/png',
        declaredSizeBytes: 256,
        readSizeBytes: 256,
        extractor: 'vision',
        status: 'ok',
        errorText: null,
        extractedText: 'Image summary: cat meme\n\nVisible text: hello',
        extractedTextChars: 43,
        createdAt: new Date('2026-02-11T00:00:00.000Z'),
        updatedAt: new Date('2026-02-11T00:00:00.000Z'),
      },
    ]);
    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set(['channel-1']));

    const result = await readIngestedAttachmentText({
      guildId: 'guild-1',
      requesterUserId: 'user-1',
      attachmentId: 'att-image',
      maxChars: 2_000,
    });

    expect((result as { found: boolean }).found).toBe(true);
    expect((result as { readable: boolean }).readable).toBe(true);
    expect((result as { attachmentType: string }).attachmentType).toBe('image');
    expect((result as { content: string }).content).toContain('Image summary: cat meme');
  });

  it('returns resend guidance when attachment text is not ready yet', async () => {
    mockListIngestedAttachmentsByIds.mockResolvedValueOnce([
      {
        id: 'att-image',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'msg-100',
        attachmentIndex: 0,
        filename: 'meme.png',
        sourceUrl: 'https://cdn.discordapp.com/meme.png',
        contentType: 'image/png',
        declaredSizeBytes: 256,
        readSizeBytes: null,
        extractor: 'vision',
        status: 'queued',
        errorText: '[System: Image recall queued for background processing.]',
        extractedText: null,
        extractedTextChars: 0,
        createdAt: new Date('2026-02-11T00:00:00.000Z'),
        updatedAt: new Date('2026-02-11T00:00:00.000Z'),
      },
    ]);
    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set(['channel-1']));

    const result = await readIngestedAttachmentText({
      guildId: 'guild-1',
      requesterUserId: 'user-1',
      attachmentId: 'att-image',
      maxChars: 2_000,
    });

    expect((result as { found: boolean }).found).toBe(true);
    expect((result as { readable: boolean }).readable).toBe(false);
    expect((result as { guidance: string }).guidance).toContain('send_attachment');
    expect((result as { content: string | null }).content).toBeNull();
  });

  it('resends cached attachments and returns stored grounding text', async () => {
    mockListIngestedAttachmentsByIds.mockResolvedValueOnce([
      {
        id: 'att-file',
        guildId: 'guild-1',
        channelId: 'channel-source',
        messageId: 'msg-200',
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
    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set(['channel-source']));
    mockDiscordChannelFetch.mockResolvedValueOnce({
      guildId: 'guild-1',
      isDMBased: () => false,
      messages: {
        fetch: vi.fn().mockResolvedValue({
          attachments: {
            values: () => [{ name: 'report.md', url: 'https://cdn.discordapp.com/fresh-report.md' }],
          },
        }),
      },
    });
    mockRequestDiscordInteractionForTool.mockResolvedValueOnce({
      status: 'executed',
      action: 'send_message',
      channelId: 'channel-target',
      messageIds: ['msg-sent'],
    });

    const result = await sendCachedAttachment({
      guildId: 'guild-1',
      requesterUserId: 'user-1',
      requesterChannelId: 'channel-current',
      invokedBy: 'mention',
      attachmentId: 'att-file',
      channelId: 'channel-target',
      content: 'Here it is.',
      maxChars: 2_000,
    });

    expect(mockRequestDiscordInteractionForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-current',
        requestedBy: 'user-1',
        invokedBy: 'mention',
        request: expect.objectContaining({
          action: 'send_message',
          channelId: 'channel-target',
          content: 'Here it is.',
          files: [
            expect.objectContaining({
              filename: 'report.md',
              source: {
                type: 'url',
                url: 'https://cdn.discordapp.com/fresh-report.md',
              },
            }),
          ],
        }),
      }),
    );
    expect((result as { storedContent: string }).storedContent).toBe('hello from cache');
    expect((result as { sendResult: { status: string } }).sendResult.status).toBe('executed');
  });

  it('matches historical mixed-attachment rows by filename before refreshing resend URLs', async () => {
    mockListIngestedAttachmentsByIds.mockResolvedValueOnce([
      {
        id: 'att-file',
        guildId: 'guild-1',
        channelId: 'channel-source',
        messageId: 'msg-100',
        attachmentIndex: 0,
        filename: 'report.md',
        sourceUrl: 'https://cdn.discordapp.com/original-report.md',
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
    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set(['channel-source']));
    mockDiscordChannelFetch.mockResolvedValueOnce({
      guildId: 'guild-1',
      isDMBased: () => false,
      messages: {
        fetch: vi.fn().mockResolvedValue({
          attachments: {
            values: () => [
              { name: 'meme.png', url: 'https://cdn.discordapp.com/fresh-meme.png' },
              { name: 'report.md', url: 'https://cdn.discordapp.com/fresh-report.md' },
            ],
          },
        }),
      },
    });
    mockRequestDiscordInteractionForTool.mockResolvedValueOnce({
      status: 'executed',
      action: 'send_message',
      channelId: 'channel-target',
      messageIds: ['msg-sent'],
    });

    await sendCachedAttachment({
      guildId: 'guild-1',
      requesterUserId: 'user-1',
      requesterChannelId: 'channel-current',
      invokedBy: 'mention',
      attachmentId: 'att-file',
      channelId: 'channel-target',
      content: 'Here it is.',
      maxChars: 2_000,
    });

    expect(mockRequestDiscordInteractionForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          files: [
            expect.objectContaining({
              filename: 'report.md',
              source: {
                type: 'url',
                url: 'https://cdn.discordapp.com/fresh-report.md',
              },
            }),
          ],
        }),
      }),
    );
  });
});


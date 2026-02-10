import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/config';
import {
  listLocalOllamaModels,
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
  const originalOllamaBase = config.OLLAMA_BASE_URL;

  beforeEach(() => {
    vi.resetAllMocks();
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER = originalSearchOrder;
    config.SEARXNG_BASE_URL = originalSearxngBase;
    config.TOOL_WEB_SCRAPE_PROVIDER_ORDER = originalScrapeOrder;
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
});

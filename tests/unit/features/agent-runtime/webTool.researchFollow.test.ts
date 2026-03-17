import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunWebSearch, mockScrapeWebPage } = vi.hoisted(() => ({
  mockRunWebSearch: vi.fn(),
  mockScrapeWebPage: vi.fn(),
}));

vi.mock('../../../../src/features/agent-runtime/toolIntegrations', () => ({
  runWebSearch: mockRunWebSearch,
  scrapeWebPage: mockScrapeWebPage,
  runAgenticWebScrape: vi.fn(),
  sanitizePublicUrl: (url: string) => url,
}));

import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { webResearchTool } from '../../../../src/features/agent-runtime/webTool';

describe('web_research', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns bounded source reads from one search pass', async () => {
    mockRunWebSearch.mockResolvedValueOnce({
      provider: 'tavily',
      answer: '',
      sourceUrls: ['https://example.com/source'],
      results: [
        {
          title: 'Source',
          url: 'https://example.com/source',
          publishedDate: '2024-01-01T00:00:00.000Z',
        },
        {
          title: 'Other Source',
          url: 'https://example.com/other',
          publishedDate: '2024-01-02T00:00:00.000Z',
        },
      ],
    });

    mockScrapeWebPage
      .mockResolvedValueOnce({
        provider: 'raw_fetch',
        url: 'https://example.com/source',
        title: 'Source',
        content: 'Primary content',
      })
      .mockResolvedValueOnce({
        provider: 'raw_fetch',
        url: 'https://example.com/other',
        title: 'Other Source',
        content: 'Secondary content',
      });

    const registry = new ToolRegistry();
    registry.register(webResearchTool);

    const ctx = {
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      routeKind: 'search' as const,
    };

    const result = await registry.executeValidated(
      {
        name: 'web_research',
        args: {
          query: 'example query',
          followLinks: true,
          maxSources: 2,
        },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const payload = (result.result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
    expect(payload.query).toBe('example query');
    expect(payload.followLinksRequested).toBe(true);
    expect(payload.sourceUrls).toEqual(['https://example.com/source', 'https://example.com/other']);
    expect(payload.sourceReads).toHaveLength(2);
    expect(mockScrapeWebPage).toHaveBeenCalledTimes(2);
  });
});

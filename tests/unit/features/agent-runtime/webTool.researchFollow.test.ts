import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunWebSearch, mockScrapeWebPage } = vi.hoisted(() => ({
  mockRunWebSearch: vi.fn(),
  mockScrapeWebPage: vi.fn(),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  runWebSearch: mockRunWebSearch,
  scrapeWebPage: mockScrapeWebPage,
  runAgenticWebScrape: vi.fn(),
  sanitizePublicUrl: (url: string) => url,
  uniqueUrls: (text: string) => {
    const matches = text.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
    return Array.from(new Set(matches));
  },
}));

import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { webTool } from '../../../../src/features/agent-runtime/webTool';

describe('webTool research followLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('follows bounded links and returns a followQueue for leftovers', async () => {
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
      ],
    });

    mockScrapeWebPage
      .mockResolvedValueOnce({
        provider: 'raw_fetch',
        url: 'https://example.com/source',
        title: 'Source',
        content: 'See https://example.com/linked1 and https://example.com/linked2',
        truncated: false,
      })
      .mockResolvedValueOnce({
        provider: 'raw_fetch',
        url: 'https://example.com/linked1',
        title: 'Linked 1',
        content: 'Linked content',
        truncated: false,
      });

    const registry = new ToolRegistry();
    registry.register(webTool);

    const ctx = {
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      routeKind: 'search' as const,
      toolExecutionProfile: 'default' as const,
    };

    const result = await registry.executeValidated(
      {
        name: 'web',
        args: {
          think: 'research with follow',
          action: 'research',
          query: 'example query',
          followLinks: true,
          maxSources: 1,
          maxFollowedLinks: 1,
          maxFollowedLinksPerSource: 1,
        },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const payload = result.result as Record<string, unknown>;
    expect(payload.followLinks).toBe(true);
    expect(payload.followedCount).toBe(1);
    expect(payload.followQueueCount).toBe(1);

    const followed = payload.followed as Array<Record<string, unknown>>;
    expect(followed[0]?.url).toBe('https://example.com/linked1');

    const followQueue = payload.followQueue as Array<Record<string, unknown>>;
    expect(followQueue[0]?.url).toBe('https://example.com/linked2');

    expect(mockScrapeWebPage).toHaveBeenCalledTimes(2);
  });
});

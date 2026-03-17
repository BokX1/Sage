import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockScrapeWebPage } = vi.hoisted(() => ({
  mockScrapeWebPage: vi.fn(),
}));

vi.mock('../../../../src/features/agent-runtime/toolIntegrations', () => ({
  runWebSearch: vi.fn(),
  scrapeWebPage: mockScrapeWebPage,
  runAgenticWebScrape: vi.fn(),
  sanitizePublicUrl: (url: string) => url,
}));

import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { webReadPageTool } from '../../../../src/features/agent-runtime/webTool';
import { __resetPagedTextStoreForTests } from '../../../../src/features/agent-runtime/pagedTextStore';

describe('web_read_page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPagedTextStoreForTests();
  });

  it('returns a continuation token and pages without re-fetching', async () => {
    const content = `${'a'.repeat(2000)}${'b'.repeat(2000)}${'c'.repeat(50)}`;
    mockScrapeWebPage.mockResolvedValueOnce({
      provider: 'raw_fetch',
      url: 'https://example.com/',
      title: 'Example',
      content,
    });

    const registry = new ToolRegistry();
    registry.register(webReadPageTool);

    const ctx = {
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      routeKind: 'search' as const,
    };

    const first = await registry.executeValidated(
      {
        name: 'web_read_page',
        args: {
          url: 'https://example.com/',
        },
      },
      ctx,
    );

    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error);

    const firstPayload = (first.result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
    expect(firstPayload.content).toBe(`${'a'.repeat(2000)}${'b'.repeat(2000)}`);
    expect(firstPayload.hasMore).toBe(true);
    expect(firstPayload.nextStartChar).toBe(4000);
    expect(typeof firstPayload.contentId).toBe('string');

    const second = await registry.executeValidated(
      {
        name: 'web_read_page',
        args: {
          url: 'https://example.com/',
          contentId: String(firstPayload.contentId),
          startChar: Number(firstPayload.nextStartChar),
        },
      },
      ctx,
    );

    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error);

    const secondPayload = (second.result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
    expect(secondPayload.content).toBe('c'.repeat(50));
    expect(mockScrapeWebPage).toHaveBeenCalledTimes(1);
  });
});

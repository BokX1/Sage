import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockScrapeWebPage } = vi.hoisted(() => ({
  mockScrapeWebPage: vi.fn(),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  runWebSearch: vi.fn(),
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
import { __resetPagedTextStoreForTests } from '../../../../src/features/agent-runtime/pagedTextStore';

describe('webTool read.page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPagedTextStoreForTests();
  });

  it('returns a continuation token and pages without re-fetching', async () => {
    const content = `${'a'.repeat(200)}${'b'.repeat(200)}${'c'.repeat(50)}`;
    mockScrapeWebPage.mockResolvedValueOnce({
      provider: 'raw_fetch',
      url: 'https://example.com/',
      title: 'Example',
      content,
      truncated: false,
    });

    const registry = new ToolRegistry();
    registry.register(webTool);

    const ctx = {
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      routeKind: 'search' as const,
    };

    const first = await registry.executeValidated(
      {
        name: 'web',
        args: {
          action: 'read.page',
          url: 'https://example.com/',
          maxChars: 200,
        },
      },
      ctx,
    );

    expect(first.success).toBe(true);
    if (!first.success) {
      throw new Error(first.error);
    }
    const firstPayload = first.result as Record<string, unknown>;
    expect(firstPayload.content).toBe('a'.repeat(200));
    expect(firstPayload.hasMore).toBe(true);
    expect(firstPayload.nextStartChar).toBe(200);
    expect(typeof firstPayload.contentId).toBe('string');

    const contentId = String(firstPayload.contentId);
    const startChar = Number(firstPayload.nextStartChar);

    const second = await registry.executeValidated(
      {
        name: 'web',
        args: {
          action: 'read.page',
          url: 'https://example.com/',
          contentId,
          startChar,
          maxChars: 200,
        },
      },
      ctx,
    );

    expect(second.success).toBe(true);
    if (!second.success) {
      throw new Error(second.error);
    }
    const secondPayload = second.result as Record<string, unknown>;
    expect(secondPayload.content).toBe('b'.repeat(200));
    expect(mockScrapeWebPage).toHaveBeenCalledTimes(1);
  });
});

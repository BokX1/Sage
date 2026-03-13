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
  uniqueUrls: () => [],
}));

import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { webTool } from '../../../../src/features/agent-runtime/webTool';

describe('web tool default execution profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunWebSearch.mockResolvedValue({ provider: 'tavily', results: [] });
    mockScrapeWebPage.mockResolvedValue({ provider: 'raw_fetch', content: 'ok' });
  });

  it('uses balanced depth without legacy provider overrides', async () => {
    const registry = new ToolRegistry();
    registry.register(webTool);

    const result = await registry.executeValidated(
      {
        name: 'web',
        args: { action: 'search', query: 'latest sdk release notes' },
      },
      {
        traceId: 'trace-1',
        userId: 'user-1',
        channelId: 'channel-1',
        routeKind: 'search',
      },
    );

    expect(result.success).toBe(true);
    expect(mockRunWebSearch).toHaveBeenCalledTimes(1);
    const payload = mockRunWebSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.depth).toBe('balanced');
    expect(payload).not.toHaveProperty('providerOrder');
  });

  it('does not inject legacy scrape provider overrides', async () => {
    const registry = new ToolRegistry();
    registry.register(webTool);

    const result = await registry.executeValidated(
      {
        name: 'web',
        args: { action: 'read', url: 'https://example.com/docs' },
      },
      {
        traceId: 'trace-2',
        userId: 'user-1',
        channelId: 'channel-1',
        routeKind: 'search',
      },
    );

    expect(result.success).toBe(true);
    expect(mockScrapeWebPage).toHaveBeenCalledTimes(1);
    const payload = mockScrapeWebPage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('providerOrder');
  });
});

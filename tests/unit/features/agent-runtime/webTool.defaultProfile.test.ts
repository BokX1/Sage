import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunWebSearch, mockScrapeWebPage } = vi.hoisted(() => ({
  mockRunWebSearch: vi.fn(),
  mockScrapeWebPage: vi.fn(),
}));

vi.mock('../../../../src/features/agent-runtime/toolIntegrations', () => ({
  runWebSearch: mockRunWebSearch,
  scrapeWebPage: mockScrapeWebPage,
  sanitizePublicUrl: (url: string) => url,
}));

import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { webReadTool, webSearchTool } from '../../../../src/features/agent-runtime/webTool';
import { __resetToolMemoStoreForTests } from '../../../../src/features/agent-runtime/toolMemoStore';

describe('web tool default execution profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetToolMemoStoreForTests();
    mockRunWebSearch.mockResolvedValue({ provider: 'tavily', results: [] });
    mockScrapeWebPage.mockResolvedValue({ provider: 'raw_fetch', content: 'ok' });
  });

  it('uses balanced depth without legacy provider overrides', async () => {
    const registry = new ToolRegistry();
    registry.register(webSearchTool);

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
    registry.register(webReadTool);

    const result = await registry.executeValidated(
      {
        name: 'web_read',
        args: { url: 'https://example.com/docs' },
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

  it('memoizes repeated web_search calls briefly within the same scope', async () => {
    const registry = new ToolRegistry();
    registry.register(webSearchTool);

    const ctx = {
      traceId: 'trace-3',
      userId: 'user-1',
      channelId: 'channel-1',
      routeKind: 'search' as const,
    };

    await registry.executeValidated(
      {
        name: 'web_search',
        args: { query: 'latest sdk release notes' },
      },
      ctx,
    );
    await registry.executeValidated(
      {
        name: 'web_search',
        args: { query: 'latest sdk release notes' },
      },
      ctx,
    );

    expect(mockRunWebSearch).toHaveBeenCalledTimes(1);
  });
});

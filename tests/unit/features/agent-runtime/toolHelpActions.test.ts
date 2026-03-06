import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLookupNpmPackage } = vi.hoisted(() => ({
  mockLookupNpmPackage: vi.fn(),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  // web
  runWebSearch: vi.fn(),
  scrapeWebPage: vi.fn(),
  runAgenticWebScrape: vi.fn(),
  sanitizePublicUrl: (url: string) => url,
  uniqueUrls: () => [],

  // github
  lookupGitHubRepo: vi.fn(),
  lookupGitHubCodeSearch: vi.fn(),
  lookupGitHubFile: vi.fn(),
  searchGitHubIssuesAndPullRequests: vi.fn(),
  listGitHubCommits: vi.fn(),

  // npm
  lookupNpmPackage: mockLookupNpmPackage,
}));

import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { githubTool } from '../../../../src/features/agent-runtime/githubTool';
import { webTool } from '../../../../src/features/agent-runtime/webTool';
import { workflowTool } from '../../../../src/features/agent-runtime/workflowTool';

describe('tool help actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ctx = {
    traceId: 'trace-1',
    userId: 'user-1',
    channelId: 'channel-1',
    routeKind: 'search' as const,
    toolExecutionProfile: 'default' as const,
  };

  it('github help returns an action index', async () => {
    const registry = new ToolRegistry();
    registry.register(githubTool);

    const result = await registry.executeValidated(
      {
        name: 'github',
        args: { action: 'help' },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const payload = result.result as Record<string, unknown>;
    expect(payload.tool).toBe('github');
    expect(Array.isArray(payload.actions)).toBe(true);
    expect((payload.actions as string[]).includes('repo.get')).toBe(true);
    expect((payload.actions as string[]).includes('code.search')).toBe(true);
  });

  it('web help returns an action index', async () => {
    const registry = new ToolRegistry();
    registry.register(webTool);

    const result = await registry.executeValidated(
      {
        name: 'web',
        args: { action: 'help' },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const payload = result.result as Record<string, unknown>;
    expect(payload.tool).toBe('web');
    expect(Array.isArray(payload.actions)).toBe(true);
    expect((payload.actions as string[]).includes('research')).toBe(true);
    expect((payload.actions as string[]).includes('read.page')).toBe(true);
  });

  it('workflow help returns an action index', async () => {
    const registry = new ToolRegistry();
    registry.register(workflowTool);

    const result = await registry.executeValidated(
      {
        name: 'workflow',
        args: { action: 'help' },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const payload = result.result as Record<string, unknown>;
    expect(payload.tool).toBe('workflow');
    expect(Array.isArray(payload.actions)).toBe(true);
    expect((payload.actions as string[]).includes('npm.github_code_search')).toBe(true);
  });

  it('validation errors include a schema hint for known tools', async () => {
    const registry = new ToolRegistry();
    registry.register(githubTool);

    const result = await registry.executeValidated(
      {
        name: 'github',
        args: { action: 'repo.get' },
      },
      ctx,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('validation');
    expect(result.errorDetails?.category).toBe('validation');
    expect(result.errorDetails?.hint).toContain('Try: { action: "help" }');
  });
});

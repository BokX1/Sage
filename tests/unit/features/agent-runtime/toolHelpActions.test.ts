import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolSpecV2 } from '../../../../src/features/agent-runtime/toolRegistry';

const { mockLookupNpmPackage } = vi.hoisted(() => ({
  mockLookupNpmPackage: vi.fn(),
}));

vi.mock('../../../../src/features/agent-runtime/toolIntegrations', () => ({
  runWebSearch: vi.fn(),
  scrapeWebPage: vi.fn(),
  runAgenticWebScrape: vi.fn(),
  sanitizePublicUrl: (url: string) => url,
  lookupGitHubRepo: vi.fn(),
  lookupGitHubCodeSearch: vi.fn(),
  lookupGitHubFile: vi.fn(),
  searchGitHubIssuesAndPullRequests: vi.fn(),
  listGitHubCommits: vi.fn(),
  lookupNpmPackage: mockLookupNpmPackage,
}));

import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';
import { githubTools } from '../../../../src/features/agent-runtime/githubTool';
import { webTools } from '../../../../src/features/agent-runtime/webTool';
import { workflowTools } from '../../../../src/features/agent-runtime/workflowTool';
import { discordTools } from '../../../../src/features/agent-runtime/discordDomainTools';

function byName<T extends { name: string }>(tools: readonly T[], name: string): T {
  const found = tools.find((tool) => tool.name === name);
  if (!found) {
    throw new Error(`Missing tool ${name}`);
  }
  return found;
}

describe('granular tool contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ctx = {
    traceId: 'trace-1',
    userId: 'user-1',
    channelId: 'channel-1',
    routeKind: 'search' as const,
  };

  it('removes legacy help actions from GitHub, web, and workflow tools', async () => {
    const registry = new ToolRegistry();
    registry.register(byName(githubTools, 'github_get_repo') as ToolSpecV2<unknown, unknown>);
    registry.register(byName(webTools, 'web_search') as ToolSpecV2<unknown, unknown>);
    registry.register(
      byName(workflowTools, 'workflow_npm_github_code_search') as ToolSpecV2<unknown, unknown>,
    );

    const results = await Promise.all([
      registry.executeValidated({ name: 'github_get_repo', args: { action: 'help' } }, ctx),
      registry.executeValidated({ name: 'web_search', args: { action: 'help' } }, ctx),
      registry.executeValidated({ name: 'workflow_npm_github_code_search', args: { action: 'help' } }, ctx),
    ]);

    for (const result of results) {
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.errorType).toBe('validation');
    }
  });

  it('removes legacy help actions from Discord tools and does not expose action fields', async () => {
    const registry = new ToolRegistry();
    const tools = [
      byName(discordTools, 'discord_context_get_channel_summary'),
      byName(discordTools, 'discord_messages_search_history'),
      byName(discordTools, 'discord_server_list_channels'),
      byName(discordTools, 'discord_admin_create_role'),
    ];

    for (const tool of tools) {
      registry.register(tool as ToolSpecV2<unknown, unknown>);
      expect(tool.inputSchema?.properties).not.toHaveProperty('action');
    }

    expect(tools[0]?.inputValidator?.safeParse({}).success).toBe(true);

    const result = registry.validateToolCall({
      name: 'discord_messages_search_history',
      args: { action: 'help' },
    });
    expect(result.success).toBe(false);
  });

  it('keeps schema hints for granular GitHub tools', async () => {
    const registry = new ToolRegistry();
    registry.register(byName(githubTools, 'github_get_repo') as ToolSpecV2<unknown, unknown>);

    const result = await registry.executeValidated(
      {
        name: 'github_get_repo',
        args: {},
      },
      ctx,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('validation');
    expect(result.errorDetails?.hint).toContain('owner/name');
  });

  it('keeps metadata validation hints for direct tools', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'npm_info',
        args: {},
      },
      ctx,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('validation');
    expect(result.errorDetails?.category).toBe('validation');
    expect(result.errorDetails?.hint).toContain('packageName');
    expect(result.errorDetails?.hint).toContain('zod');
  });
});

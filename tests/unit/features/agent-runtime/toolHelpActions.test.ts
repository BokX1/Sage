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
import {
  discordAdminTool,
  discordContextTool,
  discordFilesTool,
  discordMessagesTool,
  discordServerTool,
} from '../../../../src/features/agent-runtime/discordDomainTools';
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
    expect(Array.isArray(payload.action_names)).toBe(true);
    expect((payload.action_names as string[]).includes('repo.get')).toBe(true);
    expect((payload.action_names as string[]).includes('code.search')).toBe(true);
    expect(payload.type).toBe('routed_tool_help');
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
    expect(Array.isArray(payload.action_names)).toBe(true);
    expect((payload.action_names as string[]).includes('research')).toBe(true);
    expect((payload.action_names as string[]).includes('read.page')).toBe(true);
    expect(payload.type).toBe('routed_tool_help');
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
    expect(Array.isArray(payload.action_names)).toBe(true);
    expect((payload.action_names as string[]).includes('npm.github_code_search')).toBe(true);
    expect(payload.type).toBe('routed_tool_help');
  });

  it('discord routed help returns structured action contracts for each domain tool', async () => {
    const registry = new ToolRegistry();
    registry.register(discordContextTool);
    registry.register(discordMessagesTool);
    registry.register(discordFilesTool);
    registry.register(discordServerTool);
    registry.register(discordAdminTool);

    const results = await Promise.all([
      registry.executeValidated({ name: 'discord_context', args: { action: 'help' } }, ctx),
      registry.executeValidated({ name: 'discord_messages', args: { action: 'help' } }, ctx),
      registry.executeValidated({ name: 'discord_files', args: { action: 'help' } }, ctx),
      registry.executeValidated({ name: 'discord_server', args: { action: 'help' } }, ctx),
      registry.executeValidated({ name: 'discord_admin', args: { action: 'help' } }, ctx),
    ]);

    for (const result of results) {
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      const payload = result.result as Record<string, unknown>;
      expect(payload.type).toBe('routed_tool_help');
      expect(Array.isArray(payload.action_names)).toBe(true);
      expect(Array.isArray(payload.action_contracts)).toBe(true);
      expect(Array.isArray(payload.guardrails)).toBe(true);
    }

    const messagesPayload = results[1];
    if (!messagesPayload.success) throw new Error(messagesPayload.error);
    expect((messagesPayload.result as Record<string, unknown>).action_names).toEqual(
      expect.arrayContaining(['send', 'search_history', 'create_poll']),
    );

    const filesPayload = results[2];
    if (!filesPayload.success) throw new Error(filesPayload.error);
    expect((filesPayload.result as Record<string, unknown>).action_names).toEqual(
      expect.arrayContaining(['read_attachment', 'send_attachment']),
    );

    const serverPayload = results[3];
    if (!serverPayload.success) throw new Error(serverPayload.error);
    expect((serverPayload.result as Record<string, unknown>).action_names).toEqual(
      expect.arrayContaining(['list_channels', 'get_thread', 'update_thread']),
    );

    const adminPayload = results[4];
    if (!adminPayload.success) throw new Error(adminPayload.error);
    expect((adminPayload.result as Record<string, unknown>).action_names).toEqual(
      expect.arrayContaining(['api', 'update_server_instructions']),
    );

    const contextResult = results[0];
    if (!contextResult.success) throw new Error(contextResult.error);
    const contextPayload = contextResult.result as {
      routing_notes: string[];
      action_contracts: Array<{ action: string; common_mistakes?: string[] }>;
    };
    expect(contextPayload.routing_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('changing that config belongs to discord_admin.update_server_instructions'),
        expect.stringContaining('Voice analytics and voice summaries live here'),
      ]),
    );
    expect(contextPayload.action_contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'get_server_instructions',
          common_mistakes: expect.arrayContaining([
            expect.stringContaining('discord_admin.update_server_instructions'),
          ]),
        }),
      ]),
    );

    const filesResult = results[2];
    if (!filesResult.success) throw new Error(filesResult.error);
    const filesHelpPayload = filesResult.result as {
      routing_notes: string[];
    };
    expect(filesHelpPayload.routing_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('list_channel/list_server enumerate files'),
        expect.stringContaining('find_channel/find_server search attachment text'),
      ]),
    );

    const adminHelpPayload = adminPayload.result as {
      routing_notes: string[];
      action_contracts: Array<{ action: string; common_mistakes?: string[] }>;
    };
    expect(adminHelpPayload.routing_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('governance/config and moderation as separate admin domains'),
        expect.stringContaining('Reply-targeted cleanup'),
        expect.stringContaining('update_server_instructions changes Sage behavior/persona config'),
        expect.stringContaining('submit_moderation is for enforcement workflows'),
      ]),
    );
    expect(adminHelpPayload.action_contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'update_server_instructions',
          avoid_when: expect.arrayContaining([
            expect.stringContaining('submit_moderation'),
          ]),
          common_mistakes: expect.arrayContaining([
            expect.stringContaining('submit_moderation'),
          ]),
        }),
        expect.objectContaining({
          action: 'submit_moderation',
          use_when: expect.arrayContaining([
            expect.stringContaining('replied-to message'),
          ]),
          avoid_when: expect.arrayContaining([
            expect.stringContaining('update_server_instructions'),
          ]),
          common_mistakes: expect.arrayContaining([
            expect.stringContaining('update_server_instructions'),
            expect.stringContaining('generic delete_message'),
          ]),
        }),
        expect.objectContaining({
          action: 'delete_message',
          avoid_when: expect.arrayContaining([
            expect.stringContaining('submit_moderation'),
          ]),
          common_mistakes: expect.arrayContaining([
            expect.stringContaining('replied-to spam/abusive user content'),
          ]),
        }),
        expect.objectContaining({
          action: 'api',
          common_mistakes: expect.arrayContaining([
            expect.stringContaining('typed discord_server or discord_admin actions'),
          ]),
        }),
      ]),
    );
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

import { describe, expect, it, vi } from 'vitest';

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class Client {
    async connect() {
      return undefined;
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class StdioClientTransport {
    async close() {
      return undefined;
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class StreamableHTTPClientTransport {
    async close() {
      return undefined;
    }
  },
}));

import { McpManager } from '../../../../../src/features/agent-runtime/mcp/manager';
import type { McpDiscoverySnapshot, McpServerDescriptor } from '../../../../../src/features/agent-runtime/mcp/types';

function makeServerDescriptor(overrides: Partial<McpServerDescriptor> = {}): McpServerDescriptor {
  return {
    id: 'github',
    sanitizedId: 'github',
    enabled: true,
    trustLevel: 'trusted',
    source: 'preset',
    presetId: 'github',
    transport: {
      kind: 'stdio',
      command: 'noop',
    },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<McpDiscoverySnapshot> = {}): McpDiscoverySnapshot {
  return {
    server: makeServerDescriptor(),
    connected: true,
    discoveredAtIso: '2026-03-21T00:00:00.000Z',
    tools: [
      {
        name: 'search_code',
        description: 'Search repository code.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    ],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    exposure: [
      {
        serverId: 'github',
        rawToolName: 'search_code',
        exposed: true,
        boundToolName: 'mcp__github__search_code',
      },
    ],
    ...overrides,
  };
}

describe('McpManager', () => {
  it('returns discovered raw MCP tool descriptors for capability binding', async () => {
    const manager = new McpManager();
    const runtime = {
      descriptor: makeServerDescriptor(),
      client: {
        callTool: vi.fn(async () => ({ content: [], structuredContent: { ok: true } })),
      },
      transport: {
        close: vi.fn(async () => undefined),
      },
      snapshot: makeSnapshot(),
      bindings: new Map([
        [
          'mcp__github__search_code',
          {
            toolName: 'mcp__github__search_code',
            serverId: 'github',
            rawToolName: 'search_code',
          },
        ],
      ]),
    };

    (manager as unknown as { initialized: boolean }).initialized = true;
    (manager as unknown as { runtimes: Map<string, unknown> }).runtimes = new Map([['github', runtime]]);

    expect(manager.getToolDescriptor('github', 'search_code')).toEqual(
      expect.objectContaining({
        name: 'search_code',
      }),
    );
  });

  it('classifies GitHub search_code auth failures as scoped GitHub MCP access problems', async () => {
    const manager = new McpManager();
    const runtime = {
      descriptor: makeServerDescriptor({
        transport: {
          kind: 'streamable_http' as const,
          url: 'https://api.githubcopilot.com/mcp/',
          headers: {
            Authorization: 'Bearer test-token',
          },
        },
      }),
      client: {
        callTool: vi.fn(async () => ({
          isError: true,
          content: [{ type: 'text', text: 'HTTP 401: Unauthorized' }],
        })),
      },
      transport: {
        close: vi.fn(async () => undefined),
      },
      snapshot: makeSnapshot(),
      bindings: new Map(),
    };

    (manager as unknown as { initialized: boolean }).initialized = true;
    (manager as unknown as { runtimes: Map<string, unknown> }).runtimes = new Map([['github', runtime]]);

    await expect(
      manager.callTool({
        serverId: 'github',
        rawToolName: 'search_code',
        args: { query: 'repo:owner/repo needle' },
      }),
    ).rejects.toMatchObject({
      name: 'ToolDetailedError',
      message: 'GitHub code search was denied for this request.',
      details: expect.objectContaining({
        category: 'unauthorized',
        code: 'github_mcp_search_code_access_denied',
        operationKey: 'mcp__github__search_code::{"query":"repo:owner/repo needle"}',
        provider: 'github-mcp',
      }),
    });
  });

  it('reports partial GitHub MCP capability when auth passes but code search fails', async () => {
    const manager = new McpManager();
    const callToolMock = vi.fn(async (input: { name: string }) => {
      if (input.name === 'get_me') {
        return {
          content: [{ type: 'text', text: 'authenticated' }],
          structuredContent: { login: 'tester' },
        };
      }
      return {
        isError: true,
        content: [{ type: 'text', text: 'HTTP 403: Forbidden' }],
      };
    });
    const runtime = {
      descriptor: makeServerDescriptor({
        transport: {
          kind: 'streamable_http' as const,
          url: 'https://api.githubcopilot.com/mcp/',
          headers: {
            Authorization: 'Bearer test-token',
          },
        },
      }),
      client: {
        callTool: callToolMock,
      },
      transport: {
        close: vi.fn(async () => undefined),
      },
      snapshot: makeSnapshot({
        tools: [
          {
            name: 'get_me',
            description: 'Return the authenticated user.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
          ...makeSnapshot().tools,
        ],
        exposure: [
          {
            serverId: 'github',
            rawToolName: 'get_me',
            exposed: true,
            boundToolName: 'mcp__github__get_me',
          },
          ...makeSnapshot().exposure,
        ],
      }),
      bindings: new Map(),
    };

    (manager as unknown as { initialized: boolean }).initialized = true;
    (manager as unknown as { runtimes: Map<string, unknown> }).runtimes = new Map([['github', runtime]]);

    const diagnostics = await manager.probeDiagnostics();

    expect(diagnostics).toEqual([
      expect.objectContaining({
        kind: 'preset_capability',
        presetId: 'github',
        serverId: 'github',
        status: 'partial',
        probes: expect.objectContaining({
          auth: 'pass',
          codeSearch: 'fail',
        }),
      }),
    ]);
    expect(callToolMock).toHaveBeenCalledTimes(2);
  });

  it('skips the baseline auth probe when get_me is intentionally not exposed', async () => {
    const manager = new McpManager();
    const callToolMock = vi.fn(async (input: { name: string }) => {
      expect(input.name).toBe('search_code');
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { items: [] },
      };
    });
    const runtime = {
      descriptor: makeServerDescriptor({
        transport: {
          kind: 'streamable_http' as const,
          url: 'https://api.githubcopilot.com/mcp/',
          headers: {
            Authorization: 'Bearer test-token',
          },
        },
      }),
      client: {
        callTool: callToolMock,
      },
      transport: {
        close: vi.fn(async () => undefined),
      },
      snapshot: makeSnapshot(),
      bindings: new Map(),
    };

    (manager as unknown as { initialized: boolean }).initialized = true;
    (manager as unknown as { runtimes: Map<string, unknown> }).runtimes = new Map([['github', runtime]]);

    const diagnostics = await manager.probeDiagnostics();

    expect(diagnostics).toEqual([
      expect.objectContaining({
        kind: 'preset_capability',
        presetId: 'github',
        serverId: 'github',
        status: 'healthy',
        probes: expect.objectContaining({
          auth: 'skip',
          codeSearch: 'pass',
        }),
      }),
    ]);
    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(callToolMock).toHaveBeenCalledWith({
      name: 'search_code',
      arguments: { query: 'repo:github/github-mcp-server search_code' },
    });
  });
});

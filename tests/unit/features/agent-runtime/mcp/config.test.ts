import { describe, expect, it } from 'vitest';

import { loadMcpServerConfigs } from '../../../../../src/features/agent-runtime/mcp/config';

type EnvLike = Parameters<typeof loadMcpServerConfigs>[0];

function makeEnv(overrides: Partial<EnvLike> = {}): EnvLike {
  return {
    MCP_SERVERS_JSON: '',
    MCP_GITHUB_ENABLED: false,
    MCP_GITHUB_TRANSPORT: 'stdio',
    MCP_GITHUB_COMMAND: '',
    MCP_GITHUB_ARGS_JSON: '["stdio","--read-only"]',
    MCP_GITHUB_URL: 'https://api.githubcopilot.com/mcp/',
    MCP_GITHUB_TOKEN: '',
    MCP_GITHUB_TOOLSETS_CSV: 'context,repos,issues,pull_requests,users',
    ...overrides,
  } as EnvLike;
}

describe('loadMcpServerConfigs', () => {
  it('loads generic MCP server configs with env interpolation and sanitization', () => {
    const servers = loadMcpServerConfigs(
      makeEnv({
        MCP_SERVERS_JSON:
          '[{"id":"Linear Cloud","enabled":true,"trustLevel":"untrusted","transport":{"kind":"streamable_http","url":"${LINEAR_URL}","headers":{"Authorization":"Bearer ${LINEAR_TOKEN}"}},"allow":{"tools":["search_issues"]}}]',
      }),
      {
        LINEAR_URL: 'https://linear.example/mcp',
        LINEAR_TOKEN: 'secret-token',
      } as NodeJS.ProcessEnv,
    );

    expect(servers).toEqual([
      expect.objectContaining({
        id: 'Linear Cloud',
        sanitizedId: 'linear_cloud',
        trustLevel: 'untrusted',
        transport: expect.objectContaining({
          kind: 'streamable_http',
          url: 'https://linear.example/mcp',
          headers: { Authorization: 'Bearer secret-token' },
        }),
        allow: {
          tools: ['search_issues'],
          resources: undefined,
          prompts: undefined,
        },
      }),
    ]);
  });

  it('builds the GitHub stdio preset in trusted mode with read-heavy toolsets', () => {
    const servers = loadMcpServerConfigs(
      makeEnv({
        MCP_GITHUB_ENABLED: true,
        MCP_GITHUB_COMMAND: 'npx',
        MCP_GITHUB_ARGS_JSON: '["github/github-mcp-server","stdio","--read-only"]',
        MCP_GITHUB_TOKEN: 'ghp_test',
      }),
    );

    expect(servers).toEqual([
      expect.objectContaining({
        id: 'github',
        sanitizedId: 'github',
        trustLevel: 'trusted',
        transport: expect.objectContaining({
          kind: 'stdio',
          command: 'npx',
          args: ['github/github-mcp-server', 'stdio', '--read-only'],
          env: expect.objectContaining({
            GITHUB_READ_ONLY: '1',
            GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test',
            GITHUB_TOOLSETS: 'context,repos,issues,pull_requests,users',
          }),
        }),
      }),
    ]);
  });

  it('builds the GitHub streamable HTTP preset with server-side read-only headers and toolsets', () => {
    const servers = loadMcpServerConfigs(
      makeEnv({
        MCP_GITHUB_ENABLED: true,
        MCP_GITHUB_TRANSPORT: 'streamable_http',
        MCP_GITHUB_URL: 'https://api.githubcopilot.com/mcp/',
        MCP_GITHUB_TOKEN: 'ghp_http_test',
        MCP_GITHUB_TOOLSETS_CSV: 'repos,issues',
      }),
    );

    expect(servers).toEqual([
      expect.objectContaining({
        id: 'github',
        sanitizedId: 'github',
        trustLevel: 'trusted',
        transport: expect.objectContaining({
          kind: 'streamable_http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: {
            Authorization: 'Bearer ghp_http_test',
            'X-MCP-Readonly': 'true',
            'X-MCP-Toolsets': 'repos,issues',
          },
        }),
      }),
    ]);
  });

  it('rejects duplicate sanitized server ids', () => {
    expect(() =>
      loadMcpServerConfigs(
        makeEnv({
          MCP_SERVERS_JSON:
            '[{"id":"GitHub Cloud","enabled":true,"trustLevel":"trusted","transport":{"kind":"stdio","command":"one"}},{"id":"github-cloud","enabled":true,"trustLevel":"trusted","transport":{"kind":"stdio","command":"two"}}]',
        }),
      ),
    ).toThrow(/Duplicate MCP server id/);
  });
});

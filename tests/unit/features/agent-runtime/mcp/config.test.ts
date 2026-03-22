import { describe, expect, it } from 'vitest';

import { loadMcpServerConfigs } from '../../../../../src/features/agent-runtime/mcp/config';

type EnvLike = Parameters<typeof loadMcpServerConfigs>[0];

function makeEnv(overrides: Partial<EnvLike> = {}): EnvLike {
  return {
    MCP_PRESETS_ENABLED_CSV: '',
    MCP_EXTRA_SERVERS_JSON: '',
    MCP_PRESET_GITHUB_TRANSPORT: 'stdio',
    MCP_PRESET_GITHUB_COMMAND: '',
    MCP_PRESET_GITHUB_ARGS_JSON: '["stdio","--read-only"]',
    MCP_PRESET_GITHUB_URL: 'https://api.githubcopilot.com/mcp/',
    MCP_PRESET_GITHUB_TOKEN: '',
    MCP_PRESET_GITHUB_TOOLSETS_CSV: 'context,repos,issues,pull_requests,users',
    MCP_PRESET_CONTEXT7_TRANSPORT: 'stdio',
    MCP_PRESET_CONTEXT7_COMMAND: '',
    MCP_PRESET_CONTEXT7_ARGS_JSON: '["-y","@upstash/context7-mcp"]',
    MCP_PRESET_CONTEXT7_URL: '',
    MCP_PRESET_CONTEXT7_TOKEN: '',
    MCP_PRESET_PLAYWRIGHT_TRANSPORT: 'stdio',
    MCP_PRESET_PLAYWRIGHT_COMMAND: '',
    MCP_PRESET_PLAYWRIGHT_ARGS_JSON: '["@playwright/mcp@latest"]',
    MCP_PRESET_PLAYWRIGHT_URL: '',
    MCP_PRESET_PLAYWRIGHT_TOKEN: '',
    MCP_PRESET_FIRECRAWL_TRANSPORT: 'streamable_http',
    MCP_PRESET_FIRECRAWL_COMMAND: '',
    MCP_PRESET_FIRECRAWL_ARGS_JSON: '[]',
    MCP_PRESET_FIRECRAWL_URL: 'https://mcp.firecrawl.dev/mcp',
    MCP_PRESET_FIRECRAWL_TOKEN: '',
    MCP_PRESET_MARKITDOWN_TRANSPORT: 'stdio',
    MCP_PRESET_MARKITDOWN_COMMAND: '',
    MCP_PRESET_MARKITDOWN_ARGS_JSON: '["markitdown-mcp"]',
    MCP_PRESET_MARKITDOWN_URL: '',
    MCP_PRESET_MARKITDOWN_TOKEN: '',
    ...overrides,
  } as EnvLike;
}

describe('loadMcpServerConfigs', () => {
  it('loads generic extra MCP server configs with env interpolation and sanitization', () => {
    const servers = loadMcpServerConfigs(
      makeEnv({
        MCP_EXTRA_SERVERS_JSON:
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
        source: 'custom',
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
        MCP_PRESETS_ENABLED_CSV: 'github',
        MCP_PRESET_GITHUB_COMMAND: 'npx',
        MCP_PRESET_GITHUB_ARGS_JSON: '["github/github-mcp-server","stdio","--read-only"]',
        MCP_PRESET_GITHUB_TOKEN: 'ghp_test',
      }),
    );

    expect(servers).toEqual([
      expect.objectContaining({
        id: 'github',
        sanitizedId: 'github',
        source: 'preset',
        presetId: 'github',
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
        MCP_PRESETS_ENABLED_CSV: 'github',
        MCP_PRESET_GITHUB_TRANSPORT: 'streamable_http',
        MCP_PRESET_GITHUB_URL: 'https://api.githubcopilot.com/mcp/',
        MCP_PRESET_GITHUB_TOKEN: 'ghp_http_test',
        MCP_PRESET_GITHUB_TOOLSETS_CSV: 'repos,issues',
      }),
    );

    expect(servers).toEqual([
      expect.objectContaining({
        id: 'github',
        sanitizedId: 'github',
        source: 'preset',
        presetId: 'github',
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

  it('rejects duplicate sanitized server ids across extra servers and presets', () => {
    expect(() =>
      loadMcpServerConfigs(
        makeEnv({
          MCP_PRESETS_ENABLED_CSV: 'github',
          MCP_PRESET_GITHUB_COMMAND: 'npx',
          MCP_EXTRA_SERVERS_JSON:
            '[{"id":"GitHub","enabled":true,"trustLevel":"trusted","transport":{"kind":"stdio","command":"npx"}}]',
        }),
      ),
    ).toThrow(/Duplicate MCP server id/);
  });
});

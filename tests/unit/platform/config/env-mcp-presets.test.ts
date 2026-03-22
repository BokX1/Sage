import { describe, expect, it } from 'vitest';

import { envSchema, testDefaults } from '../../../../src/platform/config/envSchema';

function makeProductionEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...testDefaults,
    NODE_ENV: 'production',
    DISCORD_TOKEN: 'prod-discord-token',
    DISCORD_APP_ID: 'prod-discord-app-id',
    DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5432/sage?schema=public',
    SECRET_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    AI_PROVIDER_BASE_URL: 'https://provider.example/v1',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'main-agent-model',
    AI_PROVIDER_PROFILE_AGENT_MODEL: 'profile-agent-model',
    AI_PROVIDER_SUMMARY_AGENT_MODEL: 'summary-agent-model',
    IMAGE_PROVIDER_BASE_URL: 'https://image-provider.example',
    IMAGE_PROVIDER_MODEL: 'image-model',
    SERVER_PROVIDER_PROFILE_URL: 'https://server-provider.example/account/profile',
    SERVER_PROVIDER_AUTHORIZE_URL:
      'https://server-provider.example/authorize?redirect_url=https://server-provider.example&permissions=profile,balance,usage',
    SERVER_PROVIDER_DASHBOARD_URL: 'https://server-provider.example/dashboard',
    ...overrides,
  };
}

describe('envSchema MCP preset defaults', () => {
  it('parses the curated preset defaults advertised in the example config', () => {
    const parsed = envSchema.safeParse(
      makeProductionEnv({
        MCP_PRESET_CONTEXT7_ARGS_JSON: undefined as never,
        MCP_PRESET_PLAYWRIGHT_ARGS_JSON: undefined as never,
        MCP_PRESET_FIRECRAWL_TRANSPORT: undefined as never,
        MCP_PRESET_FIRECRAWL_URL: undefined as never,
        MCP_PRESET_MARKITDOWN_ARGS_JSON: undefined as never,
      }),
    );

    if (!parsed.success) {
      throw new Error(`Expected MCP preset defaults to parse: ${JSON.stringify(parsed.error.issues)}`);
    }

    expect(parsed.data).toMatchObject({
      MCP_PRESET_CONTEXT7_ARGS_JSON: '["-y","@upstash/context7-mcp"]',
      MCP_PRESET_PLAYWRIGHT_ARGS_JSON: '["@playwright/mcp@latest"]',
      MCP_PRESET_FIRECRAWL_TRANSPORT: 'streamable_http',
      MCP_PRESET_FIRECRAWL_URL: 'https://mcp.firecrawl.dev/mcp',
      MCP_PRESET_MARKITDOWN_ARGS_JSON: '["markitdown-mcp"]',
    });
  });
});

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
    ...overrides,
  };
}

describe('envSchema AI provider host key contract', () => {
  it('allows production boot when the host AI provider key is blank', () => {
    const parsed = envSchema.safeParse(
      makeProductionEnv({
        AI_PROVIDER_API_KEY: '',
      }),
    );

    if (!parsed.success) {
      throw new Error(
        `Expected production env to parse without a host AI provider key: ${JSON.stringify(parsed.error.issues)}`,
      );
    }

    expect(parsed.data).toMatchObject({
      NODE_ENV: 'production',
      AI_PROVIDER_BASE_URL: 'https://provider.example/v1',
      AI_PROVIDER_API_KEY: '',
      AI_PROVIDER_MAIN_AGENT_MODEL: 'main-agent-model',
      AI_PROVIDER_PROFILE_AGENT_MODEL: 'profile-agent-model',
      AI_PROVIDER_SUMMARY_AGENT_MODEL: 'summary-agent-model',
    });
  });
});

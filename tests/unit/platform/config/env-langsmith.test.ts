import { describe, expect, it } from 'vitest';
import { envSchema, testDefaults } from '../../../../src/platform/config/envSchema';

function makeProductionEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...testDefaults,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5432/sage?schema=public',
    ...overrides,
  };
}

describe('envSchema LangSmith contract', () => {
  it('allows production boot when LangSmith tracing is disabled', () => {
    const parsed = envSchema.safeParse(
      makeProductionEnv({
        LANGSMITH_TRACING: 'false',
        LANGSMITH_ENDPOINT: 'https://api.smith.langchain.com',
        LANGSMITH_API_KEY: '',
        LANGSMITH_PROJECT: '',
      }),
    );

    if (!parsed.success) {
      throw new Error(
        `Expected production env to parse when LangSmith tracing is disabled: ${JSON.stringify(parsed.error.issues)}`,
      );
    }

    expect(parsed.data).toMatchObject({
      NODE_ENV: 'production',
      LANGSMITH_TRACING: false,
      LANGSMITH_ENDPOINT: 'https://api.smith.langchain.com',
      LANGSMITH_API_KEY: '',
      LANGSMITH_PROJECT: '',
    });
  });

  it('requires a LangSmith API key only when tracing is enabled', () => {
    const parsed = envSchema.safeParse(
      makeProductionEnv({
        LANGSMITH_TRACING: 'true',
        LANGSMITH_API_KEY: '',
      }),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    expect(issues).toContainEqual({
      path: 'LANGSMITH_API_KEY',
      message: 'LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true.',
    });
  });
});

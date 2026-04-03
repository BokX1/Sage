/* eslint-disable no-console */

import dotenv from 'dotenv';
import type { ToolExecutionContext } from '../features/agent-runtime/runtimeToolContract';

type SmokeCheck = {
  name: string;
  optional: boolean;
  run: () => Promise<string>;
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function summarizeResult(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `resultType=${typeof value}`;
  }
  return `keys=${Object.keys(value as Record<string, unknown>).slice(0, 8).join(',') || 'none'}`;
}

function buildSmokeContext(): ToolExecutionContext {
  return {
    traceId: 'bridge-smoke',
    graphThreadId: 'bridge-smoke',
    userId: process.env.SAGE_BRIDGE_SMOKE_USER_ID?.trim() || 'bridge-smoke-user',
    channelId: process.env.SAGE_BRIDGE_SMOKE_CHANNEL_ID?.trim() || 'bridge-smoke-channel',
    guildId: process.env.SAGE_BRIDGE_SMOKE_GUILD_ID?.trim() || null,
    invokerAuthority: 'admin',
    invokerIsAdmin: true,
    invokerCanModerate: true,
    activeToolNames: ['runtime_execute_code'],
    currentTurn: {
      invokerUserId: process.env.SAGE_BRIDGE_SMOKE_USER_ID?.trim() || 'bridge-smoke-user',
      invokerDisplayName: 'Bridge Smoke',
      messageId: 'bridge-smoke-message',
      guildId: process.env.SAGE_BRIDGE_SMOKE_GUILD_ID?.trim() || null,
      originChannelId: process.env.SAGE_BRIDGE_SMOKE_CHANNEL_ID?.trim() || 'bridge-smoke-channel',
      responseChannelId: process.env.SAGE_BRIDGE_SMOKE_CHANNEL_ID?.trim() || 'bridge-smoke-channel',
      invokedBy: 'component',
      mentionedUserIds: [],
      isDirectReply: false,
      replyTargetMessageId: null,
      replyTargetAuthorId: null,
      botUserId: 'sage-bot',
    },
  };
}

function seedSmokeEnvDefaults(): void {
  dotenv.config({ quiet: true });

  const defaults = {
    LANGSMITH_TRACING: 'false',
    SAGE_TRACE_DB_ENABLED: 'true',
    AI_PROVIDER_BASE_URL: 'https://example.invalid/v1',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'smoke-main',
    AI_PROVIDER_PROFILE_AGENT_MODEL: 'smoke-profile',
    AI_PROVIDER_SUMMARY_AGENT_MODEL: 'smoke-summary',
    IMAGE_PROVIDER_BASE_URL: 'https://example.invalid/image',
    IMAGE_PROVIDER_MODEL: 'smoke-image',
    SERVER_PROVIDER_PROFILE_URL: 'https://example.invalid/profile',
    SERVER_PROVIDER_AUTHORIZE_URL: 'https://example.invalid/authorize',
    SERVER_PROVIDER_DASHBOARD_URL: 'https://example.invalid/dashboard',
  } as const;

  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }
}

async function runCode(ctx: ToolExecutionContext, code: string) {
  const [{ executeValidatedRuntimeTool }, { runtimeExecuteCodeTool }] = await Promise.all([
    import('../features/agent-runtime/runtimeToolContract'),
    import('../features/code-mode/tool'),
  ]);
  const result = await executeValidatedRuntimeTool(
    runtimeExecuteCodeTool,
    {
      name: runtimeExecuteCodeTool.name,
      args: {
        language: 'javascript',
        code,
      },
    },
    ctx,
  );
  if (!result.success) {
    const hint = result.errorDetails?.hint ? ` hint=${result.errorDetails.hint}` : '';
    throw new Error(`${result.error}${hint}`);
  }
  return result.result.structuredContent;
}

function buildSmokeChecks(ctx: ToolExecutionContext): SmokeCheck[] {
  const historyChannelId = process.env.SAGE_BRIDGE_SMOKE_CHANNEL_ID?.trim();
  const checks: SmokeCheck[] = [
    {
      name: 'bridge.capabilities',
      optional: false,
      run: async () => {
        const result = await runCode(ctx, 'return await admin.runtime.getCapabilities();');
        return summarizeResult(result);
      },
    },
    {
      name: 'bridge.workspace',
      optional: false,
      run: async () => {
        const result = await runCode(
          ctx,
          `
            await workspace.write({ path: 'smoke/note.txt', content: 'bridge smoke' });
            const reread = await workspace.read('smoke/note.txt');
            const listing = await workspace.list('smoke');
            return { reread, listing };
          `,
        );
        return summarizeResult(result);
      },
    },
    {
      name: 'bridge.http',
      optional: false,
      run: async () => {
        const url = process.env.SAGE_BRIDGE_SMOKE_URL?.trim() || 'http://example.com';
        const result = await runCode(ctx, `return await http.fetch({ url: ${JSON.stringify(url)} });`);
        return summarizeResult(result);
      },
    },
  ];

  checks.push({
    name: 'bridge.history',
    optional: !historyChannelId,
    run: async () => {
      if (!historyChannelId) {
        throw new Error('Set SAGE_BRIDGE_SMOKE_CHANNEL_ID to run history smoke.');
      }
      const result = await runCode(
        ctx,
        `return await history.recent({ channelId: ${JSON.stringify(historyChannelId)}, limit: 1 });`,
      );
      return summarizeResult(result);
    },
  });

  return checks;
}

async function runCheck(check: SmokeCheck): Promise<{ passed: boolean; optional: boolean }> {
  const startedAt = Date.now();
  try {
    const detail = await check.run();
    console.log(`[PASS] ${check.name} (${Date.now() - startedAt}ms) ${detail}`);
    return { passed: true, optional: check.optional };
  } catch (error) {
    const label = check.optional ? 'WARN' : 'FAIL';
    console.log(`[${label}] ${check.name} (${Date.now() - startedAt}ms) ${errorText(error)}`);
    return { passed: false, optional: check.optional };
  }
}

async function main(): Promise<void> {
  seedSmokeEnvDefaults();
  const ctx = buildSmokeContext();
  const checks = buildSmokeChecks(ctx);

  console.log('Sage bridge-native smoke starting...');
  const outcomes = [];
  for (const check of checks) {
    outcomes.push(await runCheck(check));
  }

  const requiredFailures = outcomes.filter((entry) => !entry.passed && !entry.optional).length;
  const optionalFailures = outcomes.filter((entry) => !entry.passed && entry.optional).length;
  console.log(
    `Completed ${checks.length} checks. requiredFailures=${requiredFailures} optionalFailures=${optionalFailures}`,
  );
  if (requiredFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Bridge smoke script failed: ${errorText(error)}`);
  process.exit(1);
});

/* eslint-disable no-console */

import { runtimeExecuteCodeTool } from '../features/code-mode/tool';
import type { ToolExecutionContext } from '../features/agent-runtime/runtimeToolContract';
import { executeValidatedRuntimeTool } from '../features/agent-runtime/runtimeToolContract';

type SmokeCheck = {
  name: string;
  optional: boolean;
  run: () => Promise<string>;
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildSmokeContext(): ToolExecutionContext {
  return {
    traceId: 'tool-smoke',
    userId: 'tool-smoke',
    channelId: 'tool-smoke',
    apiKey: process.env.AI_PROVIDER_API_KEY,
  };
}

function summarizeSmokeResult(result: unknown): string {
  const envelope =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;

  const record =
    envelope &&
      typeof envelope.structuredContent === 'object' &&
      envelope.structuredContent &&
      !Array.isArray(envelope.structuredContent)
      ? (envelope.structuredContent as Record<string, unknown>)
      : envelope;

  if (!record) {
    return `resultType=${typeof result}`;
  }

  return `keys=${Object.keys(record).slice(0, 5).join(',') || 'none'}`;
}

function buildSmokeChecks(ctx: ToolExecutionContext): SmokeCheck[] {
  const spec = runtimeExecuteCodeTool;
  if (!spec.smoke || spec.smoke.mode === 'skip') {
    return [];
  }

  return [{
    name: spec.name,
    optional: spec.smoke.mode === 'optional',
    run: async () => {
      const result = await executeValidatedRuntimeTool(
        runtimeExecuteCodeTool,
        {
          name: spec.name,
          args: spec.smoke?.args ?? {},
        },
        ctx,
      );
      if (!result.success) {
        const hint = result.errorDetails?.hint ? ` hint=${result.errorDetails.hint}` : '';
        throw new Error(`${result.error}${hint}`);
      }
      return summarizeSmokeResult(result.result);
    },
  }];
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
  const ctx = buildSmokeContext();
  const checks = buildSmokeChecks(ctx);
  const skipped = runtimeExecuteCodeTool.smoke?.mode === 'skip' ? [runtimeExecuteCodeTool] : [];

  console.log('Sage runtime surface smoke starting...');
  for (const spec of skipped) {
    console.log(`[SKIP] ${spec.name} ${spec.smoke?.reason ?? 'No smoke runner configured.'}`);
  }

  const outcomes = [];
  for (const check of checks) {
    outcomes.push(await runCheck(check));
  }

  const requiredFailures = outcomes.filter((entry) => !entry.passed && !entry.optional).length;
  const optionalFailures = outcomes.filter((entry) => !entry.passed && entry.optional).length;
  console.log(
    `Completed ${checks.length} checks. requiredFailures=${requiredFailures} optionalFailures=${optionalFailures} skipped=${skipped.length}`,
  );
  if (checks.length === 0) {
    console.log('No direct smoke probes are configured because Sage now ships a single bridge-native runtime surface.');
  }
  if (requiredFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Tool smoke script failed: ${errorText(error)}`);
  process.exit(1);
});

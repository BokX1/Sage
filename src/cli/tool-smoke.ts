/* eslint-disable no-console */

import { registerDefaultAgenticTools } from '../features/agent-runtime/defaultTools';
import type { ToolExecutionContext } from '../features/agent-runtime/toolRegistry';
import { ToolRegistry } from '../features/agent-runtime/toolRegistry';
import {
  listSmokeToolDocs,
  listTopLevelToolDocs,
  type TopLevelToolDoc,
} from '../features/agent-runtime/toolDocs';

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
    apiKey: process.env.LLM_API_KEY,
  };
}

function summarizeSmokeResult(toolName: string, result: unknown): string {
  const record =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;

  if (!record) {
    return `resultType=${typeof result}`;
  }

  switch (toolName) {
    case 'system_time':
      return `isoUtc=${String(record.isoUtc ?? 'n/a')}`;
    case 'system_tool_stats': {
      const tools = Array.isArray(record.tools) ? record.tools.length : 0;
      return `scope=${String(record.scope ?? 'unknown')} tools=${tools}`;
    }
    case 'web': {
      const provider = String(record.provider ?? 'unknown');
      const sourcesRead = typeof record.sourcesRead === 'number' ? record.sourcesRead : 0;
      const results = Array.isArray(record.results) ? record.results.length : 0;
      return `provider=${provider} results=${results} sourcesRead=${sourcesRead}`;
    }
    case 'github':
      return `fullName=${String(record.fullName ?? record.repo ?? 'unknown')}`;
    case 'workflow':
      return `repo=${String(record.githubRepo ?? 'unknown')} action=${String(record.action ?? 'unknown')}`;
    case 'npm_info':
      return `package=${String(record.packageName ?? 'unknown')} latest=${String(record.latestVersion ?? record.version ?? 'n/a')}`;
    case 'wikipedia_search': {
      const count = Array.isArray(record.results) ? record.results.length : 0;
      return `results=${count}`;
    }
    case 'stack_overflow_search': {
      const count = Array.isArray(record.results) ? record.results.length : 0;
      return `results=${count}`;
    }
    case 'image_generate': {
      const attachments = Array.isArray(record.attachments) ? record.attachments.length : 0;
      return `provider=${String(record.provider ?? 'unknown')} attachments=${attachments}`;
    }
    default:
      return `keys=${Object.keys(record).slice(0, 5).join(',') || 'none'}`;
  }
}

function buildSmokeChecks(registry: ToolRegistry, ctx: ToolExecutionContext): SmokeCheck[] {
  return listSmokeToolDocs().map((doc: TopLevelToolDoc) => ({
    name: doc.tool,
    optional: doc.smoke.mode === 'optional',
    run: async () => {
      const result = await registry.executeValidated(
        {
          name: doc.tool,
          args: doc.smoke.args ?? {},
        },
        ctx,
      );
      if (!result.success) {
        const hint = result.errorDetails?.hint ? ` hint=${result.errorDetails.hint}` : '';
        throw new Error(`${result.error}${hint}`);
      }
      return summarizeSmokeResult(doc.tool, result.result);
    },
  }));
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
  const registry = new ToolRegistry();
  registerDefaultAgenticTools(registry);

  const ctx = buildSmokeContext();
  const checks = buildSmokeChecks(registry, ctx);
  const skipped = listTopLevelToolDocs().filter((doc) => doc.smoke.mode === 'skip');

  console.log('Sage tool smoke checks starting...');
  for (const doc of skipped) {
    console.log(`[SKIP] ${doc.tool} ${doc.smoke.reason ?? 'No smoke runner configured.'}`);
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
  if (requiredFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Tool smoke script failed: ${errorText(error)}`);
  process.exit(1);
});

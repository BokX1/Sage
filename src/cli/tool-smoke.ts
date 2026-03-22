/* eslint-disable no-console */

import { registerDefaultAgenticTools } from '../features/agent-runtime/defaultTools';
import type { ToolExecutionContext } from '../features/agent-runtime/toolRegistry';
import { ToolRegistry } from '../features/agent-runtime/toolRegistry';

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

function summarizeSmokeResult(toolName: string, result: unknown): string {
  const envelope =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;

  const record =
    envelope && typeof envelope.structuredContent === 'object' && envelope.structuredContent && !Array.isArray(envelope.structuredContent)
      ? (envelope.structuredContent as Record<string, unknown>)
      : envelope;

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
    case 'web_search':
    case 'web_read':
    case 'web_read_page': {
      const provider = String(record.provider ?? 'unknown');
      const sourcesRead = typeof record.sourcesRead === 'number' ? record.sourcesRead : 0;
      const results = Array.isArray(record.results) ? record.results.length : 0;
      return `provider=${provider} results=${results} sourcesRead=${sourcesRead}`;
    }
    case 'npm_info':
      return `package=${String(record.packageName ?? 'unknown')} latest=${String(record.latestVersion ?? record.version ?? 'n/a')}`;
    case 'docs_lookup':
      return `libraryId=${String(record.libraryId ?? 'unknown')}`;
    case 'repo_search_code':
    case 'repo_read_file':
    case 'repo_get_repository':
    case 'repo_search_issues':
    case 'repo_search_pull_requests':
      return `provider=repo keys=${Object.keys(record).slice(0, 5).join(',') || 'none'}`;
    case 'browser_open_page':
    case 'browser_read_page':
    case 'browser_click':
    case 'browser_type':
    case 'browser_capture':
    case 'browser_extract':
      return `provider=browser keys=${Object.keys(record).slice(0, 5).join(',') || 'none'}`;
    case 'image_generate': {
      const artifacts = Array.isArray(envelope?.artifacts) ? envelope.artifacts.length : 0;
      return `provider=${String(record.provider ?? 'unknown')} artifacts=${artifacts}`;
    }
    default:
      return `keys=${Object.keys(record).slice(0, 5).join(',') || 'none'}`;
  }
}

function buildSmokeChecks(registry: ToolRegistry, ctx: ToolExecutionContext): SmokeCheck[] {
  return registry.listSpecs()
    .filter((spec) => spec.runtime.class !== 'runtime')
    .filter((spec) => spec.smoke?.mode && spec.smoke.mode !== 'skip')
    .map((spec) => ({
      name: spec.name,
      optional: spec.smoke?.mode === 'optional',
      run: async () => {
        const result = await registry.executeValidated(
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
        return summarizeSmokeResult(spec.name, result.result);
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
  await registerDefaultAgenticTools(registry);

  const ctx = buildSmokeContext();
  const checks = buildSmokeChecks(registry, ctx);
  const skipped = registry.listSpecs().filter((spec) => spec.smoke?.mode === 'skip');

  console.log('Sage tool smoke checks starting...');
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
  if (requiredFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Tool smoke script failed: ${errorText(error)}`);
  process.exit(1);
});

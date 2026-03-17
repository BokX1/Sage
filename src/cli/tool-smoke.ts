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
    case 'web_read_page':
    case 'web_extract':
    case 'web_research': {
      const provider = String(record.provider ?? 'unknown');
      const sourcesRead = typeof record.sourcesRead === 'number' ? record.sourcesRead : 0;
      const results = Array.isArray(record.results) ? record.results.length : 0;
      return `provider=${provider} results=${results} sourcesRead=${sourcesRead}`;
    }
    case 'github_get_repo':
      return `fullName=${String(record.fullName ?? record.repo ?? 'unknown')}`;
    case 'github_search_code':
    case 'github_search_issues':
    case 'github_search_pull_requests': {
      const results = Array.isArray(record.results) ? record.results.length : 0;
      return `results=${results}`;
    }
    case 'github_get_file':
    case 'github_get_file_ranges':
    case 'github_get_file_snippet':
    case 'github_page_file':
      return `path=${String(record.path ?? 'unknown')}`;
    case 'github_list_commits': {
      const commits = Array.isArray(record.commits) ? record.commits.length : 0;
      return `commits=${commits}`;
    }
    case 'workflow_npm_github_code_search':
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
  registerDefaultAgenticTools(registry);

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

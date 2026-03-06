/* eslint-disable no-console */

import {
  lookupGitHubRepo,
  lookupNpmPackage,
  lookupWikipedia,
  runWebSearch,
  scrapeWebPage,
  searchStackOverflow,
} from '../features/agent-runtime/toolIntegrations';

type SmokeCheck = {
  name: string;
  optional?: boolean;
  run: () => Promise<string>;
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runCheck(check: SmokeCheck): Promise<{ passed: boolean; optional: boolean }> {
  const startedAt = Date.now();
  try {
    const detail = await check.run();
    console.log(`[PASS] ${check.name} (${Date.now() - startedAt}ms) ${detail}`);
    return { passed: true, optional: !!check.optional };
  } catch (error) {
    const label = check.optional ? 'WARN' : 'FAIL';
    console.log(`[${label}] ${check.name} (${Date.now() - startedAt}ms) ${errorText(error)}`);
    return { passed: false, optional: !!check.optional };
  }
}

async function main(): Promise<void> {
  const checks: SmokeCheck[] = [
    {
      name: 'web.search',
      run: async () => {
        const result = await runWebSearch({
          query: 'latest OpenAI release notes',
          depth: 'balanced',
          maxResults: 4,
        });
        const provider = String(result.provider ?? 'unknown');
        const count = Array.isArray(result.results) ? result.results.length : 0;
        return `provider=${provider} results=${count}`;
      },
    },
    {
      name: 'web.read',
      run: async () => {
        const result = await scrapeWebPage({
          url: 'https://example.com',
          maxChars: 2_000,
        });
        const provider = String(result.provider ?? 'unknown');
        const chars = typeof result.content === 'string' ? result.content.length : 0;
        return `provider=${provider} contentChars=${chars}`;
      },
    },
    {
      name: 'wikipedia_search',
      run: async () => {
        const result = await lookupWikipedia({
          query: 'OpenAI',
          maxResults: 3,
        });
        const count = Array.isArray(result.results) ? result.results.length : 0;
        return `results=${count}`;
      },
    },
    {
      name: 'github.repo.get',
      run: async () => {
        const result = await lookupGitHubRepo({
          repo: 'openai/openai-node',
          includeReadme: false,
        });
        return `fullName=${String(result.fullName ?? 'unknown')} stars=${String(result.stars ?? 'n/a')}`;
      },
    },
    {
      name: 'npm_info',
      run: async () => {
        const result = await lookupNpmPackage({
          packageName: 'zod',
        });
        return `package=${String(result.packageName ?? 'unknown')} latest=${String(result.latestVersion ?? result.version ?? 'n/a')}`;
      },
    },
    {
      name: 'stack_overflow_search',
      run: async () => {
        const result = await searchStackOverflow({
          query: 'TypeScript zod schema parse error',
          maxResults: 3,
          tagged: 'typescript',
        });
        const count = Array.isArray(result.results) ? result.results.length : 0;
        return `results=${count}`;
      },
    },
  ];

  console.log('Sage tool smoke checks starting...');
  const outcomes = await Promise.all(checks.map((check) => runCheck(check)));
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
  console.error(`Tool smoke script failed: ${errorText(error)}`);
  process.exit(1);
});

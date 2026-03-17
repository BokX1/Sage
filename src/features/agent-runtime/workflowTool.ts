import { z } from 'zod';
import { lookupGitHubCodeSearch, lookupNpmPackage } from './toolIntegrations';
import { ToolDetailedError } from './toolErrors';
import { defineToolSpecV2 } from './toolRegistry';

const npmGitHubCodeSearchInput = z.object({
  packageName: z.string().trim().min(1).max(214).describe('The exact npm package name.'),
  version: z.string().trim().min(1).max(80).optional(),
  query: z.string().trim().min(2).max(300).describe('Search query for GitHub code search.'),
  ref: z.string().trim().min(1).max(120).optional(),
  regex: z.string().trim().min(1).max(500).optional(),
  pathFilter: z.string().trim().min(1).max(300).optional(),
  maxCandidates: z.number().int().min(1).max(100).optional(),
  maxFilesToScan: z.number().int().min(1).max(100).optional(),
  maxMatches: z.number().int().min(1).max(1_000).optional(),
  includeTextMatches: z.boolean().optional(),
});

export const workflowNpmGitHubCodeSearchTool = defineToolSpecV2({
  name: 'workflow_npm_github_code_search',
  title: 'Workflow npm -> GitHub code search',
  description: 'Resolve an npm package to its GitHub repository and run one code search there.',
  input: npmGitHubCodeSearchInput,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    parallelSafe: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'large',
    capabilityTags: ['workflow', 'developer', 'github', 'npm'],
  },
  prompt: {
    summary: 'Use when you want one bounded multi-hop developer lookup instead of chaining npm and GitHub manually.',
  },
  smoke: {
    mode: 'optional',
    args: { packageName: 'openai', query: 'OpenAI', maxCandidates: 5 },
  },
  validationHint: 'Use this only when the package should resolve to a GitHub repository and you already know the code-search query.',
  execute: async (args, ctx) => {
    const npmInfo = await lookupNpmPackage({
      packageName: args.packageName,
      version: args.version,
      signal: ctx.signal,
    });

    const githubRepo = typeof npmInfo.githubRepo === 'string' ? npmInfo.githubRepo.trim() : '';
    if (!githubRepo) {
      throw new ToolDetailedError(
        `npm package "${args.packageName}" does not expose a GitHub repository URL.`,
        { category: 'not_found', provider: 'npm' },
      );
    }

    const code = await lookupGitHubCodeSearch({
      repo: githubRepo,
      query: args.query,
      ref: args.ref,
      regex: args.regex,
      pathFilter: args.pathFilter,
      maxCandidates: args.maxCandidates,
      maxFilesToScan: args.maxFilesToScan,
      maxMatches: args.maxMatches,
      includeTextMatches: args.includeTextMatches,
      traceId: ctx.traceId,
      signal: ctx.signal,
    });

    return {
      structuredContent: {
        packageName: args.packageName,
        versionRequested: args.version ?? null,
        githubRepo,
        npm: npmInfo,
        github: code,
      },
      modelSummary: JSON.stringify({
        packageName: args.packageName,
        githubRepo,
      }),
    };
  },
});

export const workflowTools = [
  workflowNpmGitHubCodeSearchTool,
];

import { z } from 'zod';
import type { ToolDefinition } from './toolRegistry';
import { lookupGitHubCodeSearch, lookupNpmPackage } from './toolIntegrations';
import { ToolDetailedError } from './toolErrors';

const thinkField = z
  .string()
  .describe(
    'Optional internal reasoning explaining why you are generating this payload and how it fulfills the active goal.',
  )
  .optional();

const workflowToolSchema = z.discriminatedUnion('action', [
  z.object({
    think: thinkField,
    action: z.literal('help').describe('Show available workflow actions and example payloads.'),
    includeExamples: z.boolean().optional().describe('If true, include example payloads for each workflow action.'),
  }),

  z.object({
    think: thinkField,
    action: z
      .literal('npm.github_code_search')
      .describe('One-shot: npm_info -> resolve githubRepo -> github code.search (reduces multi-hop chains).'),
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
  }),
]);

export const workflowTool: ToolDefinition<z.infer<typeof workflowToolSchema>> = {
  name: 'workflow',
  description:
    [
      'Composable workflow tool that chains common multi-hop operations into one call.',
      'Actions:',
      '- help: show action index and example payloads',
      '- npm.github_code_search: fetch npm metadata and run GitHub code search on its repository',
      '<USE_ONLY_WHEN> You want to reduce multi-hop tool chains and latency. </USE_ONLY_WHEN>',
    ].join('\n'),
  schema: workflowToolSchema,
  metadata: { readOnly: true },
  execute: async (args, ctx) => {
    switch (args.action) {
      case 'help': {
        const includeExamples = args.includeExamples !== false;
        return {
          tool: 'workflow',
          actions: ['npm.github_code_search'],
          notes: [
            'Workflows are one-shot helpers that reduce multi-hop chains (latency + failure points).',
            'If an npm package does not expose a GitHub repository, npm.github_code_search will fail with not_found.',
            'The think field is optional; omit it to reduce tool-call verbosity.',
          ],
          examples: includeExamples
            ? {
                'npm.github_code_search': {
                  think: 'Locate a symbol in a package repo without manual npm → GitHub parsing.',
                  action: 'npm.github_code_search',
                  packageName: 'zod',
                  query: 'safeParse',
                  includeTextMatches: true,
                },
              }
            : undefined,
        };
      }

      case 'npm.github_code_search': {
        const npmInfo = await lookupNpmPackage({
          packageName: args.packageName,
          version: args.version,
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
        });

        return {
          action: args.action,
          packageName: args.packageName,
          versionRequested: args.version ?? null,
          githubRepo,
          npm: npmInfo,
          github: code,
          guidance:
            'Use github action file.get / file.snippet / file.ranges to fetch exact code for any returned match path(s).',
        };
      }
    }
  },
};

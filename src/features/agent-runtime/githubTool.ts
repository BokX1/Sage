import { z } from 'zod';
import type { ToolDefinition } from './toolRegistry';
import {
  lookupGitHubRepo,
  lookupGitHubCodeSearch,
  lookupGitHubFile,
  searchGitHubIssuesAndPullRequests,
  listGitHubCommits,
} from './toolIntegrations';
import { buildRoutedToolHelp } from './toolDocs';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function normalizeGitHubRepoSpecifier(value: string): string | null {
  let raw = value.trim();
  if (!raw) return null;

  const shorthandCandidate = raw.split('#')[0]?.split('?')[0]?.trim().replace(/\.git$/i, '');
  if (shorthandCandidate && REPO_PATTERN.test(shorthandCandidate)) return shorthandCandidate;

  if (/^github:/i.test(raw)) {
    raw = raw.replace(/^github:/i, 'https://github.com/');
  }

  let candidate = raw.replace(/^git\+/i, '');
  if (/^git@github\.com:/i.test(candidate)) {
    candidate = candidate.replace(/^git@github\.com:/i, 'https://github.com/');
  }
  if (/^ssh:\/\/git@github\.com\//i.test(candidate)) {
    candidate = candidate.replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/');
  }
  if (/^git:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^git:\/\//i, 'https://');
  }
  candidate = candidate.replace(/\.git$/i, '');

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const hostname = parsed.hostname.trim().toLowerCase();
    if (hostname !== 'github.com' && hostname !== 'www.github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0]?.trim();
    const repo = parts[1]?.trim().replace(/\.git$/i, '');
    const normalized = `${owner}/${repo}`;
    return REPO_PATTERN.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

const githubRepoSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .refine(
    (value) => normalizeGitHubRepoSpecifier(value) !== null,
    'repo must be in owner/name format or a GitHub URL',
  )
  .describe('The repository in owner/repo format (e.g. microsoft/TypeScript) or a github.com URL to it.');

const thinkField = z
  .string()
  .describe(
    'Optional internal reasoning explaining why you are generating this payload and how it fulfills the active goal.',
  )
  .optional();

const githubFileRangeSchema = z
  .object({
    startLine: z.number().int().min(1).max(2_000_000),
    endLine: z.number().int().min(1).max(2_000_000),
  })
  .superRefine((value, ctx) => {
    if (value.endLine < value.startLine) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endLine must be greater than or equal to startLine',
        path: ['endLine'],
      });
    }
  });

const githubToolSchema = z.discriminatedUnion('action', [
  z.object({
    think: thinkField,
    action: z.literal('help').describe('Show available GitHub actions and example payloads.'),
    includeExamples: z.boolean().optional().describe('If true, include example payloads for common actions.'),
  }),

  z.object({
    think: thinkField,
    action: z.literal('repo.get').describe('Lookup GitHub repository metadata and optionally include README.'),
    repo: githubRepoSchema,
    includeReadme: z.boolean().optional(),
  }),

  z.object({
    think: thinkField,
    action: z.literal('code.search').describe('Search code across a GitHub repository.'),
    repo: githubRepoSchema,
    query: z.string().trim().min(2).max(300),
    ref: z.string().trim().min(1).max(120).optional(),
    regex: z.string().trim().min(1).max(500).optional(),
    pathFilter: z.string().trim().min(1).max(300).optional(),
    maxCandidates: z.number().int().min(1).max(100).optional(),
    maxFilesToScan: z.number().int().min(1).max(100).optional(),
    maxMatches: z.number().int().min(1).max(1_000).optional(),
    includeTextMatches: z.boolean().optional(),
  }),

  z.object({
    think: thinkField,
    action: z.literal('file.get').describe('Fetch file contents from a GitHub repo (supports line ranges for large files).'),
    repo: githubRepoSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !value.includes('..'), 'path must not contain ".." segments')
      .describe('The precise file path within the repository.'),
    ref: z.string().trim().min(1).max(120).optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
    startLine: z.number().int().min(1).max(2_000_000).optional(),
    endLine: z.number().int().min(1).max(2_000_000).optional(),
    includeLineNumbers: z.boolean().optional(),
  }).superRefine((value, ctx) => {
    const hasStart = value.startLine !== undefined;
    const hasEnd = value.endLine !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startLine and endLine must both be provided for ranged lookup',
        path: hasStart ? ['endLine'] : ['startLine'],
      });
      return;
    }
    if (hasStart && hasEnd && (value.endLine as number) < (value.startLine as number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endLine must be greater than or equal to startLine',
        path: ['endLine'],
      });
    }
  }),

  z.object({
    think: thinkField,
    action: z.literal('file.page').describe('Read a file in pages to avoid all-or-nothing large outputs.'),
    repo: githubRepoSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !value.includes('..'), 'path must not contain ".." segments')
      .describe('The precise file path within the repository.'),
    ref: z.string().trim().min(1).max(120).optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
    startLine: z.number().int().min(1).max(2_000_000).optional(),
    maxLines: z.number().int().min(1).max(800).optional(),
    includeLineNumbers: z.boolean().optional(),
  }),

  z.object({
    think: thinkField,
    action: z.literal('file.ranges').describe('Fetch multiple disjoint line ranges from a file in one call.'),
    repo: githubRepoSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !value.includes('..'), 'path must not contain ".." segments')
      .describe('The precise file path within the repository.'),
    ref: z.string().trim().min(1).max(120).optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
    ranges: z.array(githubFileRangeSchema).min(1).max(6),
    includeLineNumbers: z.boolean().optional(),
  }),

  z.object({
    think: thinkField,
    action: z.literal('file.snippet').describe('Fetch a tight code snippet around a line number.'),
    repo: githubRepoSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !value.includes('..'), 'path must not contain ".." segments')
      .describe('The precise file path within the repository.'),
    ref: z.string().trim().min(1).max(120).optional(),
    lineNumber: z.number().int().min(1).max(2_000_000),
    before: z.number().int().min(0).max(200).optional(),
    after: z.number().int().min(0).max(200).optional(),
    maxChars: z.number().int().min(500).max(50_000).optional(),
    includeLineNumbers: z.boolean().optional(),
  }),

  z.object({
    think: thinkField,
    action: z.literal('issues.search').describe('Search issues in a GitHub repository.'),
    repo: githubRepoSchema,
    query: z.string().trim().min(2).max(350),
    state: z.enum(['open', 'closed', 'all']).optional(),
    maxResults: z.number().int().min(1).max(20).optional(),
  }),

  z.object({
    think: thinkField,
    action: z.literal('prs.search').describe('Search pull requests in a GitHub repository.'),
    repo: githubRepoSchema,
    query: z.string().trim().min(2).max(350),
    state: z.enum(['open', 'closed', 'all']).optional(),
    maxResults: z.number().int().min(1).max(20).optional(),
  }),

  z.object({
    think: thinkField,
    action: z.literal('commits.list').describe('List recent commits for a repo/ref (optionally scoped to a path).'),
    repo: githubRepoSchema,
    ref: z.string().trim().min(1).max(120).optional(),
    path: z.string().trim().min(1).max(500).optional(),
    sinceIso: z.string().trim().min(1).max(80).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  }),
]);

export const githubTool: ToolDefinition<z.infer<typeof githubToolSchema>> = {
  name: 'github',
  description:
    [
      'Unified GitHub tool with action-based calls.',
      'Actions:',
      '- help: show action index and example payloads',
      '- repo.get: repo metadata (+ optional README)',
      '- code.search: search across files (includes match previews when available)',
      '- file.get: read file (supports line ranges)',
      '- file.page: paged reads for large files',
      '- file.ranges: fetch multiple disjoint ranges in one call',
      '- file.snippet: tight snippet around a line number',
      '- issues.search / prs.search: search issues or pull requests',
      '- commits.list: list recent commits/activity',
      '<USE_ONLY_WHEN> You need grounded data from GitHub. </USE_ONLY_WHEN>',
    ].join('\n'),
  schema: githubToolSchema,
  metadata: { readOnly: true },
  execute: async (args, ctx) => {
    if (args.action === 'help') {
      return buildRoutedToolHelp('github', {
        includeExamples: args.includeExamples !== false,
      });
    }

    const repo = normalizeGitHubRepoSpecifier(args.repo);
    if (!repo) {
      throw new Error('repo must be in owner/repo format or a github.com URL.');
    }

    switch (args.action) {
      case 'repo.get': {
        return lookupGitHubRepo({
          repo,
          includeReadme: args.includeReadme,
          signal: ctx.signal,
        });
      }

      case 'code.search': {
        return lookupGitHubCodeSearch({
          repo,
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
      }

      case 'file.get': {
        return lookupGitHubFile({
          repo,
          path: args.path,
          ref: args.ref,
          maxChars: args.maxChars,
          startLine: args.startLine,
          endLine: args.endLine,
          includeLineNumbers: args.includeLineNumbers,
          traceId: ctx.traceId,
          signal: ctx.signal,
        });
      }

      case 'file.page': {
        const startLine = args.startLine ?? 1;
        const maxLines = args.maxLines ?? 200;
        const endLine = startLine + Math.max(0, maxLines - 1);
        const page = await lookupGitHubFile({
          repo,
          path: args.path,
          ref: args.ref,
          maxChars: args.maxChars,
          startLine,
          endLine,
          includeLineNumbers: args.includeLineNumbers ?? true,
          traceId: ctx.traceId,
          signal: ctx.signal,
        });

        const record = page && typeof page === 'object' && !Array.isArray(page)
          ? (page as Record<string, unknown>)
          : {};
        const nextStartLine =
          record.hasMoreAfter === true && typeof record.lineEnd === 'number'
            ? (record.lineEnd as number) + 1
            : null;

        return {
          ...page,
          pageStartLine: startLine,
          pageMaxLines: maxLines,
          nextStartLine,
        };
      }

      case 'file.ranges': {
        const ranges = args.ranges.map((range) => ({
          startLine: range.startLine,
          endLine: range.endLine,
        }));
        const reads = [];
        for (const range of ranges) {
          const chunk = await lookupGitHubFile({
            repo,
            path: args.path,
            ref: args.ref,
            maxChars: args.maxChars,
            startLine: range.startLine,
            endLine: range.endLine,
            includeLineNumbers: args.includeLineNumbers ?? true,
            traceId: ctx.traceId,
            signal: ctx.signal,
          });
          reads.push({ range, ...chunk });
        }
        return {
          repo,
          path: args.path,
          ref: args.ref?.trim() || null,
          rangeCount: ranges.length,
          ranges,
          reads,
        };
      }

      case 'file.snippet': {
        const before = args.before ?? 10;
        const after = args.after ?? 10;
        const startLine = Math.max(1, args.lineNumber - before);
        const endLine = Math.max(startLine, args.lineNumber + after);
        return lookupGitHubFile({
          repo,
          path: args.path,
          ref: args.ref,
          maxChars: args.maxChars,
          startLine,
          endLine,
          includeLineNumbers: args.includeLineNumbers ?? true,
          traceId: ctx.traceId,
          signal: ctx.signal,
        });
      }

      case 'issues.search': {
        return searchGitHubIssuesAndPullRequests({
          repo,
          query: args.query,
          type: 'issue',
          state: args.state,
          maxResults: args.maxResults,
          signal: ctx.signal,
        });
      }

      case 'prs.search': {
        return searchGitHubIssuesAndPullRequests({
          repo,
          query: args.query,
          type: 'pr',
          state: args.state,
          maxResults: args.maxResults,
          signal: ctx.signal,
        });
      }

      case 'commits.list': {
        return listGitHubCommits({
          repo,
          ref: args.ref,
          path: args.path,
          sinceIso: args.sinceIso,
          limit: args.limit,
          signal: ctx.signal,
        });
      }
    }
  },
};

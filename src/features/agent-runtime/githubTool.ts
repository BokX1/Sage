import { z } from 'zod';
import { defineToolSpecV2, type ToolRuntimeMetadata, type ToolSpecV2 } from './toolRegistry';
import {
  listGitHubCommits,
  lookupGitHubCodeSearch,
  lookupGitHubFile,
  lookupGitHubRepo,
  searchGitHubIssuesAndPullRequests,
} from './toolIntegrations';

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
  .describe('The repository in owner/repo format or a github.com URL to it.');

const githubPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.includes('..'), 'path must not contain ".." segments');

const githubFileRangeSchema = z.object({
  startLine: z.number().int().min(1).max(2_000_000),
  endLine: z.number().int().min(1).max(2_000_000),
}).superRefine((value, ctx) => {
  if (value.endLine < value.startLine) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endLine must be greater than or equal to startLine',
      path: ['endLine'],
    });
  }
});

const githubGetRepoInput = z.object({
  repo: githubRepoSchema,
  includeReadme: z.boolean().optional(),
});

const githubSearchCodeInput = z.object({
  repo: githubRepoSchema,
  query: z.string().trim().min(2).max(300),
  ref: z.string().trim().min(1).max(120).optional(),
  regex: z.string().trim().min(1).max(500).optional(),
  pathFilter: z.string().trim().min(1).max(300).optional(),
  maxCandidates: z.number().int().min(1).max(100).optional(),
  maxFilesToScan: z.number().int().min(1).max(100).optional(),
  maxMatches: z.number().int().min(1).max(1_000).optional(),
  includeTextMatches: z.boolean().optional(),
});

const githubGetFileInput = z.object({
  repo: githubRepoSchema,
  path: githubPathSchema.describe('The precise file path within the repository.'),
  ref: z.string().trim().min(1).max(120).optional(),
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
});

const githubPageFileInput = z.object({
  repo: githubRepoSchema,
  path: githubPathSchema.describe('The precise file path within the repository.'),
  ref: z.string().trim().min(1).max(120).optional(),
  startLine: z.number().int().min(1).max(2_000_000).optional(),
  maxLines: z.number().int().min(1).max(800).optional(),
  includeLineNumbers: z.boolean().optional(),
});

const githubGetFileRangesInput = z.object({
  repo: githubRepoSchema,
  path: githubPathSchema.describe('The precise file path within the repository.'),
  ref: z.string().trim().min(1).max(120).optional(),
  ranges: z.array(githubFileRangeSchema).min(1).max(6),
  includeLineNumbers: z.boolean().optional(),
});

const githubGetFileSnippetInput = z.object({
  repo: githubRepoSchema,
  path: githubPathSchema.describe('The precise file path within the repository.'),
  ref: z.string().trim().min(1).max(120).optional(),
  lineNumber: z.number().int().min(1).max(2_000_000),
  before: z.number().int().min(0).max(200).optional(),
  after: z.number().int().min(0).max(200).optional(),
  includeLineNumbers: z.boolean().optional(),
});

const githubSearchIssuesInput = z.object({
  repo: githubRepoSchema,
  query: z.string().trim().min(2).max(350),
  state: z.enum(['open', 'closed', 'all']).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
});

const githubSearchPrsInput = z.object({
  repo: githubRepoSchema,
  query: z.string().trim().min(2).max(350),
  state: z.enum(['open', 'closed', 'all']).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
});

const githubListCommitsInput = z.object({
  repo: githubRepoSchema,
  ref: z.string().trim().min(1).max(120).optional(),
  path: z.string().trim().min(1).max(500).optional(),
  sinceIso: z.string().trim().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

function repoOrThrow(repo: string): string {
  const normalized = normalizeGitHubRepoSpecifier(repo);
  if (!normalized) {
    throw new Error('repo must be in owner/repo format or a github.com URL.');
  }
  return normalized;
}

function githubSpec<TArgs>(params: Omit<Parameters<typeof defineToolSpecV2<TArgs>>[0], 'runtime'> & {
  runtime?: Partial<ToolRuntimeMetadata<TArgs>>;
}): ToolSpecV2<TArgs> {
  const runtime: ToolRuntimeMetadata<TArgs> = {
    class: 'query',
    readOnly: true,
    observationPolicy: 'large',
    capabilityTags: ['github', 'developer'],
    ...(params.runtime ?? {}),
  };
  return defineToolSpecV2({
    ...params,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      parallelSafe: true,
      ...(params.annotations ?? {}),
    },
    runtime,
  });
}

export const githubGetRepoTool = githubSpec({
  name: 'github_get_repo',
  title: 'GitHub Get Repo',
  description: 'Fetch GitHub repository metadata and optionally include the README.',
  input: githubGetRepoInput,
  prompt: {
    summary: 'Use for repository identity, metadata, README, and links.',
  },
  smoke: {
    mode: 'optional',
    args: { repo: 'openai/openai-node', includeReadme: false },
  },
  validationHint: 'Pass one repo in owner/name form or a GitHub URL.',
  execute: async (args, ctx) => lookupGitHubRepo({
    repo: repoOrThrow(args.repo),
    includeReadme: args.includeReadme,
    signal: ctx.signal,
  }),
});

export const githubSearchCodeTool = githubSpec({
  name: 'github_search_code',
  title: 'GitHub Search Code',
  description: 'Search code across one GitHub repository.',
  input: githubSearchCodeInput,
  prompt: {
    summary: 'Use for code discovery before fetching exact files or snippets.',
  },
  smoke: {
    mode: 'optional',
    args: { repo: 'openai/openai-node', query: 'chat.completions.create', maxCandidates: 5 },
  },
  execute: async (args, ctx) => lookupGitHubCodeSearch({
    repo: repoOrThrow(args.repo),
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
  }),
});

export const githubGetFileTool = githubSpec({
  name: 'github_get_file',
  title: 'GitHub Get File',
  description: 'Fetch one GitHub file, optionally with a bounded line range.',
  input: githubGetFileInput,
  prompt: {
    summary: 'Use when you already know the exact file path and need the real source.',
  },
  smoke: {
    mode: 'optional',
    args: { repo: 'openai/openai-node', path: 'README.md' },
  },
  execute: async (args, ctx) => lookupGitHubFile({
    repo: repoOrThrow(args.repo),
    path: args.path,
    ref: args.ref,
    startLine: args.startLine,
    endLine: args.endLine,
    includeLineNumbers: args.includeLineNumbers,
    signal: ctx.signal,
    traceId: ctx.traceId,
  }),
});

export const githubPageFileTool = githubSpec({
  name: 'github_page_file',
  title: 'GitHub Page File',
  description: 'Read one GitHub file in bounded pages.',
  input: githubPageFileInput,
  prompt: {
    summary: 'Use when a file is too large for a one-shot read.',
  },
  smoke: {
    mode: 'skip',
    reason: 'Paging is multi-step and better covered by targeted tests.',
  },
  execute: async (args, ctx) => lookupGitHubFile({
    repo: repoOrThrow(args.repo),
    path: args.path,
    ref: args.ref,
    startLine: args.startLine,
    endLine:
      args.startLine !== undefined
        ? args.startLine + Math.max(1, args.maxLines ?? 200) - 1
        : Math.max(1, args.maxLines ?? 200),
    includeLineNumbers: args.includeLineNumbers,
    signal: ctx.signal,
    traceId: ctx.traceId,
  }),
});

export const githubGetFileRangesTool = githubSpec({
  name: 'github_get_file_ranges',
  title: 'GitHub Get File Ranges',
  description: 'Fetch multiple disjoint line ranges from one GitHub file.',
  input: githubGetFileRangesInput,
  prompt: {
    summary: 'Use when you need multiple exact regions from the same file in one call.',
  },
  smoke: {
    mode: 'skip',
    reason: 'Range reads are better validated by unit coverage.',
  },
  execute: async (args, ctx) => {
    const repo = repoOrThrow(args.repo);
    const segments = await Promise.all(
      args.ranges.map(async (range) => ({
        range,
        content: await lookupGitHubFile({
          repo,
          path: args.path,
          ref: args.ref,
          startLine: range.startLine,
          endLine: range.endLine,
          includeLineNumbers: args.includeLineNumbers,
          signal: ctx.signal,
          traceId: ctx.traceId,
        }),
      })),
    );
    return {
      repo,
      path: args.path,
      ref: args.ref ?? null,
      includeLineNumbers: args.includeLineNumbers ?? false,
      segments,
    };
  },
});

export const githubGetFileSnippetTool = githubSpec({
  name: 'github_get_file_snippet',
  title: 'GitHub Get File Snippet',
  description: 'Fetch a tight snippet around one line number in a GitHub file.',
  input: githubGetFileSnippetInput,
  prompt: {
    summary: 'Use when you need local context around one exact line.',
  },
  smoke: {
    mode: 'skip',
    reason: 'Snippet reads are better validated by unit coverage.',
  },
  execute: async (args, ctx) => lookupGitHubFile({
    repo: repoOrThrow(args.repo),
    path: args.path,
    ref: args.ref,
    startLine: Math.max(1, args.lineNumber - (args.before ?? 20)),
    endLine: Math.max(1, args.lineNumber + (args.after ?? 20)),
    includeLineNumbers: args.includeLineNumbers,
    signal: ctx.signal,
    traceId: ctx.traceId,
  }),
});

export const githubSearchIssuesTool = githubSpec({
  name: 'github_search_issues',
  title: 'GitHub Search Issues',
  description: 'Search issues in one GitHub repository.',
  input: githubSearchIssuesInput,
  prompt: {
    summary: 'Use when you need issue discussions, bug reports, or issue history inside one repository.',
  },
  smoke: {
    mode: 'optional',
    args: { repo: 'openai/openai-node', query: 'timeout', maxResults: 3 },
  },
  execute: async (args, ctx) => searchGitHubIssuesAndPullRequests({
    repo: repoOrThrow(args.repo),
    type: 'issue',
    query: args.query,
    state: args.state,
    maxResults: args.maxResults,
    signal: ctx.signal,
  }),
});

export const githubSearchPullRequestsTool = githubSpec({
  name: 'github_search_pull_requests',
  title: 'GitHub Search Pull Requests',
  description: 'Search pull requests in one GitHub repository.',
  input: githubSearchPrsInput,
  prompt: {
    summary: 'Use when you need pull request discussions, status, or merged change history inside one repository.',
  },
  smoke: {
    mode: 'optional',
    args: { repo: 'openai/openai-node', query: 'streaming', maxResults: 3 },
  },
  execute: async (args, ctx) => searchGitHubIssuesAndPullRequests({
    repo: repoOrThrow(args.repo),
    type: 'pr',
    query: args.query,
    state: args.state,
    maxResults: args.maxResults,
    signal: ctx.signal,
  }),
});

export const githubListCommitsTool = githubSpec({
  name: 'github_list_commits',
  title: 'GitHub List Commits',
  description: 'List recent commits for one GitHub repository.',
  input: githubListCommitsInput,
  prompt: {
    summary: 'Use when you need recent commit history, authorship, or file-level commit trace inside one repository.',
  },
  smoke: {
    mode: 'optional',
    args: { repo: 'openai/openai-node', limit: 3 },
  },
  execute: async (args, ctx) => listGitHubCommits({
    repo: repoOrThrow(args.repo),
    ref: args.ref,
    path: args.path,
    sinceIso: args.sinceIso,
    limit: args.limit,
    signal: ctx.signal,
  }),
});

export const githubTools = [
  githubGetRepoTool,
  githubSearchCodeTool,
  githubGetFileTool,
  githubPageFileTool,
  githubGetFileRangesTool,
  githubGetFileSnippetTool,
  githubSearchIssuesTool,
  githubSearchPullRequestsTool,
  githubListCommitsTool,
];

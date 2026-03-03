import { ToolResult } from './toolCallExecution';

const BACKTICK_PATH_PATTERN = /`([^`\r\n]+)`/g;
const PLAIN_PATH_PATTERN = /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9._-]{1,15}\b/g;

export interface GitHubGroundingEnforcementResult {
  replyText: string;
  modified: boolean;
  ungroundedPaths: string[];
  successfulPaths: string[];
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function looksLikeGitHubFilePath(value: string): boolean {
  const normalized = normalizePath(value);
  if (!normalized) return false;
  if (normalized.includes('://')) return false;
  if (/\s/.test(normalized)) return false;

  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 2) return false;

  const fileName = segments[segments.length - 1];
  return /^[a-z0-9._-]+\.[a-z0-9._-]{1,15}$/i.test(fileName);
}

function stripRepoPrefix(path: string): string {
  const segments = normalizePath(path)
    .split('/')
    .filter((segment) => segment.length > 0);
  if (segments.length >= 4) {
    return segments.slice(2).join('/');
  }
  return segments.join('/');
}

function extractClaimedPaths(replyText: string): string[] {
  const claimed = new Set<string>();

  const collect = (value: string) => {
    const trimmed = value.trim();
    if (!looksLikeGitHubFilePath(trimmed)) return;
    claimed.add(trimmed.replace(/^\/+|\/+$/g, ''));
  };

  for (const match of replyText.matchAll(BACKTICK_PATH_PATTERN)) {
    collect(match[1] ?? '');
  }

  for (const match of replyText.matchAll(PLAIN_PATH_PATTERN)) {
    collect(match[0] ?? '');
  }

  return Array.from(claimed);
}

function collectSuccessfulLookupPaths(toolResults: ToolResult[]): {
  successfulPathSet: Set<string>;
  successfulRepoPathSet: Set<string>;
  successfulPaths: string[];
} {
  const successfulPathSet = new Set<string>();
  const successfulRepoPathSet = new Set<string>();
  const successfulPaths = new Set<string>();

  for (const result of toolResults) {
    if (!result.success || result.name !== 'github_get_file') continue;
    if (!result.result || typeof result.result !== 'object' || Array.isArray(result.result)) continue;

    const record = result.result as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    const repo = typeof record.repo === 'string' ? record.repo.trim() : '';
    if (!path || !looksLikeGitHubFilePath(path)) continue;

    const normalizedPath = normalizePath(path);
    successfulPathSet.add(normalizedPath);
    successfulPaths.add(path);

    if (repo) {
      successfulRepoPathSet.add(`${normalizePath(repo)}/${normalizedPath}`);
    }
  }

  return {
    successfulPathSet,
    successfulRepoPathSet,
    successfulPaths: Array.from(successfulPaths),
  };
}

function buildFallbackReply(ungroundedPaths: string[], successfulPaths: string[]): string {
  const ungroundedLabel = ungroundedPaths
    .slice(0, 3)
    .map((path) => `\`${path}\``)
    .join(', ');
  const verifiedLabel = successfulPaths
    .slice(0, 3)
    .map((path) => `\`${path}\``)
    .join(', ');

  const lines = [
    'I could not verify one or more GitHub file-path claims from tool results, so I will not assert them as facts.',
    `Unverified path claim${ungroundedPaths.length > 1 ? 's' : ''}: ${ungroundedLabel}.`,
    successfulPaths.length > 0
      ? `Verified GitHub file path${successfulPaths.length > 1 ? 's' : ''} in this turn: ${verifiedLabel}.`
      : 'No GitHub file path was successfully retrieved in this turn.',
    'Please provide the exact repo/path/ref, or ask me to inspect the repo structure first.',
  ];

  return lines.join('\n');
}

export function enforceGitHubFileGrounding(
  replyText: string,
  toolResults: ToolResult[],
): GitHubGroundingEnforcementResult {
  const githubLookupResults = toolResults.filter(
    (result) => result.name === 'github_get_file',
  );
  const hasGitHubLookupFailures = githubLookupResults.some((result) => !result.success);

  if (!hasGitHubLookupFailures) {
    return {
      replyText,
      modified: false,
      ungroundedPaths: [],
      successfulPaths: [],
    };
  }

  const claimedPaths = extractClaimedPaths(replyText);
  if (claimedPaths.length === 0) {
    return {
      replyText,
      modified: false,
      ungroundedPaths: [],
      successfulPaths: [],
    };
  }

  const { successfulPathSet, successfulRepoPathSet, successfulPaths } =
    collectSuccessfulLookupPaths(toolResults);
  const ungroundedPaths: string[] = [];

  for (const claimedPath of claimedPaths) {
    const normalizedClaim = normalizePath(claimedPath);
    const variants = new Set<string>([normalizedClaim]);
    variants.add(stripRepoPrefix(normalizedClaim));

    const isGrounded = Array.from(variants).some(
      (variant) =>
        successfulPathSet.has(variant) || successfulRepoPathSet.has(variant),
    );
    if (!isGrounded) {
      ungroundedPaths.push(claimedPath);
    }
  }

  if (ungroundedPaths.length === 0) {
    return {
      replyText,
      modified: false,
      ungroundedPaths: [],
      successfulPaths,
    };
  }

  return {
    replyText: buildFallbackReply(ungroundedPaths, successfulPaths),
    modified: true,
    ungroundedPaths,
    successfulPaths,
  };
}

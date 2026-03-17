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
    if (!result.success || !result.name.startsWith('github_')) continue;
    if (!result.structuredContent || typeof result.structuredContent !== 'object' || Array.isArray(result.structuredContent)) continue;

    const record = result.structuredContent as Record<string, unknown>;
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
  const target = ungroundedPaths
    .slice(0, 2)
    .map((path) => `\`${path}\``)
    .join(', ');
  const fallbackTarget = successfulPaths
    .slice(0, 1)
    .map((path) => `\`${path}\``)
    .join(', ');
  const subject = target || fallbackTarget || 'those GitHub file paths';
  return `I couldn't verify ${subject} yet, so please share the exact repo, path, or ref and I'll check again.`;
}

export function enforceGitHubFileGrounding(
  replyText: string,
  toolResults: ToolResult[],
): GitHubGroundingEnforcementResult {
  const hasGitHubLookupFailures = toolResults.some((result) => {
    if (!result.name.startsWith('github_') || result.success) return false;
    const error = (result.error ?? '').toLowerCase();
    return error.includes('github_get_file failed') || error.includes('github_get_file_snippet failed');
  });

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

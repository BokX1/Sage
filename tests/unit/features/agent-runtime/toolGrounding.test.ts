import { describe, expect, it } from 'vitest';
import { enforceGitHubFileGrounding } from '@/features/agent-runtime/toolGrounding';
import type { ToolResult } from '@/features/agent-runtime/toolCallExecution';

function githubSuccess(path: string, repo = 'AjayAntoIsDev/Riko'): ToolResult {
  return {
    name: 'github_get_file',
    success: true,
    structuredContent: {
      repo,
      path,
      content: 'file content',
    },
    telemetry: {
      latencyMs: 120,
    },
  };
}

function githubFailure(
  message = 'Tool execution failed: github_get_file failed for repo "acme/repo" path "missing/file.txt": HTTP 404: Not Found',
): ToolResult {
  return {
    name: 'github_get_file',
    success: false,
    error: message,
    errorType: 'execution',
    telemetry: {
      latencyMs: 110,
    },
  };
}

describe('enforceGitHubFileGrounding', () => {
  it('replaces reply when an unverified file path is claimed after github file.get failures', () => {
    const result = enforceGitHubFileGrounding(
      'Found it in `src/prompts.ts` and here is the content.',
      [githubFailure(), githubSuccess('prompts/system-prompt.txt')],
    );

    expect(result.modified).toBe(true);
    expect(result.ungroundedPaths).toContain('src/prompts.ts');
    expect(result.replyText).toContain("I couldn't verify");
    expect(result.replyText).toContain('`src/prompts.ts`');
  });

  it('does not replace reply when claimed path is backed by successful lookup', () => {
    const result = enforceGitHubFileGrounding(
      'The prompt is in `prompts/system-prompt.txt`.',
      [githubFailure(), githubSuccess('prompts/system-prompt.txt')],
    );

    expect(result.modified).toBe(false);
    expect(result.replyText).toBe('The prompt is in `prompts/system-prompt.txt`.');
  });

  it('does not replace reply when there are no github file.get failures', () => {
    const result = enforceGitHubFileGrounding(
      'The prompt is in `src/prompts.ts`.',
      [githubSuccess('src/prompts.ts')],
    );

    expect(result.modified).toBe(false);
    expect(result.replyText).toBe('The prompt is in `src/prompts.ts`.');
  });
});

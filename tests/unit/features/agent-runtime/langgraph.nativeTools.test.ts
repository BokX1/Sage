import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeToolWithTimeoutMock,
  executeApprovedReviewRequestMock,
} = vi.hoisted(() => ({
  executeToolWithTimeoutMock: vi.fn(),
  executeApprovedReviewRequestMock: vi.fn(),
}));

vi.mock('@langchain/langgraph', async () => {
  const actual = await vi.importActual<typeof import('@langchain/langgraph')>('@langchain/langgraph');
  return {
    ...actual,
    task: (_meta: unknown, fn: (...args: unknown[]) => unknown) => fn,
  };
});

vi.mock('@/features/agent-runtime/toolCallExecution', () => ({
  executeToolWithTimeout: executeToolWithTimeoutMock,
}));

vi.mock('@/features/agent-runtime/toolRegistry', () => ({
  globalToolRegistry: {},
}));

vi.mock('@/features/admin/adminActionService', () => ({
  executeApprovedReviewRequest: executeApprovedReviewRequestMock,
}));

import { executeApprovedReviewTask, executeDurableToolTask } from '@/features/agent-runtime/langgraph/nativeTools';

function makeToolContext() {
  return {
    traceId: 'trace-native-tools-1',
    graphThreadId: 'thread-native-tools-1',
    graphRunKind: 'turn' as const,
    graphStep: 1,
    approvalRequestId: null,
    userId: 'user-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    apiKey: 'test-api-key',
    invokerIsAdmin: true,
    invokerCanModerate: true,
    invokedBy: 'mention' as const,
    routeKind: 'single',
    currentTurn: null,
    replyTarget: null,
  };
}

describe('langgraph nativeTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('compacts oversized tool results into a structured payload instead of a tiny preview envelope', async () => {
    const oversizedResult = {
      summary: 'Investigation summary',
      findings: Array.from({ length: 12 }, (_, index) => ({
        id: index + 1,
        title: `Finding ${index + 1}`,
        detail: `Detail ${index + 1}: ` + 'alpha '.repeat(120),
      })),
      notes: 'omega '.repeat(200),
    };
    executeToolWithTimeoutMock.mockResolvedValueOnce({
      name: 'github',
      success: true,
      result: oversizedResult,
      latencyMs: 42,
    });

    const output = await executeDurableToolTask({
      activeToolNames: ['github'],
      call: {
        name: 'github',
        args: { action: 'search_code', query: 'tool loop' },
      },
      context: makeToolContext(),
      timeoutMs: 1_000,
      maxResultChars: 420,
    });

    expect(output.kind).toBe('tool_result');
    if (output.kind !== 'tool_result') {
      return;
    }

    expect(output.result.success).toBe(true);
    expect(output.result.result).toEqual(oversizedResult);
    const parsed = JSON.parse(output.content) as {
      truncated?: boolean;
      summary?: string;
      data?: Record<string, unknown>;
      preview?: string;
    };
    expect(parsed.truncated).toBe(true);
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.data).toBeTruthy();
    expect(parsed.preview).toBeUndefined();
    expect(parsed.data).toHaveProperty('summary');
    expect(output.content.length).toBeLessThanOrEqual(420);
  });

  it('uses the same structured compaction for approved review execution results', async () => {
    executeApprovedReviewRequestMock.mockResolvedValueOnce({
      status: 'executed',
      kind: 'discord_admin',
      resultJson: {
        roleId: 'role-1',
        audit: Array.from({ length: 10 }, (_, index) => ({
          step: index + 1,
          detail: `Audit step ${index + 1}: ` + 'beta '.repeat(80),
        })),
      },
      errorText: null,
    });

    const output = await executeApprovedReviewTask({
      requestId: 'request-1',
      toolName: 'discord_admin',
      callId: 'call-1',
      reviewerId: 'reviewer-1',
      decisionReasonText: 'approved in test',
      resumeTraceId: 'trace-approved-1',
      maxResultChars: 420,
    });

    expect(output.status).toBe('executed');
    expect(output.result.success).toBe(true);
    const parsed = JSON.parse(output.content) as {
      truncated?: boolean;
      data?: Record<string, unknown>;
      preview?: string;
    };
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview).toBeUndefined();
    expect(parsed.data).toBeTruthy();
    expect(parsed.data).toHaveProperty('status', 'executed');
    expect(output.content.length).toBeLessThanOrEqual(420);
  });
});

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

vi.mock('../../../../src/features/agent-runtime/toolCallExecution', () => ({
  executeToolWithTimeout: executeToolWithTimeoutMock,
}));

vi.mock('../../../../src/features/admin/adminActionService', () => ({
  executeApprovedReviewRequest: executeApprovedReviewRequestMock,
}));

import {
  executeApprovedReviewTask,
  executeDurableToolTask,
} from '../../../../src/features/agent-runtime/langgraph/nativeTools';

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
    currentTurn: undefined,
    replyTarget: null,
  };
}

describe('langgraph nativeTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full serialized tool payloads instead of a truncation envelope', async () => {
    const fullResult = {
      summary: 'Investigation summary',
      findings: Array.from({ length: 12 }, (_, index) => ({
        id: index + 1,
        title: `Finding ${index + 1}`,
        detail: `Detail ${index + 1}: ` + 'alpha '.repeat(120),
      })),
    };
    executeToolWithTimeoutMock.mockResolvedValueOnce({
      name: 'runtime_execute_code',
      success: true,
      structuredContent: fullResult,
      telemetry: { latencyMs: 42 },
    });

    const output = await executeDurableToolTask({
      activeToolNames: ['runtime_execute_code'],
      call: {
        name: 'runtime_execute_code',
        args: { language: 'javascript', code: 'return 1;' },
      },
      context: makeToolContext(),
      timeoutMs: 1_000,
    });

    expect(output.kind).toBe('tool_result');
    if (output.kind !== 'tool_result') return;

    expect(output.result.success).toBe(true);
    expect(output.result.structuredContent).toEqual(fullResult);
    expect(JSON.parse(output.content)).toEqual(fullResult);
    expect(output.content).not.toContain('"truncated":true');
  });

  it('serializes approved review execution results without compaction metadata', async () => {
    executeApprovedReviewRequestMock.mockResolvedValueOnce({
      status: 'executed',
      kind: 'admin.instructions.update',
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
      toolName: 'admin.instructions.update',
      callId: 'call-1',
      reviewerId: 'reviewer-1',
      decisionReasonText: 'approved in test',
      resumeTraceId: 'trace-approved-1',
    });

    expect(output.status).toBe('executed');
    expect(output.result.success).toBe(true);
    const parsed = JSON.parse(output.content) as Record<string, unknown>;
    expect(parsed.status).toBe('executed');
    expect(parsed.kind).toBe('admin.instructions.update');
    expect(parsed).not.toHaveProperty('truncated');
    expect(parsed).toHaveProperty('result');
  });
});

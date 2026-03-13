import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

const {
  loggerWarnMock,
  modelInvokeMock,
  getLastAiToolCallsMock,
  buildAgentGraphConfigMock,
  executeDurableToolTaskMock,
  createGraphContinuationSessionMock,
} = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
  modelInvokeMock: vi.fn(async () => new HumanMessage({ content: 'unused' })),
  getLastAiToolCallsMock: vi.fn((messages: Array<{ tool_calls?: unknown[] }>) => {
    const last = messages.at(-1);
    return Array.isArray(last?.tool_calls) ? last.tool_calls : [];
  }),
  buildAgentGraphConfigMock: vi.fn(() => ({
    maxSteps: 2,
    maxToolCallsPerStep: 3,
    toolTimeoutMs: 1_000,
    maxResultChars: 4_000,
    maxDurationMs: 5_000,
    recursionLimit: 8,
    githubGroundedMode: false,
  })),
  executeDurableToolTaskMock: vi.fn(),
  createGraphContinuationSessionMock: vi.fn(async () => ({
    id: 'cont-1',
    threadId: 'trace-pause-1',
    originTraceId: 'trace-pause-1',
    latestTraceId: 'trace-pause-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    requestedByUserId: 'user-1',
    status: 'pending',
    pauseKind: 'step_window_exhausted',
    completedWindows: 1,
    maxWindows: 4,
    summaryText: 'summary',
    resumeNode: 'llm_call',
    expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    createdAt: new Date('2026-03-14T00:00:00.000Z'),
    updatedAt: new Date('2026-03-14T00:00:00.000Z'),
  })),
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    DATABASE_URL: 'postgresql://sage:test@localhost:5432/sage',
    AI_PROVIDER_BASE_URL: 'https://example.invalid/v1',
    AI_PROVIDER_API_KEY: 'test-api-key',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
    LANGSMITH_TRACING: false,
    AGENT_GRAPH_MAX_STEPS: 2,
    AGENT_GRAPH_MAX_TOOL_CALLS_PER_STEP: 3,
    AGENT_GRAPH_TOOL_TIMEOUT_MS: 1_000,
    AGENT_GRAPH_MAX_RESULT_CHARS: 4_000,
    AGENT_GRAPH_MAX_DURATION_MS: 5_000,
    AGENT_GRAPH_RECURSION_LIMIT: 8,
    AGENT_GRAPH_GITHUB_GROUNDED_MODE: false,
  },
}));

vi.mock('@/platform/logging/logger', () => ({
  logger: {
    warn: loggerWarnMock,
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/features/admin/adminActionService', () => ({
  createOrReuseApprovalReviewRequestFromSignal: vi.fn(),
}));

vi.mock('@/platform/llm/model-budget-config', () => ({
  getModelBudgetConfig: vi.fn(() => ({
    maxInputTokens: 8_192,
    maxOutputTokens: 1_024,
    estimation: 'rough',
    visionFadeKeepLastUserImages: 0,
    attachmentTextMaxTokens: 0,
    visionEnabled: false,
  })),
}));

vi.mock('@/platform/llm/context-budgeter', () => ({
  planBudget: vi.fn(() => ({
    availableInputTokens: 8_192,
    reservedOutputTokens: 1_024,
  })),
  trimMessagesToBudget: vi.fn((messages: unknown[]) => ({
    trimmed: messages,
    stats: {
      beforeCount: messages.length,
      afterCount: messages.length,
      estimatedTokensBefore: 0,
      estimatedTokensAfter: 0,
      notes: [],
    },
  })),
}));

vi.mock('@/platform/llm/ai-provider-chat-model', () => ({
  AiProviderChatModel: class {
    bindTools() {
      return this;
    }

    async invoke() {
      return modelInvokeMock();
    }
  },
}));

vi.mock('@/platform/llm/langchain-interop', () => ({
  extractMessageText: vi.fn((message: { content?: unknown }) =>
    typeof message?.content === 'string' ? message.content : 'unused'
  ),
  getLastAiToolCalls: getLastAiToolCallsMock,
  toLangChainMessages: vi.fn((messages: unknown[]) => messages),
  toLlmMessages: vi.fn((messages: unknown[]) => messages),
}));

vi.mock('@/features/agent-runtime/observability/langsmith', () => ({
  createAgentRunTelemetry: vi.fn(() => ({
    callbacks: undefined,
    flush: vi.fn(async () => undefined),
    getRunReferences: vi.fn(() => ({
      langSmithRunId: null,
      langSmithTraceId: null,
    })),
  })),
}));

vi.mock('@/features/agent-runtime/langgraph/config', () => ({
  buildAgentGraphConfig: buildAgentGraphConfigMock,
}));

vi.mock('@/features/agent-runtime/langgraph/nativeTools', () => ({
  buildActiveToolCatalog: vi.fn(() => ({
    allTools: [],
    readOnlyTools: [],
    definitions: new Map(),
  })),
  executeApprovedReviewTask: vi.fn(),
  executeDurableToolTask: executeDurableToolTaskMock,
  isReadOnlyToolCall: vi.fn(() => false),
}));

vi.mock('@/features/agent-runtime/toolControlSignals', () => ({
  ApprovalRequiredSignal: class ApprovalRequiredSignal extends Error {
    payload: unknown;

    constructor(payload: unknown) {
      super('approval required');
      this.payload = payload;
    }
  },
}));

vi.mock('@/features/agent-runtime/graphContinuationRepo', () => ({
  GRAPH_CONTINUATION_MAX_WINDOWS: 4,
  createGraphContinuationSession: createGraphContinuationSessionMock,
  consumeGraphContinuationSession: vi.fn(),
}));

import {
  runAgentGraphTurn,
  runGraphValueStream,
  shutdownAgentGraphRuntime,
} from '@/features/agent-runtime/langgraph/runtime';

function makeInterruptedState() {
  return {
    messages: [new HumanMessage({ content: 'update the Sage Persona' })],
    resumeContext: {
      traceId: 'trace-1',
      originTraceId: 'trace-1',
      threadId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      invokedBy: 'mention',
      invokerIsAdmin: true,
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
    },
    pendingWriteCall: null,
    replyText: '',
    toolResults: [],
    files: [],
    roundsCompleted: 1,
    completedWindows: 1,
    totalRoundsCompleted: 1,
    deduplicatedCallCount: 0,
    truncatedCallCount: 0,
    guardrailBlockedCallCount: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      fallbackUsed: false,
      returnedToolCallCount: 0,
      completedAt: '2026-03-13T09:30:00.000Z',
      terminationReason: 'approval_interrupt',
    },
    terminationReason: 'approval_interrupt',
    graphStatus: 'interrupted',
    startedAtEpochMs: Date.now(),
    pendingInterrupt: {
      kind: 'approval_review',
      requestId: 'request-1',
      call: {
        id: 'call-1',
        name: 'discord_admin',
        args: { action: 'update_server_instructions' },
      },
      payload: {
        kind: 'server_instructions_update',
      },
      coalesced: false,
      expiresAtIso: '2026-03-13T09:40:00.000Z',
    },
    interruptResolution: null,
  };
}

function makeConfig() {
  return {
    configurable: {
      thread_id: 'trace-1',
      threadId: 'trace-1',
      traceId: 'trace-1',
    },
    runId: 'trace-1',
    runName: 'test-run',
  };
}

describe('runGraphValueStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelInvokeMock.mockReset();
    modelInvokeMock.mockResolvedValue(new HumanMessage({ content: 'unused' }));
    getLastAiToolCallsMock.mockImplementation((messages: Array<{ tool_calls?: unknown[] }>) => {
      const last = messages.at(-1);
      return Array.isArray(last?.tool_calls) ? last.tool_calls : [];
    });
    buildAgentGraphConfigMock.mockReturnValue({
      maxSteps: 2,
      maxToolCallsPerStep: 3,
      toolTimeoutMs: 1_000,
      maxResultChars: 4_000,
      maxDurationMs: 5_000,
      recursionLimit: 8,
      githubGroundedMode: false,
    });
    executeDurableToolTaskMock.mockReset();
    createGraphContinuationSessionMock.mockClear();
  });

  afterEach(async () => {
    await shutdownAgentGraphRuntime();
  });

  it('recovers the interrupted graph state when the stream throws after queueing approval', async () => {
    const interruptedState = makeInterruptedState();
    const streamError = new Error('Graph interrupted before terminal values chunk');
    const graph = {
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield* [];
          throw streamError;
        },
      })),
      getState: vi.fn(async () => ({
        values: interruptedState,
      })),
    };

    const result = await runGraphValueStream(graph as never, {} as never, makeConfig() as never);

    expect(result).toMatchObject({
      graphStatus: 'interrupted',
      terminationReason: 'approval_interrupt',
      replyText: '',
    });
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requestId: 'request-1',
    });
    expect(graph.getState).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        threadId: 'trace-1',
        interruptKind: 'approval_review',
        interruptId: 'request-1',
        recoveryReason: 'stream_error',
      }),
      expect.stringContaining('Recovered interrupted graph state'),
    );
  });

  it('recovers the interrupted graph state when the stream ends without yielding a terminal value', async () => {
    const interruptedState = makeInterruptedState();
    const graph = {
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield* [];
          return;
        },
      })),
      getState: vi.fn(async () => ({
        values: interruptedState,
      })),
    };

    const result = await runGraphValueStream(graph as never, {} as never, makeConfig() as never);

    expect(result.graphStatus).toBe('interrupted');
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requestId: 'request-1',
    });
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryReason: 'missing_final_state',
      }),
      expect.stringContaining('Recovered interrupted graph state'),
    );
  });

  it('recovers the interrupted graph state when LangGraph emits an interrupt sentinel chunk', async () => {
    const interruptedState = makeInterruptedState();
    const graph = {
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield { __interrupt__: [{ value: { requestId: 'request-1' } }] };
        },
      })),
      getState: vi.fn(async () => ({
        values: interruptedState,
      })),
    };

    const result = await runGraphValueStream(graph as never, {} as never, makeConfig() as never);

    expect(result.graphStatus).toBe('interrupted');
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requestId: 'request-1',
    });
    expect(graph.getState).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryReason: 'stream_error',
        streamError: 'LangGraph emitted an interrupt sentinel instead of a terminal state chunk.',
      }),
      expect.stringContaining('Recovered interrupted graph state'),
    );
  });

  it('rethrows the original stream error when checkpoint recovery does not produce an interrupted graph state', async () => {
    const streamError = new Error('stream failed');
    const graph = {
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield* [];
          throw streamError;
        },
      })),
      getState: vi.fn(async () => ({
        values: {
          ...makeInterruptedState(),
          graphStatus: 'completed',
          terminationReason: 'assistant_reply',
          pendingInterrupt: null,
        },
      })),
    };

    await expect(runGraphValueStream(graph as never, {} as never, makeConfig() as never)).rejects.toThrow(
      'stream failed',
    );
  });

  it('pauses immediately instead of forcing another plain-text model pass after the step window is exhausted', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue({
      maxSteps: 1,
      maxToolCallsPerStep: 3,
      toolTimeoutMs: 1_000,
      maxResultChars: 4_000,
      maxDurationMs: 5_000,
      recursionLimit: 8,
      githubGroundedMode: false,
    });
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            name: 'discord_admin',
            args: { action: 'update_server_instructions' },
            type: 'tool_call',
          },
        ],
      }),
    );
    executeDurableToolTaskMock.mockResolvedValueOnce({
      kind: 'executed',
      toolName: 'discord_admin',
      callId: 'call-1',
      content: '{"ok":true}',
      result: {
        name: 'discord_admin',
        success: true,
        result: { ok: true },
        latencyMs: 12,
      },
      files: [],
      status: 'executed',
    });

    const result = await runAgentGraphTurn({
      traceId: 'trace-pause-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'update the server persona' })],
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('interrupted');
    expect(result.terminationReason).toBe('continue_prompt');
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'continue_prompt',
      completedWindows: 1,
      maxWindows: 4,
    });
    expect(result.replyText).toContain('another continuation window');
    expect(modelInvokeMock).toHaveBeenCalledTimes(1);
  });
});

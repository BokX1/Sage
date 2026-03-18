import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { AppError } from '@/shared/errors/app-error';

const {
  loggerWarnMock,
  loggerInfoMock,
  modelInvokeMock,
  getLastAiToolCallsMock,
  buildAgentGraphConfigMock,
  buildActiveToolCatalogMock,
  isReadOnlyToolCallMock,
  planReadOnlyToolExecutionMock,
  toolsConditionMock,
  toolNodeInvokeMock,
  executeDurableToolTaskMock,
  executeApprovedReviewTaskMock,
  prepareToolApprovalInterruptMock,
  createOrReuseApprovalReviewRequestFromSignalMock,
} = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  modelInvokeMock: vi.fn<(messages?: unknown, options?: unknown) => Promise<unknown>>(
    async () => new HumanMessage({ content: 'unused' }),
  ),
  getLastAiToolCallsMock: vi.fn((messages: Array<{ tool_calls?: unknown[] }>) => {
    const last = messages.at(-1);
    return Array.isArray(last?.tool_calls) ? last.tool_calls : [];
  }),
  buildAgentGraphConfigMock: vi.fn(() => ({
    sliceMaxSteps: 2,
    toolTimeoutMs: 1_000,
    maxOutputTokens: 500,
    sliceMaxDurationMs: 5_000,
    maxTotalDurationMs: 3_600_000,
    maxIdleWaitMs: 86_400_000,
    workerPollMs: 5_000,
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    maxResumes: 50,
    compactionEnabled: true,
    compactionTriggerEstimatedTokens: 8_000,
    compactionTriggerRounds: 3,
    compactionTriggerToolResults: 6,
    compactionMaxRawMessages: 12,
    compactionMaxToolObservations: 8,
    recursionLimit: 8,
    githubGroundedMode: false,
    maxToolCallsPerRound: 8,
    maxIdenticalToolBatches: 2,
    maxLoopGuardRecoveries: 1,
  })),
  buildActiveToolCatalogMock: vi.fn<
    () => {
      allTools: Array<{ name: string }>;
      readOnlyTools: Array<{ name: string }>;
      definitions: Map<string, unknown>;
    }
  >(() => ({
    allTools: [],
    readOnlyTools: [],
    definitions: new Map(),
  })),
  isReadOnlyToolCallMock: vi.fn(() => false),
  planReadOnlyToolExecutionMock: vi.fn((params: { calls?: unknown[] }) => ({
    parallelCalls: Array.isArray(params.calls) ? params.calls : [],
    sequentialCalls: [],
  })),
  toolsConditionMock: vi.fn(() => 'end'),
  toolNodeInvokeMock: vi.fn<
    (
      input?: { messages?: Array<{ tool_calls?: Array<{ id?: string }> }> },
      config?: unknown,
    ) => Promise<{ messages: unknown[] }>
  >(async () => ({ messages: [] })),
  executeDurableToolTaskMock: vi.fn(),
  executeApprovedReviewTaskMock: vi.fn(),
  prepareToolApprovalInterruptMock: vi.fn(),
  createOrReuseApprovalReviewRequestFromSignalMock: vi.fn(async () => ({
    request: {
      id: 'request-1',
      threadId: 'trace-approval-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    },
    coalesced: false,
  })),
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    DATABASE_URL: 'postgresql://sage:test@localhost:5432/sage',
    AI_PROVIDER_BASE_URL: 'https://example.invalid/v1',
    AI_PROVIDER_API_KEY: 'test-api-key',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
    LANGSMITH_TRACING: false,
    AGENT_RUN_SLICE_MAX_STEPS: 2,
    AGENT_RUN_TOOL_TIMEOUT_MS: 1_000,
    AGENT_RUN_SLICE_MAX_DURATION_MS: 5_000,
    AGENT_RUN_MAX_TOTAL_DURATION_MS: 3_600_000,
    AGENT_RUN_MAX_IDLE_WAIT_MS: 86_400_000,
    AGENT_RUN_WORKER_POLL_MS: 5_000,
    AGENT_RUN_LEASE_TTL_MS: 30_000,
    AGENT_RUN_HEARTBEAT_MS: 5_000,
    AGENT_RUN_MAX_RESUMES: 50,
    AGENT_RUN_COMPACTION_ENABLED: true,
    AGENT_RUN_COMPACTION_TRIGGER_EST_TOKENS: 8_000,
    AGENT_RUN_COMPACTION_TRIGGER_ROUNDS: 3,
    AGENT_RUN_COMPACTION_TRIGGER_TOOL_RESULTS: 6,
    AGENT_RUN_COMPACTION_MAX_RAW_MESSAGES: 12,
    AGENT_RUN_COMPACTION_MAX_TOOL_OBSERVATIONS: 8,
    AGENT_GRAPH_MAX_OUTPUT_TOKENS: 500,
    AGENT_GRAPH_MAX_TOOL_CALLS_PER_ROUND: 8,
    AGENT_GRAPH_MAX_IDENTICAL_TOOL_BATCHES: 2,
    AGENT_GRAPH_MAX_LOOP_GUARD_RECOVERIES: 1,
    AGENT_GRAPH_RECURSION_LIMIT: 8,
    AGENT_GRAPH_GITHUB_GROUNDED_MODE: false,
  },
}));

vi.mock('@/platform/logging/logger', () => ({
  logger: {
    warn: loggerWarnMock,
    info: loggerInfoMock,
    error: vi.fn(),
  },
}));

vi.mock('@/features/admin/adminActionService', () => ({
  createOrReuseApprovalReviewRequestFromSignal: createOrReuseApprovalReviewRequestFromSignalMock,
}));

vi.mock('@/platform/llm/model-budget-config', () => ({
  getModelBudgetConfig: vi.fn(() => ({
    maxContextTokens: 8_192,
    maxOutputTokens: 1_024,
    safetyMarginTokens: 256,
    estimation: {
      charsPerToken: 4,
      codeCharsPerToken: 3.5,
      imageTokens: 1200,
      messageOverheadTokens: 4,
    },
    visionEnabled: false,
  })),
}));

vi.mock('@/platform/llm/context-budgeter', () => ({
  countMessagesTokens: vi.fn(() => ({
    totalTokens: 0,
    source: 'local_tokenizer',
    encodingName: 'o200k_base',
    imageTokenReserve: 0,
  })),
  estimateMessagesTokens: vi.fn(() => 0),
  planBudget: vi.fn(() => ({
    availableInputTokens: 8_192,
    reservedOutputTokens: 1_024,
  })),
}));

vi.mock('@/platform/llm/ai-provider-chat-model', () => ({
  AiProviderChatModel: class {
    bindTools() {
      return this;
    }

    async invoke(messages: Array<{ role?: string; content?: unknown }>, options?: unknown) {
      return modelInvokeMock(messages, options);
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

vi.mock('@langchain/langgraph/prebuilt', () => ({
  ToolNode: class ToolNode {
    async invoke(...args: unknown[]) {
      return toolNodeInvokeMock(
        args[0] as Parameters<typeof toolNodeInvokeMock>[0],
        args[1] as Parameters<typeof toolNodeInvokeMock>[1],
      );
    }
  },
  toolsCondition: toolsConditionMock,
}));

vi.mock('@/features/agent-runtime/langgraph/nativeTools', () => ({
  buildActiveToolCatalog: buildActiveToolCatalogMock,
  executeApprovedReviewTask: executeApprovedReviewTaskMock,
  executeDurableToolTask: executeDurableToolTaskMock,
  prepareToolApprovalInterrupt: prepareToolApprovalInterruptMock,
  isReadOnlyToolCall: isReadOnlyToolCallMock,
  planReadOnlyToolExecution: planReadOnlyToolExecutionMock,
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

import {
  __getAgentGraphStateForTests,
  __runAgentGraphCommandForTests,
  continueAgentGraphTurn,
  runAgentGraphTurn,
  runGraphValueStream,
  resumeAgentGraphTurn,
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
    pendingReadCalls: [],
    pendingReadExecutionCalls: [],
    pendingWriteCalls: [],
    replyText: '',
    toolResults: [],
    files: [],
    roundsCompleted: 1,
    sliceIndex: 1,
    totalRoundsCompleted: 1,
    deduplicatedCallCount: 0,
    lastToolBatchFingerprint: null,
    consecutiveIdenticalToolBatches: 0,
    loopGuardRecoveries: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      completedAt: '2026-03-13T09:30:00.000Z',
      stopReason: 'approval_interrupt',
      completionKind: 'approval_pending',
      deliveryDisposition: 'approval_handoff',
      finalizedBy: 'approval_interrupt',
      draftRevision: 1,
      contextFrame: {
        objective: 'Finish the request.',
        verifiedFacts: [],
        completedActions: [],
        openQuestions: [],
        pendingApprovals: ['discord_admin:request-1'],
        deliveryState: 'awaiting_approval',
        nextAction: 'Wait for approval resolution.',
      },
    },
    completionKind: 'approval_pending',
    stopReason: 'approval_interrupt',
    deliveryDisposition: 'approval_handoff',
    responseSession: {
      responseSessionId: 'trace-1',
      status: 'awaiting_approval',
      latestText: 'Working on that now.',
      draftRevision: 1,
      sourceMessageId: null,
      responseMessageId: null,
      linkedArtifactMessageIds: [],
    },
    artifactDeliveries: [],
    contextFrame: {
      objective: 'Finish the request.',
      verifiedFacts: [],
      completedActions: [],
      openQuestions: [],
      pendingApprovals: ['discord_admin:request-1'],
      deliveryState: 'awaiting_approval',
      nextAction: 'Wait for approval resolution.',
    },
    graphStatus: 'interrupted',
    activeWindowDurationMs: 0,
    pendingInterrupt: {
      kind: 'approval_review',
      requestId: 'request-1',
      batchId: 'batch-1',
      requests: [
        {
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
      ],
    },
    interruptResolution: null,
  };
}

function makeFinishTurnMessage(
  kind: 'final_answer' | 'clarification_question',
  message?: string,
): AIMessage {
  const replyText = kind === 'clarification_question'
    ? message ?? 'What detail should I use?'
    : message ?? 'All set.';
  return new AIMessage({
    content: `<assistant_closeout>${JSON.stringify({ kind, replyText })}</assistant_closeout>`,
  });
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

function makeSuccessfulToolResult(
  name: string,
  structuredContent: Record<string, unknown>,
  latencyMs = 10,
): {
  name: string;
  success: true;
  structuredContent: Record<string, unknown>;
  telemetry: { latencyMs: number };
} {
  return {
    name,
    success: true,
    structuredContent,
    telemetry: { latencyMs },
  };
}

function makeToolTaskOutcome(params: {
  toolName: string;
  callId: string;
  content: string;
  structuredContent: Record<string, unknown>;
  latencyMs?: number;
  status?: 'executed' | 'failed';
}) {
  return {
    kind: 'tool_result' as const,
    toolName: params.toolName,
    callId: params.callId,
    content: params.content,
    result: makeSuccessfulToolResult(
      params.toolName,
      params.structuredContent,
      params.latencyMs ?? 10,
    ),
    files: [],
    status: params.status ?? 'executed',
  };
}

function makeGraphConfig(
  overrides: Partial<ReturnType<typeof buildAgentGraphConfigMock>> = {},
): ReturnType<typeof buildAgentGraphConfigMock> {
  return {
    sliceMaxSteps: 2,
    toolTimeoutMs: 1_000,
    maxOutputTokens: 500,
    sliceMaxDurationMs: 5_000,
    maxTotalDurationMs: 3_600_000,
    maxIdleWaitMs: 86_400_000,
    workerPollMs: 5_000,
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    maxResumes: 50,
    compactionEnabled: true,
    compactionTriggerEstimatedTokens: 8_000,
    compactionTriggerRounds: 3,
    compactionTriggerToolResults: 6,
    compactionMaxRawMessages: 12,
    compactionMaxToolObservations: 8,
    recursionLimit: 8,
    githubGroundedMode: false,
    maxToolCallsPerRound: 8,
    maxIdenticalToolBatches: 2,
    maxLoopGuardRecoveries: 1,
    ...overrides,
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
    buildAgentGraphConfigMock.mockReturnValue(makeGraphConfig());
    buildActiveToolCatalogMock.mockReset();
    buildActiveToolCatalogMock.mockReturnValue({
      allTools: [],
      readOnlyTools: [],
      definitions: new Map(),
    });
    isReadOnlyToolCallMock.mockReset();
    isReadOnlyToolCallMock.mockReturnValue(false);
    planReadOnlyToolExecutionMock.mockReset();
    planReadOnlyToolExecutionMock.mockImplementation((params: { calls?: unknown[] }) => ({
      parallelCalls: Array.isArray(params.calls) ? params.calls : [],
      sequentialCalls: [],
    }));
    toolNodeInvokeMock.mockReset();
    toolNodeInvokeMock.mockResolvedValue({ messages: [] });
    toolsConditionMock.mockReset();
    toolsConditionMock.mockReturnValue('end');
    executeDurableToolTaskMock.mockReset();
    executeApprovedReviewTaskMock.mockReset();
    prepareToolApprovalInterruptMock.mockReset();
    prepareToolApprovalInterruptMock.mockResolvedValue(null);
    createOrReuseApprovalReviewRequestFromSignalMock.mockClear();
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
      stopReason: 'approval_interrupt',
      completionKind: 'approval_pending',
      deliveryDisposition: 'approval_handoff',
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
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryReason: 'interrupt_sentinel',
      }),
      expect.stringContaining('Recovered interrupted graph state'),
    );
    expect(loggerWarnMock).not.toHaveBeenCalled();
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
          stopReason: 'assistant_turn_completed',
          completionKind: 'final_answer',
          deliveryDisposition: 'response_session',
          pendingInterrupt: null,
        },
      })),
    };

    await expect(runGraphValueStream(graph as never, {} as never, makeConfig() as never)).rejects.toThrow(
      'stream failed',
    );
  });

  it('converts GraphRecursionError into a clean loop_guard result using the last checkpoint', async () => {
    const streamError = Object.assign(new Error('recursion limit exceeded'), {
      name: 'GraphRecursionError',
    });
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
          graphStatus: 'running',
          stopReason: 'assistant_turn_completed',
          completionKind: null,
          deliveryDisposition: 'response_session',
          pendingInterrupt: null,
          pendingReadCalls: [{ id: 'call-recursion-1', name: 'github', args: { q: 'status' } }],
          pendingReadExecutionCalls: [{ id: 'call-recursion-1', name: 'github', args: { q: 'status' } }],
          pendingWriteCalls: [],
        },
      })),
    };

    const result = await runGraphValueStream(graph as never, {} as never, makeConfig() as never);

    expect(result.graphStatus).toBe('completed');
    expect(result.stopReason).toBe('loop_guard');
    expect(result.completionKind).toBe('loop_guard');
    expect(result.deliveryDisposition).toBe('response_session');
    expect(result.replyText).toContain('I need a smaller follow-up');
    expect(result.roundEvents.at(-1)).toMatchObject({
      guardReason: 'recursion_limit',
    });
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        threadId: 'trace-1',
      }),
      expect.stringContaining('Recovered graph checkpoint after hitting the LangGraph recursion limit'),
    );
  });

  it('uses a no-tools wrap-up model pass before pausing when the step window is exhausted', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue(makeGraphConfig({ sliceMaxSteps: 1 }));
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
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content:
          'I updated the server persona and still need one more pass to verify the remaining details cleanly.',
      }),
    );
    executeDurableToolTaskMock.mockResolvedValueOnce({
      kind: 'tool_result',
      toolName: 'discord_admin_update_server_instructions',
      callId: 'call-1',
      content: '{"ok":true}',
      result: makeSuccessfulToolResult('discord_admin_update_server_instructions', { ok: true }, 12),
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

    expect(result.graphStatus).toBe('completed');
    expect(result.stopReason).toBe('background_yield');
    expect(result.completionKind).toBeNull();
    expect(result.deliveryDisposition).toBe('response_session');
    expect(result.pendingInterrupt).toBeNull();
    expect(result.yieldReason).toBe('slice_budget_exhausted');
    expect(result.replyText).toContain('updated the server persona');
    expect(result.replyText).not.toContain('Completed so far: 1 tool call (discord_admin_update_server_instructions).');
    expect(result.roundsCompleted).toBe(1);
    expect(result.totalRoundsCompleted).toBe(2);
    expect(modelInvokeMock).toHaveBeenCalledTimes(2);
  });

  it('counts a terminal closeout tool response as one AI-provider turn', async () => {
    modelInvokeMock.mockResolvedValueOnce(makeFinishTurnMessage('final_answer', 'All set.'));

    const result = await runAgentGraphTurn({
      traceId: 'trace-turn-count-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'say hello' })],
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.replyText).toContain('All set.');
    expect(result.roundsCompleted).toBe(1);
    expect(result.totalRoundsCompleted).toBe(1);
  });

  it('executes every tool call emitted in one model response instead of truncating the batch', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue(
      makeGraphConfig({
        sliceMaxSteps: 3,
        recursionLimit: 20,
      }),
    );
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call-overflow-1',
            name: 'discord_admin_update_server_instructions',
            args: { reason: 'sync' },
            type: 'tool_call',
          },
          {
            id: 'call-overflow-2',
            name: 'discord_admin_clear_server_api_key',
            args: {},
            type: 'tool_call',
          },
          {
            id: 'call-overflow-3',
            name: 'discord_admin_get_server_key_status',
            args: {},
            type: 'tool_call',
          },
          {
            id: 'call-overflow-4',
            name: 'discord_admin_create_channel',
            args: { name: 'ops', type: 0 },
            type: 'tool_call',
          },
          {
            id: 'call-overflow-5',
            name: 'discord_admin_create_role',
            args: { name: 'ops-role' },
            type: 'tool_call',
          },
        ],
      }),
    );
    modelInvokeMock.mockResolvedValueOnce(
      makeFinishTurnMessage('final_answer', 'I finished the first batch and left the overflow for a follow-up pass.'),
    );
    executeDurableToolTaskMock
      .mockResolvedValueOnce(
        makeToolTaskOutcome({
          toolName: 'discord_admin_update_server_instructions',
          callId: 'call-overflow-1',
          content: '{"ok":true,"action":"update_server_instructions"}',
          structuredContent: { ok: true, action: 'update_server_instructions' },
        }),
      )
      .mockResolvedValueOnce(
        makeToolTaskOutcome({
          toolName: 'discord_admin_clear_server_api_key',
          callId: 'call-overflow-2',
          content: '{"ok":true,"action":"clear_server_api_key"}',
          structuredContent: { ok: true, action: 'clear_server_api_key' },
        }),
      )
      .mockResolvedValueOnce(
        makeToolTaskOutcome({
          toolName: 'discord_admin_get_server_key_status',
          callId: 'call-overflow-3',
          content: '{"ok":true,"action":"get_server_key_status"}',
          structuredContent: { ok: true, action: 'get_server_key_status' },
        }),
      )
      .mockResolvedValueOnce(
        makeToolTaskOutcome({
          toolName: 'discord_admin_create_channel',
          callId: 'call-overflow-4',
          content: '{"ok":true,"action":"create_channel"}',
          structuredContent: { ok: true, action: 'create_channel' },
        }),
      )
      .mockResolvedValueOnce(
        makeToolTaskOutcome({
          toolName: 'discord_admin_create_role',
          callId: 'call-overflow-5',
          content: '{"ok":true,"action":"create_role"}',
          structuredContent: { ok: true, action: 'create_role' },
        }),
      );

    const result = await runAgentGraphTurn({
      traceId: 'trace-overflow-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'handle the admin actions in order' })],
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.replyText).toContain('finished the first batch');
    expect(result.roundsCompleted).toBe(2);
    expect(result.totalRoundsCompleted).toBe(2);
    expect(result.roundEvents[0]).toMatchObject({
      requestedCallCount: 5,
      executedCallCount: 5,
      deduplicatedCallCount: 0,
    });
    expect(result.toolResults).toHaveLength(5);
    expect(result.toolResults.filter((entry) => entry.success)).toHaveLength(5);
    expect(result.toolResults.filter((entry) => !entry.success)).toHaveLength(0);
    expect(executeDurableToolTaskMock).toHaveBeenCalledTimes(5);
  });

  it('dedupes identical read-only calls in one model response while preserving per-call tool ids', async () => {
    await shutdownAgentGraphRuntime();
    isReadOnlyToolCallMock.mockReturnValue(true);
    buildActiveToolCatalogMock.mockReturnValue({
      allTools: [{ name: 'github_search_code' }],
      readOnlyTools: [{ name: 'github_search_code' }],
      definitions: new Map(),
    });
    toolNodeInvokeMock.mockImplementationOnce(async (input?: { messages?: Array<{ tool_calls?: Array<{ id?: string }> }> }) => {
      const batchCall = input?.messages?.[0]?.tool_calls?.[0];
      return {
        messages: [
          new ToolMessage({
            content: '{"ok":true,"items":[1]}',
            tool_call_id: batchCall?.id ?? 'call-read-1',
            artifact: {
              result: {
                name: 'github_search_code',
                success: true,
                structuredContent: { ok: true, items: [1] },
                telemetry: { latencyMs: 7 },
              },
              files: [],
            },
            status: 'success',
          }),
        ],
      };
    });
    modelInvokeMock.mockResolvedValueOnce(
      makeFinishTurnMessage('final_answer', 'Read checks completed.'),
    );

    const result = await __runAgentGraphCommandForTests({
      threadId: 'trace-read-dedupe-1',
      goto: 'route_tool_phase',
      context: {
        traceId: 'trace-read-dedupe-1',
        originTraceId: 'trace-read-dedupe-1',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        activeToolNames: ['github_search_code'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'mention',
      },
      state: {
        roundsCompleted: 1,
        messages: [
          new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call-read-1',
                name: 'github_search_code',
                args: { q: 'repo status', think: 'ignore' },
                type: 'tool_call',
              },
              {
                id: 'call-read-2',
                name: 'github_search_code',
                args: { think: 'different', q: 'repo status' },
                type: 'tool_call',
              },
            ],
          }),
        ],
      },
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.replyText).toContain('Read checks completed.');
    expect(result.deduplicatedCallCount).toBe(1);
    expect(result.roundEvents[0]).toMatchObject({
      requestedCallCount: 2,
      executedCallCount: 1,
      deduplicatedCallCount: 1,
      uniqueCallCount: 1,
      skippedDuplicateCallCount: 1,
      overLimitCallCount: 0,
    });
    expect(result.toolResults).toHaveLength(2);
    expect(toolNodeInvokeMock).toHaveBeenCalledTimes(1);

    const checkpointState = await __getAgentGraphStateForTests('trace-read-dedupe-1');
    const toolMessages = checkpointState?.messages.filter((message) => message instanceof ToolMessage) ?? [];
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call-read-1', 'call-read-2']);
    expect((toolMessages[0]?.artifact as { cacheHit?: boolean } | undefined)?.cacheHit).not.toBe(true);
    expect(toolMessages[1]?.artifact).toMatchObject({
      cacheHit: true,
      cacheKind: 'dedupe',
    });
  });

  it('exits the read-only subgraph after one pass even when ToolNode emits no tool messages', async () => {
    await shutdownAgentGraphRuntime();
    isReadOnlyToolCallMock.mockReturnValue(true);
    buildAgentGraphConfigMock.mockReturnValue(
      makeGraphConfig({
        sliceMaxSteps: 3,
        recursionLimit: 8,
      }),
    );
    buildActiveToolCatalogMock.mockReturnValue({
      allTools: [{ name: 'github_get_repo' }],
      readOnlyTools: [],
      definitions: new Map(),
    });
    toolsConditionMock.mockReturnValue('tools');
    toolNodeInvokeMock.mockResolvedValueOnce({ messages: [] });
    modelInvokeMock.mockResolvedValueOnce(
      makeFinishTurnMessage('final_answer', 'Continuing after an empty read batch.'),
    );

    const result = await __runAgentGraphCommandForTests({
      threadId: 'trace-read-subgraph-exit-1',
      goto: 'route_tool_phase',
      context: {
        traceId: 'trace-read-subgraph-exit-1',
        originTraceId: 'trace-read-subgraph-exit-1',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        activeToolNames: ['github_get_repo'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'mention',
      },
      state: {
        roundsCompleted: 1,
        messages: [
          new AIMessage({
            content: 'Fetching repo metadata next.',
            tool_calls: [
              {
                id: 'call-read-empty-1',
                name: 'github_get_repo',
                args: { repo: 'blueplaysgames3921', includeReadme: false },
                type: 'tool_call',
              },
            ],
          }),
        ],
      },
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.stopReason).toBe('assistant_turn_completed');
    expect(result.replyText).toContain('Continuing after an empty read batch.');
    expect(result.roundsCompleted).toBe(2);
    expect(toolNodeInvokeMock).not.toHaveBeenCalled();
  });

  it('rejects an over-cap tool batch before any write executes and gives the model one repair pass', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue(
      makeGraphConfig({
        sliceMaxSteps: 3,
        recursionLimit: 20,
        maxToolCallsPerRound: 1,
      }),
    );
    modelInvokeMock
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call-cap-1',
              name: 'discord_admin',
              args: { action: 'create_channel', name: 'ops-1' },
              type: 'tool_call',
            },
            {
              id: 'call-cap-2',
              name: 'discord_admin',
              args: { action: 'create_channel', name: 'ops-2' },
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeFinishTurnMessage('final_answer', 'I narrowed the work and am waiting for direction.'),
      );

    const result = await runAgentGraphTurn({
      traceId: 'trace-over-cap-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'create two channels' })],
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.replyText).toContain('narrowed the work');
    expect(result.roundEvents[0]).toMatchObject({
      requestedCallCount: 2,
      executedCallCount: 0,
      uniqueCallCount: 2,
      overLimitCallCount: 1,
      guardReason: 'too_many_tool_calls',
    });
    expect(executeDurableToolTaskMock).not.toHaveBeenCalled();
    expect(result.toolResults.filter((entry) => !entry.success)).toHaveLength(2);
  });

  it('allows one repeated-batch repair cycle, then finalizes with loop_guard if the same write plan repeats again', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue(makeGraphConfig({ sliceMaxSteps: 4 }));
    modelInvokeMock
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call-repeat-1',
              name: 'discord_admin',
              args: { action: 'create_channel', name: 'ops-loop' },
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call-repeat-2',
              name: 'discord_admin',
              args: { action: 'create_channel', name: 'ops-loop' },
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call-repeat-3',
              name: 'discord_admin',
              args: { action: 'create_channel', name: 'ops-loop' },
              type: 'tool_call',
            },
          ],
        }),
      );
    executeDurableToolTaskMock.mockResolvedValueOnce({
      kind: 'tool_result',
      toolName: 'discord_admin',
      callId: 'call-repeat-1',
      content: '{"ok":true}',
      result: {
        name: 'discord_admin',
        success: true,
        result: { ok: true },
        latencyMs: 9,
      },
      files: [],
    });

    const result = await runAgentGraphTurn({
      traceId: 'trace-repeat-guard-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'create the ops loop channel' })],
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.stopReason).toBe('loop_guard');
    expect(result.completionKind).toBe('loop_guard');
    expect(result.replyText).toContain('I need a smaller follow-up');
    expect(executeDurableToolTaskMock).toHaveBeenCalledTimes(1);
    expect(result.roundEvents.some((event) => event.guardReason === 'repeated_identical_batch')).toBe(true);
  });

  it('retries transient provider failures on tool_call_turn without consuming an extra turn', async () => {
    modelInvokeMock
      .mockRejectedValueOnce(
        new AppError(
          'AI_PROVIDER_UPSTREAM',
          'AI provider API error: 503 Service Unavailable - upstream down',
        ),
      )
      .mockResolvedValueOnce(
        makeFinishTurnMessage('final_answer', 'Recovered after transient provider failure.'),
      );

    const result = await runAgentGraphTurn({
      traceId: 'trace-llm-retry-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'say hello after retrying' })],
      activeToolNames: [],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: false,
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.replyText).toContain('Recovered after transient provider failure.');
    expect(result.roundsCompleted).toBe(1);
    expect(result.totalRoundsCompleted).toBe(1);
    expect(modelInvokeMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the configured main-agent model when seeded graph commands omit context.model', async () => {
    const modelBudgetModule = await import('@/platform/llm/model-budget-config');
    const getModelBudgetConfigMock = vi.mocked(modelBudgetModule.getModelBudgetConfig);
    modelInvokeMock.mockResolvedValueOnce(
      makeFinishTurnMessage('final_answer', 'Seeded run completed.'),
    );

    const result = await __runAgentGraphCommandForTests({
      threadId: 'trace-seeded-model-fallback',
      goto: 'tool_call_turn',
      context: {
        traceId: 'trace-seeded-model-fallback',
        originTraceId: 'trace-seeded-model-fallback',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        apiKey: 'test-api-key',
        temperature: 0.6,
        timeoutMs: 1_000,
        maxTokens: 500,
        activeToolNames: [],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'mention',
      },
      state: {
        messages: [new HumanMessage({ content: 'finish this seeded run' })],
      },
    });

    expect(result.replyText).toContain('Seeded run completed.');
    expect(getModelBudgetConfigMock).toHaveBeenCalledWith('test-main-agent-model');
  });

  it('preserves background_yield when the active runtime budget is exhausted', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue(
      makeGraphConfig({
        sliceMaxSteps: 2,
        sliceMaxDurationMs: 1,
      }),
    );
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call-time-budget-1',
            name: 'discord_admin_clear_server_api_key',
            args: {},
            type: 'tool_call',
          },
        ],
      }),
    );
    executeDurableToolTaskMock.mockResolvedValueOnce(
      makeToolTaskOutcome({
        toolName: 'discord_admin_clear_server_api_key',
        callId: 'call-time-budget-1',
        content: '{"ok":true}',
        structuredContent: { ok: true },
        latencyMs: 12,
      }),
    );

    const result = await runAgentGraphTurn({
      traceId: 'trace-time-budget-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'do the admin action and keep going' })],
      activeToolNames: ['discord_admin_clear_server_api_key'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.stopReason).toBe('background_yield');
    expect(result.deliveryDisposition).toBe('response_session');
    expect(result.pendingInterrupt).toBeNull();
    expect(result.yieldReason).toBe('slice_budget_exhausted');
  });

  it('finalizes a background yield with a wrap-up summary instead of a raw tool fragment', async () => {
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content:
          'I gathered the key GitHub findings already, and I will keep working through the rest in the background.',
      }),
    );
    const result = await __runAgentGraphCommandForTests({
      threadId: 'trace-max-windows-1',
      goto: 'yield_background',
      context: {
        traceId: 'trace-max-windows-1',
        originTraceId: 'trace-max-windows-1',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        apiKey: 'test-api-key',
        model: 'test-main-agent-model',
        temperature: 0.6,
        timeoutMs: 1_000,
        maxTokens: 500,
        activeToolNames: ['github'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'mention',
      },
      state: {
        sliceIndex: 3,
        roundsCompleted: 1,
        totalRoundsCompleted: 7,
        toolResults: Array.from({ length: 7 }, () =>
          makeSuccessfulToolResult('github_search_code', { ok: true }, 10),
        ),
        messages: [new AIMessage({ content: 'I will call github again.' })],
      },
    });

    expect(result.graphStatus).toBe('completed');
    expect(result.stopReason).toBe('background_yield');
    expect(result.completionKind).toBeNull();
    expect(result.deliveryDisposition).toBe('response_session');
    expect(result.replyText).toContain('gathered the key GitHub findings');
    expect(result.replyText).not.toContain('Please send me a new message');
    expect(result.replyText).not.toContain('Completed so far: 7 tool calls (github x7).');
    expect(result.totalRoundsCompleted).toBe(8);
  });

  it('materializes approval interrupts before pausing the graph', async () => {
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call-approve-1',
            name: 'discord_admin',
            args: { action: 'update_server_instructions' },
            type: 'tool_call',
          },
        ],
      }),
    );
    prepareToolApprovalInterruptMock.mockResolvedValueOnce({
      toolName: 'discord_admin',
      callId: 'call-approve-1',
      call: {
        id: 'call-approve-1',
        name: 'discord_admin',
        args: { action: 'update_server_instructions' },
      },
      payload: {
        kind: 'server_instructions_update',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        sourceMessageId: null,
        requestedBy: 'user-1',
        dedupeKey: 'dedupe-1',
        executionPayloadJson: { next: 'value' },
        reviewSnapshotJson: { action: 'update_server_instructions' },
        interruptMetadataJson: { action: 'update_server_instructions' },
      },
      approvalGroupKey: 'discord_admin:server_instructions',
    });

    const result = await runAgentGraphTurn({
      traceId: 'trace-approval-1',
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

    expect(createOrReuseApprovalReviewRequestFromSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'trace-approval-1',
        originTraceId: 'trace-approval-1',
      }),
    );
    expect(result.graphStatus).toBe('interrupted');
    expect(result.stopReason).toBe('approval_interrupt');
    expect(result.completionKind).toBe('approval_pending');
    expect(result.deliveryDisposition).toBe('approval_handoff');
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requestId: 'request-1',
      requests: [
        expect.objectContaining({
          requestId: 'request-1',
          expiresAtIso: '2026-03-14T00:00:00.000Z',
        }),
      ],
    });
  });

  it('can seed approval_gate execution directly for deterministic graph validation', async () => {
    prepareToolApprovalInterruptMock.mockResolvedValueOnce({
      toolName: 'discord_admin',
      callId: 'call-seeded-approval-1',
      call: {
        id: 'call-seeded-approval-1',
        name: 'discord_admin',
        args: { action: 'create_role', name: 'seeded-role' },
      },
      payload: {
        kind: 'discord_rest_write',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        sourceMessageId: null,
        requestedBy: 'user-1',
        dedupeKey: 'seeded-dedupe',
        executionPayloadJson: { request: { method: 'POST', path: '/guilds/guild-1/roles' } },
        reviewSnapshotJson: { action: 'create_role' },
        interruptMetadataJson: { action: 'create_role' },
      },
      approvalGroupKey: 'discord_admin:rest_write',
    });

    const result = await __runAgentGraphCommandForTests({
      threadId: 'trace-seeded-approval-1',
      goto: 'approval_gate',
      context: {
        traceId: 'trace-seeded-approval-1',
        originTraceId: 'trace-seeded-approval-1',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        activeToolNames: ['discord_admin'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'mention',
        invokerIsAdmin: true,
      },
      state: {
        pendingWriteCalls: [
          {
            id: 'call-seeded-approval-1',
            name: 'discord_admin',
            args: { action: 'create_role', name: 'seeded-role' },
          },
        ],
      },
    });

    expect(modelInvokeMock).not.toHaveBeenCalled();
    expect(result.graphStatus).toBe('interrupted');
    expect(result.stopReason).toBe('approval_interrupt');
    expect(result.completionKind).toBe('approval_pending');
    expect(result.deliveryDisposition).toBe('approval_handoff');
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requestId: 'request-1',
    });
  });

  it('does not persist provider api keys in checkpointed graph state', async () => {
    modelInvokeMock.mockResolvedValueOnce(makeFinishTurnMessage('final_answer', 'Done.'));

    const result = await runAgentGraphTurn({
      traceId: 'trace-secrets-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'reply plainly' })],
      activeToolNames: [],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('completed');
    const checkpointState = await __getAgentGraphStateForTests('trace-secrets-1');
    expect(checkpointState?.resumeContext).not.toHaveProperty('apiKey');
  });

  it('interrupts only the prepared approval prefix when the next write has no approval policy', async () => {
    createOrReuseApprovalReviewRequestFromSignalMock.mockResolvedValueOnce({
      request: {
        id: 'request-boundary-1',
        threadId: 'trace-approval-boundary-1',
        expiresAt: new Date('2026-03-14T00:00:00.000Z'),
      },
      coalesced: false,
    });
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call-boundary-1',
            name: 'discord_admin',
            args: { action: 'update_server_instructions' },
            type: 'tool_call',
          },
          {
            id: 'call-boundary-2',
            name: 'discord_admin',
            args: { action: 'clear_server_api_key' },
            type: 'tool_call',
          },
        ],
      }),
    );
    prepareToolApprovalInterruptMock
      .mockResolvedValueOnce({
        toolName: 'discord_admin',
        callId: 'call-boundary-1',
        call: {
          id: 'call-boundary-1',
          name: 'discord_admin',
          args: { action: 'update_server_instructions' },
        },
        payload: {
          kind: 'server_instructions_update',
          guildId: 'guild-1',
          sourceChannelId: 'channel-1',
          reviewChannelId: 'channel-review',
          sourceMessageId: null,
          requestedBy: 'user-1',
          dedupeKey: 'dedupe-boundary-1',
          executionPayloadJson: { next: 'value' },
          reviewSnapshotJson: { action: 'update_server_instructions' },
          interruptMetadataJson: { action: 'update_server_instructions' },
        },
        approvalGroupKey: 'discord_admin:server_instructions',
      })
      .mockResolvedValueOnce(null);

    const result = await runAgentGraphTurn({
      traceId: 'trace-approval-boundary-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'update the persona, then clear the key' })],
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('interrupted');
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requests: [expect.objectContaining({ requestId: 'request-boundary-1' })],
    });
    expect(executeDurableToolTaskMock).not.toHaveBeenCalled();
    expect(createOrReuseApprovalReviewRequestFromSignalMock).toHaveBeenCalledTimes(1);
  });

  it('resumes a multi-request approval batch from one model response without throwing', async () => {
    createOrReuseApprovalReviewRequestFromSignalMock
      .mockResolvedValueOnce({
        request: {
          id: 'request-1',
          threadId: 'trace-approval-chain-1',
          expiresAt: new Date('2026-03-14T00:00:00.000Z'),
        },
        coalesced: false,
      })
      .mockResolvedValueOnce({
        request: {
          id: 'request-2',
          threadId: 'trace-approval-chain-1',
          expiresAt: new Date('2026-03-14T00:05:00.000Z'),
        },
        coalesced: false,
      });
    modelInvokeMock
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call-approve-1',
              name: 'discord_admin_create_channel',
              args: { name: 'ops-summary', type: 0 },
              type: 'tool_call',
            },
            {
              id: 'call-approve-2',
              name: 'discord_admin_create_role',
              args: { name: 'ops-summary-role' },
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeFinishTurnMessage('final_answer', 'Done.'));
    prepareToolApprovalInterruptMock
      .mockResolvedValueOnce({
        toolName: 'discord_admin_create_channel',
        callId: 'call-approve-1',
        call: {
          id: 'call-approve-1',
          name: 'discord_admin_create_channel',
          args: { name: 'ops-summary', type: 0 },
        },
        payload: {
          kind: 'discord_rest_write',
          guildId: 'guild-1',
          sourceChannelId: 'channel-1',
          reviewChannelId: 'channel-review',
          sourceMessageId: null,
          requestedBy: 'user-1',
          dedupeKey: 'dedupe-1',
          executionPayloadJson: { step: 1 },
          reviewSnapshotJson: { step: 1 },
          interruptMetadataJson: { step: 1 },
        },
        approvalGroupKey: 'discord_admin:rest_write',
      })
      .mockResolvedValueOnce({
        toolName: 'discord_admin_create_role',
        callId: 'call-approve-2',
        call: {
          id: 'call-approve-2',
          name: 'discord_admin_create_role',
          args: { name: 'ops-summary-role' },
        },
        payload: {
          kind: 'discord_rest_write',
          guildId: 'guild-1',
          sourceChannelId: 'channel-1',
          reviewChannelId: 'channel-review',
          sourceMessageId: null,
          requestedBy: 'user-1',
          dedupeKey: 'dedupe-2',
          executionPayloadJson: { step: 2 },
          reviewSnapshotJson: { step: 2 },
          interruptMetadataJson: { step: 2 },
        },
        approvalGroupKey: 'discord_admin:rest_write',
      });
    executeApprovedReviewTaskMock
      .mockResolvedValueOnce(
        makeToolTaskOutcome({
          toolName: 'discord_admin_create_channel',
          callId: 'call-approve-1',
          content: '{"status":"executed","step":1}',
          structuredContent: { step: 1, status: 'executed' },
        }),
      )
      .mockResolvedValueOnce(
        makeToolTaskOutcome({
          toolName: 'discord_admin_create_role',
          callId: 'call-approve-2',
          content: '{"status":"executed","step":2}',
          structuredContent: { step: 2, status: 'executed' },
        }),
      );

    const initial = await runAgentGraphTurn({
      traceId: 'trace-approval-chain-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'create a channel and post a summary there' })],
      activeToolNames: ['discord_admin_create_channel', 'discord_admin_create_role'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(initial.graphStatus).toBe('interrupted');
    expect(initial.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requestId: 'request-1',
      requests: [
        expect.objectContaining({ requestId: 'request-1' }),
        expect.objectContaining({ requestId: 'request-2' }),
      ],
    });

    const finalized = await resumeAgentGraphTurn({
      threadId: 'trace-approval-chain-1',
      resume: {
        interruptKind: 'approval_review',
        decisions: [
          {
            requestId: 'request-1',
            status: 'approved',
            reviewerId: 'reviewer-1',
          },
          {
            requestId: 'request-2',
            status: 'approved',
            reviewerId: 'reviewer-1',
          },
        ],
        resumeTraceId: 'trace-approval-chain-1a',
      },
      context: {
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        apiKey: 'test-api-key',
        model: 'test-main-agent-model',
        temperature: 0.6,
        timeoutMs: 1_000,
        maxTokens: 500,
        activeToolNames: ['discord_admin_create_channel', 'discord_admin_create_role'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'component',
        invokerIsAdmin: true,
      },
    });

    expect(finalized.graphStatus).toBe('completed');
    expect(finalized.replyText).toContain('Done.');
    expect(executeApprovedReviewTaskMock).toHaveBeenCalledTimes(2);
    expect(createOrReuseApprovalReviewRequestFromSignalMock).toHaveBeenCalledTimes(2);
  });

  it('resets the active execution budget after an approval resume', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue(makeGraphConfig({ sliceMaxSteps: 1 }));
    createOrReuseApprovalReviewRequestFromSignalMock.mockResolvedValueOnce({
      request: {
        id: 'request-timeout-1',
        threadId: 'trace-approval-timeout-1',
        expiresAt: new Date('2026-03-14T00:00:00.000Z'),
      },
      coalesced: false,
    });
    modelInvokeMock
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call-timeout-1',
              name: 'discord_admin_update_server_instructions',
              args: { reason: 'sync' },
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeFinishTurnMessage('final_answer', 'Done after approval.'))
      .mockResolvedValue(makeFinishTurnMessage('final_answer', 'Done after approval.'));
    prepareToolApprovalInterruptMock.mockResolvedValueOnce({
      toolName: 'discord_admin_update_server_instructions',
      callId: 'call-timeout-1',
      call: {
        id: 'call-timeout-1',
        name: 'discord_admin_update_server_instructions',
        args: { reason: 'sync' },
      },
      payload: {
        kind: 'server_instructions_update',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        sourceMessageId: null,
        requestedBy: 'user-1',
        dedupeKey: 'dedupe-timeout-1',
        executionPayloadJson: { next: 'value' },
        reviewSnapshotJson: { action: 'update_server_instructions' },
        interruptMetadataJson: { action: 'update_server_instructions' },
      },
      approvalGroupKey: 'discord_admin:server_instructions',
    });
    executeApprovedReviewTaskMock.mockResolvedValueOnce(
      makeToolTaskOutcome({
        toolName: 'discord_admin_update_server_instructions',
        callId: 'call-timeout-1',
        content: '{"status":"executed"}',
        structuredContent: { status: 'executed' },
        latencyMs: 0,
      }),
    );

    const initial = await runAgentGraphTurn({
      traceId: 'trace-approval-timeout-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'update the server persona' })],
      activeToolNames: ['discord_admin_update_server_instructions'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(initial.graphStatus).toBe('interrupted');

    const resumed = await resumeAgentGraphTurn({
      threadId: 'trace-approval-timeout-1',
      resume: {
        interruptKind: 'approval_review',
        decisions: [{ requestId: 'request-timeout-1', status: 'approved', reviewerId: 'reviewer-1' }],
        resumeTraceId: 'trace-approval-timeout-1b',
      },
      context: {
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        apiKey: 'test-api-key',
        model: 'test-main-agent-model',
        temperature: 0.6,
        timeoutMs: 1_000,
        maxTokens: 500,
        activeToolNames: ['discord_admin_update_server_instructions'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'component',
        invokerIsAdmin: true,
      },
    });

    expect(resumed.graphStatus).toBe('completed');
    expect(resumed.stopReason).toBe('assistant_turn_completed');
    expect(resumed.completionKind).toBe('final_answer');
    expect(resumed.deliveryDisposition).toBe('response_session');
    expect(resumed.replyText).toContain('Done after approval.');
  });

  it('resumes approval interrupts on the same graph thread after the decision arrives', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue(makeGraphConfig({ sliceMaxSteps: 1 }));
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call-continue-1',
            name: 'discord_admin_update_server_instructions',
            args: { reason: 'sync' },
            type: 'tool_call',
          },
        ],
      }),
    );
    prepareToolApprovalInterruptMock.mockResolvedValueOnce({
      toolName: 'discord_admin_update_server_instructions',
      callId: 'call-continue-1',
      call: {
        id: 'call-continue-1',
        name: 'discord_admin_update_server_instructions',
        args: { reason: 'sync' },
      },
      payload: {
        kind: 'server_instructions_update',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        sourceMessageId: null,
        requestedBy: 'user-1',
        dedupeKey: 'dedupe-continue-1',
        executionPayloadJson: { reason: 'sync' },
        reviewSnapshotJson: { reason: 'sync' },
        interruptMetadataJson: { reason: 'sync' },
      },
      approvalGroupKey: 'discord_admin:server_instructions',
    });
    executeApprovedReviewTaskMock.mockResolvedValueOnce(
      makeToolTaskOutcome({
        toolName: 'discord_admin_update_server_instructions',
        callId: 'call-continue-1',
        content: '{"status":"executed"}',
        structuredContent: { status: 'executed' },
        latencyMs: 0,
      }),
    );

    const initial = await runAgentGraphTurn({
      traceId: 'trace-resume-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'update the server persona' })],
      activeToolNames: ['discord_admin_update_server_instructions'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(initial.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requestId: 'request-1',
    });

    modelInvokeMock.mockResolvedValueOnce(makeFinishTurnMessage('final_answer', 'All set.'));

    const resumed = await resumeAgentGraphTurn({
      threadId: 'trace-resume-1',
      resume: {
        interruptKind: 'approval_review',
        decisions: [
          {
            requestId: 'request-1',
            status: 'approved',
            reviewerId: 'user-1',
          },
        ],
        resumeTraceId: 'trace-resume-1b',
      },
      context: {
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        apiKey: 'test-api-key',
        model: 'test-main-agent-model',
        temperature: 0.6,
        timeoutMs: 1_000,
        maxTokens: 500,
        activeToolNames: ['discord_admin_update_server_instructions'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'component',
        invokerIsAdmin: true,
      },
    });

    expect(resumed.graphStatus).toBe('completed');
    expect(resumed.replyText).toContain('All set.');
  });

  it('drops trusted waiting-follow-up state from persisted resume context after the waiting question is consumed', async () => {
    await shutdownAgentGraphRuntime();
    modelInvokeMock.mockResolvedValueOnce(
      makeFinishTurnMessage('clarification_question', 'Do you want me to keep digging into the repo?'),
    );

    const initial = await runAgentGraphTurn({
      traceId: 'trace-waiting-followup-clear-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'check the repo owner' })],
      activeToolNames: ['web_search'],
      routeKind: 'single',
      currentTurn: {
        invokerUserId: 'user-1',
        invokerDisplayName: 'User One',
        messageId: 'message-waiting-followup-clear-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        invokedBy: 'mention',
        mentionedUserIds: [],
        isDirectReply: false,
        replyTargetMessageId: null,
        replyTargetAuthorId: null,
        botUserId: 'sage-bot',
      },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: false,
    });

    expect(initial.completionKind).toBe('clarification_question');
    modelInvokeMock.mockResolvedValueOnce(
      makeFinishTurnMessage('final_answer', 'I kept digging and found the repo details.'),
    );

    const resumed = await continueAgentGraphTurn({
      threadId: 'trace-waiting-followup-clear-1',
      runId: 'trace-waiting-followup-clear-1b',
      runName: 'sage_agent_user_input_resume',
      context: {
        traceId: 'trace-waiting-followup-clear-1b',
        threadId: 'trace-waiting-followup-clear-1',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        apiKey: 'test-api-key',
        model: 'test-main-agent-model',
        temperature: 0.6,
        timeoutMs: 1_000,
        maxTokens: 500,
        invokedBy: 'reply',
        invokerIsAdmin: false,
        invokerCanModerate: false,
        activeToolNames: ['web_search'],
        routeKind: 'user_input_resume',
        currentTurn: {
          invokerUserId: 'user-1',
          invokerDisplayName: 'User One',
          messageId: 'message-waiting-followup-clear-2',
          guildId: 'guild-1',
          channelId: 'channel-1',
          invokedBy: 'reply',
          mentionedUserIds: [],
          isDirectReply: true,
          replyTargetMessageId: 'response-waiting-followup-clear-1',
          replyTargetAuthorId: 'sage-bot',
          botUserId: 'sage-bot',
        },
        replyTarget: null,
        promptMode: 'waiting_follow_up',
        waitingFollowUp: {
          matched: true,
          matchKind: 'direct_reply',
          outstandingPrompt: 'Do you want me to keep digging into the repo?',
          responseMessageId: 'response-waiting-followup-clear-1',
        },
      },
      appendedMessages: [new HumanMessage({ content: 'Proceed' })],
      clearWaitingState: true,
    });

    expect(resumed.graphStatus).toBe('completed');
    expect(resumed.responseSession).toMatchObject({
      responseSessionId: 'trace-waiting-followup-clear-1b',
      sourceMessageId: 'message-waiting-followup-clear-2',
      responseMessageId: null,
    });
    const checkpointState = await __getAgentGraphStateForTests('trace-waiting-followup-clear-1');
    expect(checkpointState?.resumeContext.waitingFollowUp).toBeNull();
    expect(checkpointState?.resumeContext.promptMode).toBe('standard');
    expect(checkpointState?.responseSession).toMatchObject({
      responseSessionId: 'trace-waiting-followup-clear-1b',
      sourceMessageId: 'message-waiting-followup-clear-2',
      responseMessageId: null,
    });
  });

  it('treats short actionable input requests as clarification questions even without a trailing question mark', async () => {
    await shutdownAgentGraphRuntime();
    modelInvokeMock.mockResolvedValueOnce(
      makeFinishTurnMessage('clarification_question', 'Tell me which repo to inspect next.'),
    );

    const result = await runAgentGraphTurn({
      traceId: 'trace-clarification-no-question-mark-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      apiKey: 'test-api-key',
      model: 'test-main-agent-model',
      temperature: 0.6,
      timeoutMs: 1_000,
      maxTokens: 500,
      messages: [new HumanMessage({ content: 'check bluegaming repos' })],
      activeToolNames: ['web_search'],
      routeKind: 'single',
      currentTurn: {
        invokerUserId: 'user-1',
        invokerDisplayName: 'User One',
        messageId: 'message-clarification-no-question-mark-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        invokedBy: 'mention',
        mentionedUserIds: [],
        isDirectReply: false,
        replyTargetMessageId: null,
        replyTargetAuthorId: null,
        botUserId: 'sage-bot',
      },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: false,
    });

    expect(result.completionKind).toBe('clarification_question');
    expect(result.stopReason).toBe('user_input_interrupt');
    expect(result.waitingState).toMatchObject({
      kind: 'user_input',
      prompt: 'Tell me which repo to inspect next.',
    });
    expect(result.responseSession.status).toBe('waiting_user_input');
  });
});

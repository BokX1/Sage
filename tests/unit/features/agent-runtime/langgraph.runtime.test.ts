import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

const {
  loggerWarnMock,
  loggerInfoMock,
  modelInvokeMock,
  getLastAiToolCallsMock,
  buildAgentGraphConfigMock,
  executeDurableToolTaskMock,
  executeApprovedReviewTaskMock,
  prepareToolApprovalInterruptMock,
  createGraphContinuationSessionMock,
  consumeGraphContinuationSessionMock,
  createOrReuseApprovalReviewRequestFromSignalMock,
} = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  modelInvokeMock: vi.fn<() => Promise<unknown>>(async () => new HumanMessage({ content: 'unused' })),
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
  executeApprovedReviewTaskMock: vi.fn(),
  prepareToolApprovalInterruptMock: vi.fn(),
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
  consumeGraphContinuationSessionMock: vi.fn(async () => ({
    id: 'cont-1',
    threadId: 'trace-pause-1',
    originTraceId: 'trace-pause-1',
    latestTraceId: 'trace-resume-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    requestedByUserId: 'user-1',
    status: 'resumed',
    pauseKind: 'step_window_exhausted',
    completedWindows: 1,
    maxWindows: 4,
    summaryText: 'summary',
    resumeNode: 'llm_call',
    expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    createdAt: new Date('2026-03-14T00:00:00.000Z'),
    updatedAt: new Date('2026-03-14T00:00:00.000Z'),
  })),
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
    info: loggerInfoMock,
    error: vi.fn(),
  },
}));

vi.mock('@/features/admin/adminActionService', () => ({
  createOrReuseApprovalReviewRequestFromSignal: createOrReuseApprovalReviewRequestFromSignalMock,
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
  executeApprovedReviewTask: executeApprovedReviewTaskMock,
  executeDurableToolTask: executeDurableToolTaskMock,
  prepareToolApprovalInterrupt: prepareToolApprovalInterruptMock,
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
  consumeGraphContinuationSession: consumeGraphContinuationSessionMock,
}));

import {
  __getAgentGraphStateForTests,
  __runAgentGraphCommandForTests,
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
    pendingWriteCalls: [],
    replyText: '',
    toolResults: [],
    files: [],
    roundsCompleted: 1,
    completedWindows: 1,
    totalRoundsCompleted: 1,
    deduplicatedCallCount: 0,
    truncatedCallCount: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      completedAt: '2026-03-13T09:30:00.000Z',
      terminationReason: 'approval_interrupt',
    },
    terminationReason: 'approval_interrupt',
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
    executeApprovedReviewTaskMock.mockReset();
    prepareToolApprovalInterruptMock.mockReset();
    prepareToolApprovalInterruptMock.mockResolvedValue(null);
    createGraphContinuationSessionMock.mockClear();
    consumeGraphContinuationSessionMock.mockClear();
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
    expect(createGraphContinuationSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'trace-pause-1',
        channelId: 'channel-1',
        requestedByUserId: 'user-1',
        completedWindows: 1,
        resumeNode: 'llm_call',
      }),
    );
    expect(result.replyText).toContain('another continuation window');
    expect(modelInvokeMock).toHaveBeenCalledTimes(1);
  });

  it('preserves graph_timeout when a continuation pause is caused by the active runtime budget', async () => {
    await shutdownAgentGraphRuntime();
    buildAgentGraphConfigMock.mockReturnValue({
      maxSteps: 2,
      maxToolCallsPerStep: 3,
      toolTimeoutMs: 1_000,
      maxResultChars: 4_000,
      maxDurationMs: 1,
      recursionLimit: 8,
      githubGroundedMode: false,
    });
    modelInvokeMock.mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call-time-budget-1',
            name: 'discord_admin',
            args: { action: 'clear_server_api_key' },
            type: 'tool_call',
          },
        ],
      }),
    );
    executeDurableToolTaskMock.mockResolvedValueOnce({
      kind: 'tool_result',
      toolName: 'discord_admin',
      callId: 'call-time-budget-1',
      content: '{"ok":true}',
      result: {
        name: 'discord_admin',
        success: true,
        result: { ok: true },
        latencyMs: 12,
      },
      files: [],
    });

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
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(result.graphStatus).toBe('interrupted');
    expect(result.terminationReason).toBe('graph_timeout');
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'continue_prompt',
      pauseReason: 'graph_timeout',
    });
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
    expect(result.terminationReason).toBe('approval_interrupt');
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
    expect(result.terminationReason).toBe('approval_interrupt');
    expect(result.pendingInterrupt).toMatchObject({
      kind: 'approval_review',
      requestId: 'request-1',
    });
  });

  it('does not persist provider api keys in checkpointed graph state', async () => {
    modelInvokeMock.mockResolvedValueOnce(new AIMessage({ content: 'Done.' }));

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
              name: 'discord_admin',
              args: { action: 'create_channel', name: 'ops-summary' },
              type: 'tool_call',
            },
            {
              id: 'call-approve-2',
              name: 'discord_admin',
              args: { action: 'create_role', name: 'ops-summary-role' },
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new AIMessage({ content: 'Done.' }));
    prepareToolApprovalInterruptMock
      .mockResolvedValueOnce({
        toolName: 'discord_admin',
        callId: 'call-approve-1',
        call: {
          id: 'call-approve-1',
          name: 'discord_admin',
          args: { action: 'create_channel', name: 'ops-summary' },
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
        toolName: 'discord_admin',
        callId: 'call-approve-2',
        call: {
          id: 'call-approve-2',
          name: 'discord_admin',
          args: { action: 'create_role', name: 'ops-summary-role' },
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
      .mockResolvedValueOnce({
        status: 'executed',
        content: '{"status":"executed","step":1}',
        result: {
          name: 'discord_admin',
          success: true,
          result: { step: 1, status: 'executed' },
          latencyMs: 10,
        },
        files: [],
        callId: 'call-approve-1',
        toolName: 'discord_admin',
      })
      .mockResolvedValueOnce({
        status: 'executed',
        content: '{"status":"executed","step":2}',
        result: {
          name: 'discord_admin',
          success: true,
          result: { step: 2, status: 'executed' },
          latencyMs: 10,
        },
        files: [],
        callId: 'call-approve-2',
        toolName: 'discord_admin',
      });

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
      activeToolNames: ['discord_admin'],
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
        activeToolNames: ['discord_admin'],
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
    buildAgentGraphConfigMock.mockReturnValue({
      maxSteps: 2,
      maxToolCallsPerStep: 3,
      toolTimeoutMs: 1_000,
      maxResultChars: 4_000,
      maxDurationMs: 1,
      recursionLimit: 8,
      githubGroundedMode: false,
    });
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
              name: 'discord_admin',
              args: { action: 'update_server_instructions' },
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new AIMessage({ content: 'Done after approval.' }));
    prepareToolApprovalInterruptMock.mockResolvedValueOnce({
      toolName: 'discord_admin',
      callId: 'call-timeout-1',
      call: {
        id: 'call-timeout-1',
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
        dedupeKey: 'dedupe-timeout-1',
        executionPayloadJson: { next: 'value' },
        reviewSnapshotJson: { action: 'update_server_instructions' },
        interruptMetadataJson: { action: 'update_server_instructions' },
      },
      approvalGroupKey: 'discord_admin:server_instructions',
    });
    executeApprovedReviewTaskMock.mockResolvedValueOnce({
      status: 'executed',
      content: '{"status":"executed"}',
      result: {
        name: 'discord_admin',
        success: true,
        result: { status: 'executed' },
        latencyMs: 0,
      },
      files: [],
      callId: 'call-timeout-1',
      toolName: 'discord_admin',
    });

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
      activeToolNames: ['discord_admin'],
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
        activeToolNames: ['discord_admin'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'component',
        invokerIsAdmin: true,
      },
    });

    expect(resumed.graphStatus).toBe('completed');
    expect(resumed.terminationReason).toBe('assistant_reply');
    expect(resumed.replyText).toContain('Done after approval.');
  });

  it('consumes continuation sessions before resuming the graph', async () => {
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
            id: 'call-continue-1',
            name: 'discord_admin',
            args: { action: 'update_server_instructions' },
            type: 'tool_call',
          },
        ],
      }),
    );
    executeDurableToolTaskMock.mockResolvedValueOnce({
      kind: 'tool_result',
      toolName: 'discord_admin',
      callId: 'call-continue-1',
      content: '{"ok":true}',
      result: {
        name: 'discord_admin',
        success: true,
        result: { ok: true },
        latencyMs: 12,
      },
      files: [],
    });

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
      activeToolNames: ['discord_admin'],
      routeKind: 'single',
      currentTurn: { invokerUserId: 'user-1' },
      replyTarget: null,
      invokedBy: 'mention',
      invokerIsAdmin: true,
    });

    expect(initial.pendingInterrupt).toMatchObject({
      kind: 'continue_prompt',
      continuationId: 'cont-1',
    });

    modelInvokeMock.mockResolvedValueOnce(new AIMessage({ content: 'All set.' }));

    const resumed = await resumeAgentGraphTurn({
      threadId: 'trace-resume-1',
      resume: {
        interruptKind: 'continue_prompt',
        decision: 'continue',
        continuationId: 'cont-1',
        resumedByUserId: 'user-1',
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
        activeToolNames: ['discord_admin'],
        routeKind: 'single',
        currentTurn: { invokerUserId: 'user-1' },
        replyTarget: null,
        invokedBy: 'component',
        invokerIsAdmin: true,
      },
    });

    expect(consumeGraphContinuationSessionMock).toHaveBeenCalledWith({
      id: 'cont-1',
      latestTraceId: 'trace-resume-1b',
    });
    expect(resumed.graphStatus).toBe('completed');
    expect(resumed.replyText).toContain('All set.');
  });
});

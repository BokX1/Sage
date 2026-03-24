import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

const {
  upsertTraceStartMock,
  updateTraceEndMock,
  buildPromptContextMessagesMock,
  globalToolRegistryMock,
  runAgentGraphTurnMock,
  continueAgentGraphTurnMock,
  retryAgentGraphTurnMock,
  getApprovalReviewRequestByIdMock,
  upsertAgentTaskRunMock,
  getAgentTaskRunByThreadIdMock,
  findWaitingUserInputTaskRunMock,
  queueRunningTaskRunActiveInterruptMock,
  updateAgentTaskRunByThreadIdMock,
  releaseAgentTaskRunLeaseMock,
} = vi.hoisted(() => ({
  upsertTraceStartMock: vi.fn(),
  updateTraceEndMock: vi.fn(),
  buildPromptContextMessagesMock: vi.fn(() => ({
    version: 'test-prompt-v1',
    systemMessage: 'system',
    workingMemoryFrame: {
      objective: 'Finish the request.',
      verifiedFacts: [],
      completedActions: [],
      openQuestions: [],
      pendingApprovals: [],
      deliveryState: 'none',
      nextAction: 'Close the turn.',
    },
    promptFingerprint: 'fingerprint-1',
    messages: [new HumanMessage({ content: 'hello' })],
  })),
  globalToolRegistryMock: {
    listNames: vi.fn(() => []),
    get: vi.fn(
      (
        name: string,
      ):
        | {
            metadata?: { access?: 'public' | 'moderator' | 'admin' | 'owner' };
            runtime?: {
              access?: 'public' | 'moderator' | 'admin' | 'owner';
              capabilityTags?: string[];
            };
          }
        | undefined => {
        void name;
        return undefined;
      },
    ),
  },
  runAgentGraphTurnMock: vi.fn(),
  continueAgentGraphTurnMock: vi.fn(),
  retryAgentGraphTurnMock: vi.fn(),
  getApprovalReviewRequestByIdMock: vi.fn(),
  upsertAgentTaskRunMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  getAgentTaskRunByThreadIdMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  findWaitingUserInputTaskRunMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  queueRunningTaskRunActiveInterruptMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => 'stale'),
  updateAgentTaskRunByThreadIdMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  releaseAgentTaskRunLeaseMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    CONTEXT_TRANSCRIPT_MAX_MESSAGES: 10,
    AI_PROVIDER_API_KEY: 'test-api-key',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
    CHAT_MAX_OUTPUT_TOKENS: 500,
    AGENT_GRAPH_MAX_OUTPUT_TOKENS: 500,
    AGENT_RUN_SLICE_MAX_STEPS: 2,
    AGENT_RUN_TOOL_TIMEOUT_MS: 1000,
    AGENT_RUN_SLICE_MAX_DURATION_MS: 5000,
    AGENT_RUN_MAX_TOTAL_DURATION_MS: 3600000,
    AGENT_RUN_MAX_IDLE_WAIT_MS: 86400000,
    AGENT_RUN_WORKER_POLL_MS: 5000,
    AGENT_RUN_LEASE_TTL_MS: 30000,
    AGENT_RUN_HEARTBEAT_MS: 5000,
    AGENT_RUN_MAX_RESUMES: 50,
    AGENT_RUN_COMPACTION_ENABLED: true,
    AGENT_RUN_COMPACTION_TRIGGER_EST_TOKENS: 8000,
    AGENT_RUN_COMPACTION_TRIGGER_ROUNDS: 3,
    AGENT_RUN_COMPACTION_TRIGGER_TOOL_RESULTS: 6,
    AGENT_RUN_COMPACTION_MAX_RAW_MESSAGES: 12,
    AGENT_RUN_COMPACTION_MAX_TOOL_OBSERVATIONS: 8,
    AGENT_GRAPH_RECURSION_LIMIT: 8,
    TIMEOUT_CHAT_MS: 1000,
    SAGE_TRACE_DB_ENABLED: true,
    LANGSMITH_TRACING: false,
    AUTOPILOT_MODE: null,
  },
}));

vi.mock('@/features/awareness/channelRingBuffer', () => ({
  getRecentMessages: vi.fn(() => []),
}));

vi.mock('@/features/awareness/transcriptBuilder', () => ({
  buildTranscriptBlock: vi.fn(() => null),
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApiKey: vi.fn(async () => null),
}));

vi.mock('@/features/auth/hostCodexAuthService', () => ({
  resolveHostCodexAccessToken: vi.fn(async () => undefined),
}));

vi.mock('@/features/settings/guildSagePersonaRepo', () => ({
  getGuildSagePersonaText: vi.fn(async () => null),
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(() => false),
}));

vi.mock('@/platform/logging/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/features/agent-runtime/agent-trace-repo', () => ({
  upsertTraceStart: upsertTraceStartMock,
  updateTraceEnd: updateTraceEndMock,
}));

vi.mock('@/features/agent-runtime/promptContract', () => ({
  buildPromptContextMessages: buildPromptContextMessagesMock,
}));

vi.mock('@/features/agent-runtime/langgraph/runtime', () => ({
  runAgentGraphTurn: runAgentGraphTurnMock,
  continueAgentGraphTurn: continueAgentGraphTurnMock,
  retryAgentGraphTurn: retryAgentGraphTurnMock,
}));

vi.mock('@/features/agent-runtime/autopilotMode', () => ({
  resolveRuntimeAutopilotMode: vi.fn(() => null),
}));

vi.mock('@/features/agent-runtime/toolRegistry', () => ({
  globalToolRegistry: globalToolRegistryMock,
}));

vi.mock('@/features/admin/approvalReviewRequestRepo', () => ({
  getApprovalReviewRequestById: getApprovalReviewRequestByIdMock,
}));

vi.mock('@/features/agent-runtime/agentTaskRunRepo', () => ({
  upsertAgentTaskRun: upsertAgentTaskRunMock,
  getAgentTaskRunByThreadId: getAgentTaskRunByThreadIdMock,
  findWaitingUserInputTaskRun: findWaitingUserInputTaskRunMock,
  queueRunningTaskRunActiveInterrupt: queueRunningTaskRunActiveInterruptMock,
  readActiveUserInterruptState: vi.fn((taskRun: Record<string, unknown>) => {
    const payload = taskRun.activeUserInterruptJson as Record<string, unknown> | null;
    if (!payload || typeof payload.userText !== 'string') {
      return null;
    }
    return {
      payload: {
        messageId: payload.messageId,
        userId: payload.userId,
        channelId: payload.channelId,
        guildId: payload.guildId,
        userText: payload.userText,
        userContent: payload.userContent,
      },
      revision: taskRun.activeUserInterruptRevision ?? 0,
      consumedRevision: taskRun.activeUserInterruptConsumedRevision ?? 0,
      queuedAt: taskRun.activeUserInterruptQueuedAt ?? null,
      consumedAt: taskRun.activeUserInterruptConsumedAt ?? null,
      supersededAt: taskRun.activeUserInterruptSupersededAt ?? null,
      supersededRevision: taskRun.activeUserInterruptSupersededRevision ?? null,
    };
  }),
  updateAgentTaskRunByThreadId: updateAgentTaskRunByThreadIdMock,
  releaseAgentTaskRunLease: releaseAgentTaskRunLeaseMock,
}));

vi.mock('@/features/voice/voiceConversationSessionStore', () => ({
  formatLiveVoiceContext: vi.fn(() => null),
}));

import {
  attachTaskRunResponseSession as attachTaskRunResponseSessionImpl,
  continueMatchedTaskRunWithInput as continueMatchedTaskRunWithInputImpl,
  queueActiveRunUserInterrupt,
  resumeBackgroundTaskRun as resumeBackgroundTaskRunImpl,
  resumeWaitingTaskRunWithInput as resumeWaitingTaskRunWithInputImpl,
  retryFailedChatTurn as retryFailedChatTurnImpl,
  runChatTurn as runChatTurnImpl,
} from '@/features/agent-runtime/agentRuntime';
import { scrubFinalReplyText } from '@/features/agent-runtime/finalReplyScrubber';
import { AppError } from '@/shared/errors/app-error';

type RoutedParam<T> = Omit<T, 'originChannelId' | 'responseChannelId'> & {
  channelId?: string;
  originChannelId?: string;
  responseChannelId?: string;
};

function withRouting<T extends { originChannelId: string; responseChannelId: string }>(
  params: RoutedParam<T>,
): T {
  const responseChannelId = params.responseChannelId ?? params.channelId ?? 'channel-1';
  const originChannelId = params.originChannelId ?? params.channelId ?? responseChannelId;
  return {
    ...params,
    originChannelId,
    responseChannelId,
  } as T;
}

const runChatTurn = (params: RoutedParam<Parameters<typeof runChatTurnImpl>[0]>) =>
  runChatTurnImpl(withRouting(params));
const retryFailedChatTurn = (params: RoutedParam<Parameters<typeof retryFailedChatTurnImpl>[0]>) =>
  retryFailedChatTurnImpl(withRouting(params));
const resumeWaitingTaskRunWithInput = (
  params: RoutedParam<Parameters<typeof resumeWaitingTaskRunWithInputImpl>[0]>,
) => resumeWaitingTaskRunWithInputImpl(withRouting(params));
const continueMatchedTaskRunWithInput = (
  params: RoutedParam<Parameters<typeof continueMatchedTaskRunWithInputImpl>[0]>,
) => continueMatchedTaskRunWithInputImpl(withRouting(params));
const resumeBackgroundTaskRun = (
  params: RoutedParam<Parameters<typeof resumeBackgroundTaskRunImpl>[0]>,
) => resumeBackgroundTaskRunImpl(withRouting(params));
const attachTaskRunResponseSession = (
  params: RoutedParam<Parameters<typeof attachTaskRunResponseSessionImpl>[0]>,
) =>
  attachTaskRunResponseSessionImpl({
    ...params,
    originChannelId: params.originChannelId ?? params.channelId,
    responseChannelId: params.responseChannelId ?? params.channelId,
  });

function makeCurrentTurn(
  overrides: Partial<CurrentTurnContext> & { channelId?: string } = {},
): CurrentTurnContext {
  const responseChannelId = overrides.responseChannelId ?? overrides.channelId ?? 'channel-1';
  const originChannelId = overrides.originChannelId ?? overrides.channelId ?? responseChannelId;
  return {
    invokerUserId: 'user-1',
    invokerDisplayName: 'User One',
    messageId: 'message-1',
    guildId: 'guild-1',
    originChannelId,
    responseChannelId,
    invokedBy: 'mention',
    mentionedUserIds: [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: 'sage-bot',
    ...overrides,
  };
}

function makeGraphResult(overrides: Record<string, unknown> = {}) {
  return {
    replyText: 'Visible reply',
    toolResults: [],
    files: [],
    roundsCompleted: 0,
    sliceIndex: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      completedAt: '2026-03-12T00:00:00.000Z',
      stopReason: 'assistant_turn_completed',
      completionKind: 'final_answer',
      deliveryDisposition: 'response_session',
      finalizedBy: 'assistant_no_tool_calls',
      draftRevision: 1,
      contextFrame: {
        objective: 'Finish the request.',
        verifiedFacts: [],
        completedActions: [],
        openQuestions: [],
        pendingApprovals: [],
        deliveryState: 'none',
        nextAction: 'Close out the turn.',
      },
    },
    completionKind: 'final_answer',
    stopReason: 'assistant_turn_completed',
    deliveryDisposition: 'response_session',
    contextFrame: {
      objective: 'Finish the request.',
      verifiedFacts: [],
      completedActions: [],
      openQuestions: [],
      pendingApprovals: [],
      deliveryState: 'none',
      nextAction: 'Close out the turn.',
    },
    responseSession: {
      responseSessionId: 'trace-1',
      status: 'final',
      latestText: 'Visible reply',
      draftRevision: 1,
      sourceMessageId: 'message-1',
      responseMessageId: 'response-1',
      linkedArtifactMessageIds: [],
    },
    artifactDeliveries: [],
    waitingState: null,
    compactionState: null,
    yieldReason: null,
    graphStatus: 'completed',
    pendingInterrupt: null,
    interruptResolution: null,
    activeWindowDurationMs: 0,
    langSmithRunId: null,
    langSmithTraceId: null,
    ...overrides,
  };
}

describe('agentRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPromptContextMessagesMock.mockReturnValue({
      version: 'test-prompt-v1',
      systemMessage: 'system',
      workingMemoryFrame: {
        objective: 'Finish the request.',
        verifiedFacts: [],
        completedActions: [],
        openQuestions: [],
        pendingApprovals: [],
        deliveryState: 'none',
        nextAction: 'Close the turn.',
      },
      promptFingerprint: 'fingerprint-1',
      messages: [new HumanMessage({ content: 'hello' })],
    });
    globalToolRegistryMock.listNames.mockReturnValue([]);
    globalToolRegistryMock.get.mockReturnValue(undefined);
    upsertTraceStartMock.mockResolvedValue(undefined);
    updateTraceEndMock.mockResolvedValue(undefined);
    runAgentGraphTurnMock.mockReset();
    continueAgentGraphTurnMock.mockReset();
    retryAgentGraphTurnMock.mockReset();
    getApprovalReviewRequestByIdMock.mockReset();
    getApprovalReviewRequestByIdMock.mockResolvedValue(null);
    upsertAgentTaskRunMock.mockReset();
    upsertAgentTaskRunMock.mockResolvedValue(undefined);
    getAgentTaskRunByThreadIdMock.mockReset();
    getAgentTaskRunByThreadIdMock.mockResolvedValue(null);
    findWaitingUserInputTaskRunMock.mockReset();
    findWaitingUserInputTaskRunMock.mockResolvedValue(null);
    queueRunningTaskRunActiveInterruptMock.mockReset();
    queueRunningTaskRunActiveInterruptMock.mockResolvedValue('stale');
    updateAgentTaskRunByThreadIdMock.mockReset();
    updateAgentTaskRunByThreadIdMock.mockResolvedValue(undefined);
    releaseAgentTaskRunLeaseMock.mockReset();
    releaseAgentTaskRunLeaseMock.mockResolvedValue(undefined);
  });

  it('scrubs tool narration and raw approval payloads from final reply text', () => {
    const scrubbed = scrubFinalReplyText({
      replyText: [
        'I will call `discord_admin` now.',
        '```json',
        '{"action":"update_server_instructions","reason":"sync"}',
        '```',
        'Queued for review.',
      ].join('\n'),
    });

    expect(scrubbed).toBe('Queued for review.');
  });

  it('suppresses the normal chat reply when approval is queued', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['discord_admin'] as never);
    globalToolRegistryMock.get.mockReturnValue({ metadata: { access: 'admin' } } as never);
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: '',
        graphStatus: 'interrupted',
        completionKind: 'approval_handoff',
        stopReason: 'approval_interrupt',
        deliveryDisposition: 'approval_governance_only',
        pendingInterrupt: {
          kind: 'approval_review',
          requestId: 'request-1',
          coalesced: false,
          expiresAtIso: '2026-03-12T00:10:00.000Z',
          payload: {
            kind: 'server_instructions_update',
          },
        },
      }),
    );

    const result = await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-1',
      userText: 'update the Sage Persona',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn(),
      invokedBy: 'mention',
      isAdmin: true,
    });

    expect(result.replyText).toBe('');
    expect(result.delivery).toBe('approval_governance_only');
    expect(result.meta).toEqual({
      approvalReview: {
        requestId: 'request-1',
        reviewChannelId: '',
        sourceChannelId: '',
      },
    });
    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trace-1',
        approvalRequestId: 'request-1',
        replyText: '',
      }),
    );
  });

  it('does not persist removed task-state metadata into trace budgets', async () => {
    runAgentGraphTurnMock.mockResolvedValue(makeGraphResult());

    const result = await runChatTurn({
      traceId: 'trace-task-state',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-1',
      userText: 'summarize what you found',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn(),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(result.debug).toEqual(
      expect.objectContaining({
        promptVersion: 'test-prompt-v1',
        promptFingerprint: 'fingerprint-1',
      }),
    );
    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetJson: expect.objectContaining({
          promptVersion: 'test-prompt-v1',
          promptFingerprint: 'fingerprint-1',
        }),
        tokenJson: expect.objectContaining({
          promptVersion: 'test-prompt-v1',
          promptFingerprint: 'fingerprint-1',
        }),
      }),
    );
    expect(updateTraceEndMock.mock.calls.at(-1)?.[0]?.budgetJson).not.toHaveProperty('taskState');
  });

  it('does not persist provider reasoning text into traces', async () => {
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Visible reply',
      }),
    );

    await runChatTurn({
      traceId: 'trace-2',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: null,
      messageId: 'message-2',
      userText: 'hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'message-2',
        guildId: null,
      }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trace-2',
        replyText: 'Visible reply',
      }),
    );
    expect(updateTraceEndMock.mock.calls.at(-1)?.[0]).not.toHaveProperty('reasoningText');
  });

  it('uses provider-aware failure copy and exposes retry metadata when the initial graph run throws a provider error', async () => {
    runAgentGraphTurnMock.mockRejectedValueOnce(
      new AppError(
        'AI_PROVIDER_UPSTREAM',
        'AI provider API error: 503 Service Unavailable - upstream down',
      ),
    );

    const result = await runChatTurn({
      traceId: 'trace-runtime-failed',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-runtime-failed',
      userText: 'hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'message-runtime-failed',
      }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(result.replyText).toBe('I lost the model connection before I could finish, so please try again.');
    expect(result.meta).toEqual({
      retry: {
        threadId: 'trace-runtime-failed',
        retryKind: 'turn',
      },
    });
    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        replyText:
          'I lost the model connection before I could finish, so please try again.',
      }),
    );
  });

  it('retries a failed turn on the same LangGraph thread', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['web', 'repo_search_code', 'discord_history_search_history'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => ({
      metadata: { access: 'public' as const },
      runtime: { access: 'public' as const, capabilityTags: name === 'web' ? ['web'] : ['developer'] },
    }));
    retryAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Recovered after retry.',
        pendingInterrupt: null,
      }),
    );

    const result = await retryFailedChatTurn({
      traceId: 'trace-retry-1',
      threadId: 'thread-original-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'member',
      retryKind: 'turn',
      isAdmin: false,
      canModerate: false,
    });

    expect(result.replyText).toBe('Recovered after retry.');
    expect(retryAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-original-1',
        context: expect.objectContaining({
          traceId: 'trace-retry-1',
          routeKind: 'turn_retry',
          activeToolNames: ['web', 'repo_search_code', 'discord_history_search_history'],
        }),
      }),
    );
  });

  it('persists the task run after a retry re-enters background execution', async () => {
    const now = Date.now();
    globalToolRegistryMock.listNames.mockReturnValue(['web_search'] as never);
    globalToolRegistryMock.get.mockImplementation(() => ({
      metadata: { access: 'public' as const },
      runtime: { access: 'public' as const, capabilityTags: [] },
    }));
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-retry-running-1',
      threadId: 'thread-retry-running-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-retry-1',
      responseMessageId: 'response-retry-1',
      status: 'failed',
      waitingKind: null,
      latestDraftText: 'I lost the model connection before I could finish, so please try again.',
      draftRevision: 3,
      completionKind: 'runtime_failure',
      stopReason: 'runtime_failure',
      nextRunnableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      resumeCount: 2,
      taskWallClockMs: 1_500,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: 'I lost the model connection before I could finish, so please try again.',
      responseSessionJson: {
        responseSessionId: 'thread-retry-running-1',
        status: 'failed',
        latestText: 'I lost the model connection before I could finish, so please try again.',
        draftRevision: 3,
        sourceMessageId: 'message-source-retry-1',
        responseMessageId: 'response-retry-1',
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: new Date(now - 30_000),
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 30_000),
    });
    retryAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Still working on that now.',
        stopReason: 'background_yield',
        completionKind: 'final_answer',
      }),
    );

    const result = await retryFailedChatTurn({
      traceId: 'trace-retry-running-1',
      threadId: 'thread-retry-running-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'member',
      retryKind: 'background_resume',
      isAdmin: false,
      canModerate: false,
    });

    expect(result.status).toBe('running');
    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-retry-running-1',
        status: 'running',
        sourceMessageId: 'message-source-retry-1',
        nextRunnableAt: expect.any(Date),
        resumeCount: 2,
      }),
    );
  });

  it('keeps all eligible tools available for generic follow-up resumes', async () => {
    const now = Date.now();
    globalToolRegistryMock.listNames.mockReturnValue([
      'web_search',
      'repo_search_code',
      'discord_history_search_history',
    ] as never);
    globalToolRegistryMock.get.mockImplementation(() => ({
      metadata: { access: 'public' as const },
      runtime: { access: 'public' as const, capabilityTags: [] },
    }));
    findWaitingUserInputTaskRunMock.mockResolvedValue({
      id: 'task-waiting-followup-1',
      threadId: 'thread-waiting-followup-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-1',
      responseMessageId: 'response-waiting-followup-1',
      status: 'waiting_user_input',
      waitingKind: 'user_input',
      latestDraftText: 'What should I look at next?',
      draftRevision: 2,
      completionKind: 'user_input_pending',
      stopReason: 'user_input_interrupt',
      nextRunnableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      resumeCount: 0,
      taskWallClockMs: 1_000,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: null,
      waitingStateJson: {
        kind: 'user_input',
        prompt: 'What should I look at next?',
      },
      compactionStateJson: null,
      checkpointMetadataJson: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 5_000),
    });
    continueAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'I dug further and found more evidence.',
        activeWindowDurationMs: 600,
      }),
    );

    await resumeWaitingTaskRunWithInput({
      traceId: 'trace-followup-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'member',
      replyToMessageId: 'response-waiting-followup-1',
      userText: 'deep dive this',
      currentTurn: makeCurrentTurn({
        messageId: 'message-followup-deep-dive-1',
        replyTargetMessageId: 'response-waiting-followup-1',
        isDirectReply: true,
      }),
      isAdmin: false,
    });

    expect(continueAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          activeToolNames: ['web_search', 'repo_search_code', 'discord_history_search_history'],
          promptMode: 'waiting_follow_up',
          waitingFollowUp: {
            matched: true,
            matchKind: 'direct_reply',
            outstandingPrompt: 'What should I look at next?',
            responseMessageId: 'response-waiting-followup-1',
          },
        }),
      }),
    );
  });

  it('does not expose admin-only tools to non-admin turns', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['web', 'discord_admin'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const access: 'public' | 'moderator' | 'admin' = name === 'discord_admin' ? 'admin' : 'public';
      return { metadata: { access } };
    });
    runAgentGraphTurnMock.mockResolvedValue(makeGraphResult({ replyText: 'ok' }));

    await runChatTurn({
      traceId: 'trace-2b',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-2b',
      userText: 'hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'message-2b',
      }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(runAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeToolNames: ['web'],
      }),
    );
  });

  it('exposes the full eligible tool surface on fresh turns without heuristic narrowing', async () => {
    globalToolRegistryMock.listNames.mockReturnValue([
      'web_search',
      'web_read',
      'web_read_page',
      'repo_search_code',
      'discord_history_search_history',
      'discord_spaces_list_channels',
      'repo_read_file',
      'image_generate',
      'system_time',
      'system_tool_stats',
    ] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const toolMap: Record<string, { metadata: { access: 'public' | 'moderator' | 'admin' | 'owner' }; runtime: { access: 'public' | 'moderator' | 'admin' | 'owner'; capabilityTags: string[]; class: string } }> = {
        web_search: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['web', 'search'], class: 'query' } },
        web_read: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['web', 'read'], class: 'query' } },
        web_read_page: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['web', 'read', 'paging'], class: 'query' } },
        repo_search_code: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['repo', 'developer'], class: 'query' } },
        discord_history_search_history: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['discord', 'messages'], class: 'query' } },
        discord_spaces_list_channels: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['discord', 'server'], class: 'query' } },
        repo_read_file: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['repo', 'developer', 'code'], class: 'query' } },
        image_generate: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['generation', 'image'], class: 'artifact' } },
        system_time: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['system', 'time'], class: 'query' } },
        system_tool_stats: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['system', 'tooling'], class: 'query' } },
      };
      return toolMap[name] as never;
    });
    runAgentGraphTurnMock.mockResolvedValue(makeGraphResult({ replyText: 'ok' }));

    await runChatTurn({
      traceId: 'trace-tool-plan-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-tool-plan-1',
      userText: 'Please research the latest OpenAI docs on the web.',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'message-tool-plan-1',
      }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    const activeToolNames = runAgentGraphTurnMock.mock.calls.at(-1)?.[0]?.activeToolNames as string[];
    expect(activeToolNames).toEqual([
      'web_search',
      'web_read',
      'web_read_page',
      'repo_search_code',
      'discord_history_search_history',
      'discord_spaces_list_channels',
      'repo_read_file',
      'image_generate',
      'system_time',
      'system_tool_stats',
    ]);
  });

  it('exposes discord_admin to moderator-only turns for moderation workflows', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['web', 'discord_moderation_submit_action'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const access: 'public' | 'moderator' | 'admin' =
        name === 'discord_moderation_submit_action' ? 'moderator' : 'public';
      return {
        metadata: { access },
        runtime: {
          access,
          capabilityTags: name === 'discord_moderation_submit_action' ? ['moderation'] : [],
        },
      };
    });
    runAgentGraphTurnMock.mockResolvedValue(makeGraphResult({ replyText: 'ok' }));

    await runChatTurn({
      traceId: 'trace-2b-moderator',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-2b-moderator',
      userText: 'clean up that spam burst',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'message-2b-moderator',
      }),
      invokedBy: 'mention',
      isAdmin: false,
      canModerate: true,
    });

    expect(runAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeToolNames: ['web', 'discord_moderation_submit_action'],
        invokerCanModerate: true,
      }),
    );
  });

  it('does not expose admin-only tools during autopilot turns even for admins', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['web', 'discord_admin'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const access: 'public' | 'moderator' | 'admin' = name === 'discord_admin' ? 'admin' : 'public';
      return { metadata: { access } };
    });
    runAgentGraphTurnMock.mockResolvedValue(makeGraphResult({ replyText: 'ok' }));

    await runChatTurn({
      traceId: 'trace-2c',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-2c',
      userText: 'hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'message-2c',
        invokedBy: 'autopilot',
      }),
      invokedBy: 'autopilot',
      isAdmin: true,
    });

    expect(runAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeToolNames: ['web'],
      }),
    );
  });

  it('keeps artifact writes and structural thread writes out of member turns', async () => {
    globalToolRegistryMock.listNames.mockReturnValue([
      'discord_artifact_list',
      'discord_artifact_replace',
      'discord_artifact_publish',
      'discord_spaces_list_channels',
      'discord_spaces_create_thread',
      'discord_spaces_add_thread_member',
    ] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const accessByName: Record<string, 'public' | 'moderator' | 'admin' | 'owner'> = {
        discord_artifact_list: 'public',
        discord_artifact_replace: 'admin',
        discord_artifact_publish: 'admin',
        discord_spaces_list_channels: 'public',
        discord_spaces_create_thread: 'admin',
        discord_spaces_add_thread_member: 'admin',
      };
      const access = accessByName[name] ?? 'public';
      return {
        metadata: { access },
        runtime: {
          access,
          capabilityTags: ['discord'],
          class: access === 'public' ? 'query' : 'mutation',
        },
      };
    });
    runAgentGraphTurnMock.mockResolvedValue(makeGraphResult({ replyText: 'ok' }));

    await runChatTurn({
      traceId: 'trace-discord-authority-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-discord-authority-1',
      userText: 'look up the artifact inventory and open a thread',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'message-discord-authority-1',
      }),
      invokedBy: 'mention',
      isAdmin: false,
      canModerate: false,
      invokerAuthority: 'member',
    });

    expect(runAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeToolNames: ['discord_artifact_list', 'discord_spaces_list_channels'],
      }),
    );
  });

  it('persists tool-loop termination metadata into trace budgets', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['web'] as never);
    globalToolRegistryMock.get.mockReturnValue({ metadata: { access: 'public' } } as never);
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Final answer',
        roundsCompleted: 2,
        sliceIndex: 1,
        finalization: {
          attempted: true,
          succeeded: true,
          completedAt: '2026-03-11T22:00:00.000Z',
          stopReason: 'background_yield',
          completionKind: 'final_answer',
          deliveryDisposition: 'response_session',
          finalizedBy: 'background_yield',
          draftRevision: 2,
        },
        completionKind: 'final_answer',
        stopReason: 'background_yield',
        deliveryDisposition: 'response_session',
        yieldReason: 'slice_budget_exhausted',
        responseSession: {
          responseSessionId: 'trace-3',
          status: 'draft',
          latestText: 'Final answer',
          draftRevision: 2,
          sourceMessageId: 'message-3',
          responseMessageId: 'response-3',
          linkedArtifactMessageIds: [],
        },
      }),
    );

    await runChatTurn({
      traceId: 'trace-3',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-3',
      userText: 'search twice',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'message-3',
      }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trace-3',
        budgetJson: expect.objectContaining({
          graphRuntime: expect.objectContaining({
            stopReason: 'background_yield',
            yieldReason: 'slice_budget_exhausted',
          }),
        }),
        toolJson: expect.objectContaining({
          graph: expect.objectContaining({
            stopReason: 'background_yield',
            yieldReason: 'slice_budget_exhausted',
          }),
        }),
      }),
    );
  });

  it('returns a running task result when the graph yields in the background', async () => {
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'I verified the first batch and I am still working through the rest now.',
        graphStatus: 'completed',
        completionKind: 'final_answer',
        stopReason: 'background_yield',
        deliveryDisposition: 'response_session',
        sliceIndex: 1,
        totalRoundsCompleted: 2,
        responseSession: {
          responseSessionId: 'trace-4',
          status: 'draft',
          latestText: 'I verified the first batch and I am still working through the rest now.',
          draftRevision: 2,
          sourceMessageId: 'message-4',
          responseMessageId: 'response-4',
          linkedArtifactMessageIds: [],
        },
        yieldReason: 'slice_budget_exhausted',
      }),
    );

    const result = await runChatTurn({
      traceId: 'trace-4',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-4',
      userText: 'keep digging',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({ messageId: 'message-4' }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(result.runId).toBe('trace-4');
    expect(result.status).toBe('running');
    expect(result.delivery).toBe('response_session');
    expect(result.meta).toBeUndefined();
    expect(result.replyText).toContain('still working through the rest');
    expect(result.responseSession).toMatchObject({
      responseSessionId: 'trace-4',
      status: 'draft',
      responseMessageId: 'response-4',
    });
  });

  it('keeps a background-yield task unrunnable until the response surface is durably attached', async () => {
    const now = Date.now();
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'I am still working through the rest now.',
        graphStatus: 'completed',
        completionKind: 'final_answer',
        stopReason: 'background_yield',
        deliveryDisposition: 'response_session',
        responseSession: {
          responseSessionId: 'trace-4c',
          status: 'draft',
          latestText: 'I am still working through the rest now.',
          draftRevision: 2,
          sourceMessageId: 'message-4c',
          responseMessageId: null,
          linkedArtifactMessageIds: [],
        },
        yieldReason: 'slice_budget_exhausted',
      }),
    );

    const result = await runChatTurn({
      traceId: 'trace-4c',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-4c',
      userText: 'keep digging',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({ messageId: 'message-4c' }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(result.status).toBe('running');
    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'trace-4c',
        status: 'running',
        nextRunnableAt: null,
      }),
    );

    getAgentTaskRunByThreadIdMock.mockResolvedValueOnce({
      id: 'task-4c',
      threadId: 'trace-4c',
      originTraceId: 'trace-4c',
      latestTraceId: 'trace-4c',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-4c',
      responseMessageId: null,
      status: 'running',
      waitingKind: null,
      latestDraftText: 'I am still working through the rest now.',
      draftRevision: 2,
      completionKind: 'final_answer',
      stopReason: 'background_yield',
      nextRunnableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      resumeCount: 0,
      taskWallClockMs: 0,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: {
        responseSessionId: 'trace-4c',
        status: 'draft',
        latestText: 'I am still working through the rest now.',
        draftRevision: 2,
        sourceMessageId: 'message-4c',
        responseMessageId: null,
        linkedArtifactMessageIds: [],
      },
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 5_000),
    });

    await attachTaskRunResponseSession({
      threadId: 'trace-4c',
      sourceMessageId: 'message-4c',
      responseMessageId: 'response-4c',
      responseSession: {
        responseSessionId: 'trace-4c',
        status: 'draft',
        latestText: 'I am still working through the rest now.',
        draftRevision: 2,
        sourceMessageId: 'message-4c',
        responseMessageId: 'response-4c',
        linkedArtifactMessageIds: [],
      },
    });

    expect(upsertAgentTaskRunMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadId: 'trace-4c',
        responseMessageId: 'response-4c',
        nextRunnableAt: expect.any(Date),
        responseSessionJson: expect.objectContaining({
          responseMessageId: 'response-4c',
          surfaceAttached: true,
        }),
      }),
    );
  });

  it('creates a placeholder running task when the first response-session attachment arrives before the task row exists', async () => {
    getAgentTaskRunByThreadIdMock.mockResolvedValueOnce(null);

    await attachTaskRunResponseSession({
      threadId: 'trace-foreground-attach-1',
      requestedByUserId: 'user-foreground-1',
      originChannelId: 'channel-foreground-1',
      responseChannelId: 'channel-foreground-1',
      guildId: 'guild-foreground-1',
      sourceMessageId: 'message-foreground-1',
      responseMessageId: 'response-foreground-1',
      responseSession: {
        responseSessionId: 'trace-foreground-attach-1',
        status: 'draft',
        latestText: 'Still working on that now.',
        draftRevision: 1,
        sourceMessageId: 'message-foreground-1',
        responseMessageId: 'response-foreground-1',
        linkedArtifactMessageIds: [],
        overflowMessageIds: [],
      },
    });

    expect(upsertAgentTaskRunMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadId: 'trace-foreground-attach-1',
        requestedByUserId: 'user-foreground-1',
        originChannelId: 'channel-foreground-1',
        responseChannelId: 'channel-foreground-1',
        guildId: 'guild-foreground-1',
        sourceMessageId: 'message-foreground-1',
        responseMessageId: 'response-foreground-1',
        status: 'running',
        nextRunnableAt: null,
        latestDraftText: 'Still working on that now.',
        responseSessionJson: expect.objectContaining({
          sourceMessageId: 'message-foreground-1',
          responseMessageId: 'response-foreground-1',
          surfaceAttached: true,
        }),
      }),
    );
  });

  it('returns a waiting-user-input task result when the graph requests user input', async () => {
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Which repository should I check first?',
        graphStatus: 'completed',
        completionKind: 'user_input_pending',
        stopReason: 'user_input_interrupt',
        deliveryDisposition: 'response_session',
        waitingState: {
          kind: 'user_input',
          prompt: 'Which repository should I check first?',
          requestedByUserId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          responseMessageId: 'response-4b',
        },
        responseSession: {
          responseSessionId: 'trace-4b',
          status: 'waiting_user_input',
          latestText: 'Which repository should I check first?',
          draftRevision: 2,
          sourceMessageId: 'message-4b',
          responseMessageId: 'response-4b',
          linkedArtifactMessageIds: [],
        },
      }),
    );

    const result = await runChatTurn({
      traceId: 'trace-4b',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-4b',
      userText: 'keep digging',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({ messageId: 'message-4b' }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(result.status).toBe('waiting_user_input');
    expect(result.delivery).toBe('response_session');
    expect(result.meta).toBeUndefined();
    expect(result.waitingState).toMatchObject({
      kind: 'user_input',
      responseMessageId: 'response-4b',
    });
    expect(result.replyText).toBe('Which repository should I check first?');
  });

  it('rehydrates current runtime policy and credentials when resuming background work', async () => {
    const now = Date.now();
    globalToolRegistryMock.listNames.mockReturnValue([
      'discord_history_search_history',
      'discord_governance_get_review_status',
    ] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) =>
      name === 'discord_governance_get_review_status'
        ? ({ metadata: { access: 'admin' } } as never)
        : ({ metadata: { access: 'public' } } as never),
    );
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-2',
      threadId: 'thread-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      originChannelId: 'channel-1',
      responseChannelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-1',
      responseMessageId: 'response-1',
      status: 'running',
      waitingKind: null,
      latestDraftText: 'summary',
      draftRevision: 1,
      completionKind: null,
      stopReason: 'background_yield',
      nextRunnableAt: new Date(Date.now() + 60_000),
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      heartbeatAt: new Date(),
      resumeCount: 1,
      taskWallClockMs: 1200,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: null,
      waitingStateJson: {
        kind: 'user_input',
        prompt: 'Which repository should I check first?',
      },
      compactionStateJson: null,
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 5_000),
    });
    continueAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Resumed and finished.',
        activeWindowDurationMs: 800,
      }),
    );

    const result = await resumeBackgroundTaskRun({
      traceId: 'trace-resume-1',
      threadId: 'thread-1',
      userId: 'user-1',
      originChannelId: 'channel-1',
      responseChannelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      isAdmin: true,
    });

    expect(result.replyText).toBe('Resumed and finished.');
    expect(continueAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'trace-resume-1',
        runName: 'sage_agent_background_resume',
        pendingUserInterrupt: null,
        context: expect.objectContaining({
          traceId: 'trace-resume-1',
          userId: 'user-1',
          channelId: 'channel-1',
          originChannelId: 'channel-1',
          responseChannelId: 'channel-1',
          guildId: 'guild-1',
          apiKey: 'test-api-key',
          model: 'test-main-agent-model',
          invokedBy: 'component',
          invokerIsAdmin: true,
          routeKind: 'background_resume',
          activeToolNames: ['discord_history_search_history', 'discord_governance_get_review_status'],
        }),
      }),
    );
    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        taskWallClockMs: 2000,
        resumeCount: 2,
      }),
    );
    expect(releaseAgentTaskRunLeaseMock).not.toHaveBeenCalled();
  });

  it('refreshes the latest persisted response-session refs before saving a resumed graph result', async () => {
    const now = Date.now();
    getAgentTaskRunByThreadIdMock
      .mockResolvedValueOnce({
        id: 'task-2b',
        threadId: 'thread-2b',
        originTraceId: 'trace-origin',
        latestTraceId: 'trace-latest',
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedByUserId: 'user-1',
        sourceMessageId: 'message-source-2b',
        responseMessageId: null,
        status: 'running',
        waitingKind: null,
        latestDraftText: 'summary',
        draftRevision: 1,
        completionKind: null,
        stopReason: 'background_yield',
        nextRunnableAt: new Date(Date.now() + 60_000),
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date(Date.now() + 60_000),
        heartbeatAt: new Date(),
        resumeCount: 1,
        taskWallClockMs: 1200,
        maxTotalDurationMs: 3_600_000,
        maxIdleWaitMs: 86_400_000,
        lastErrorText: null,
        responseSessionJson: {
          responseSessionId: 'thread-2b',
          status: 'draft',
          latestText: 'summary',
          draftRevision: 1,
          sourceMessageId: 'message-source-2b',
          responseMessageId: null,
          linkedArtifactMessageIds: [],
        },
        waitingStateJson: null,
        compactionStateJson: null,
        checkpointMetadataJson: { isAdmin: true, canModerate: false },
        startedAt: new Date(now - 5 * 60_000),
        completedAt: null,
        createdAt: new Date(now - 5 * 60_000),
        updatedAt: new Date(now - 5_000),
      })
      .mockResolvedValueOnce({
        id: 'task-2b',
        threadId: 'thread-2b',
        originTraceId: 'trace-origin',
        latestTraceId: 'trace-latest',
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedByUserId: 'user-1',
        sourceMessageId: 'message-source-2b',
        responseMessageId: 'response-existing-2b',
        status: 'running',
        waitingKind: null,
        latestDraftText: 'summary',
        draftRevision: 1,
        completionKind: null,
        stopReason: 'background_yield',
        nextRunnableAt: new Date(Date.now() + 60_000),
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date(Date.now() + 60_000),
        heartbeatAt: new Date(),
        resumeCount: 1,
        taskWallClockMs: 1200,
        maxTotalDurationMs: 3_600_000,
        maxIdleWaitMs: 86_400_000,
        lastErrorText: null,
        responseSessionJson: {
          responseSessionId: 'thread-2b',
          status: 'draft',
          latestText: 'summary',
          draftRevision: 1,
          sourceMessageId: 'message-source-2b',
          responseMessageId: 'response-existing-2b',
          overflowMessageIds: ['overflow-existing-2b'],
          linkedArtifactMessageIds: [],
        },
        waitingStateJson: null,
        compactionStateJson: null,
        checkpointMetadataJson: { isAdmin: true, canModerate: false },
        startedAt: new Date(now - 5 * 60_000),
        completedAt: null,
        createdAt: new Date(now - 5 * 60_000),
        updatedAt: new Date(now - 5_000),
      });
    continueAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Resumed and finished.',
        activeWindowDurationMs: 500,
        responseSession: {
          responseSessionId: 'thread-2b',
          status: 'final',
          latestText: 'Resumed and finished.',
          draftRevision: 2,
          sourceMessageId: 'message-source-2b',
          responseMessageId: null,
          linkedArtifactMessageIds: [],
        },
      }),
    );

    await resumeBackgroundTaskRun({
      traceId: 'trace-resume-2b',
      threadId: 'thread-2b',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      isAdmin: true,
    });

    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-2b',
        responseMessageId: 'response-existing-2b',
        responseSessionJson: expect.objectContaining({
          responseMessageId: 'response-existing-2b',
          sourceMessageId: 'message-source-2b',
          overflowMessageIds: ['overflow-existing-2b'],
        }),
      }),
    );
  });

  it('uses route-aware runtime failure copy when background resume throws', async () => {
    const now = Date.now();
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-3',
      threadId: 'thread-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-1',
      responseMessageId: 'response-1',
      status: 'running',
      waitingKind: null,
      latestDraftText: 'summary',
      draftRevision: 1,
      completionKind: null,
      stopReason: 'background_yield',
      nextRunnableAt: new Date(Date.now() + 60_000),
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      heartbeatAt: new Date(),
      resumeCount: 1,
      taskWallClockMs: 1200,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: null,
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 5_000),
    });
    continueAgentGraphTurnMock.mockRejectedValueOnce(new Error('resume failed'));

    const result = await resumeBackgroundTaskRun({
      traceId: 'trace-resume-failed',
      threadId: 'thread-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      isAdmin: true,
    });

    expect(result.replyText).toBe(
      'I ran into a problem while I was picking that back up, so please try again.',
    );
    expect(result.meta).toEqual({
      retry: {
        threadId: 'thread-1',
        retryKind: 'background_resume',
      },
    });
    expect(releaseAgentTaskRunLeaseMock).not.toHaveBeenCalled();
  });

  it('fails background resume cleanly when the task run already exhausted its total duration', async () => {
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-3a',
      threadId: 'thread-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-1',
      responseMessageId: 'response-1',
      status: 'running',
      waitingKind: null,
      latestDraftText: 'summary',
      draftRevision: 1,
      completionKind: null,
      stopReason: 'background_yield',
      nextRunnableAt: new Date(Date.now() + 60_000),
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      heartbeatAt: new Date(),
      resumeCount: 1,
      taskWallClockMs: 3_600_000,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: null,
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
      startedAt: new Date('2026-03-13T00:00:00.000Z'),
      completedAt: null,
      createdAt: new Date('2026-03-13T00:00:00.000Z'),
      updatedAt: new Date('2026-03-13T00:00:00.000Z'),
    });

    const result = await resumeBackgroundTaskRun({
      traceId: 'trace-resume-limit',
      threadId: 'thread-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      isAdmin: true,
    });

    expect(result.replyText).toBe('That task took too long, so please ask me again in a smaller step.');
    expect(continueAgentGraphTurnMock).not.toHaveBeenCalled();
    expect(updateAgentTaskRunByThreadIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        status: 'failed',
      }),
    );
  });

  it('routes a matching follow-up message into a waiting user-input task run', async () => {
    const now = Date.now();
    findWaitingUserInputTaskRunMock.mockResolvedValue({
      id: 'task-waiting-1',
      threadId: 'thread-waiting-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-1',
      responseMessageId: 'response-waiting-1',
      status: 'waiting_user_input',
      waitingKind: 'user_input',
      latestDraftText: 'Which repository should I check first?',
      draftRevision: 2,
      completionKind: 'user_input_pending',
      stopReason: 'user_input_interrupt',
      nextRunnableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      resumeCount: 0,
      taskWallClockMs: 1000,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: null,
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 5_000),
    });
    continueAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'I checked that repository and found the issue.',
        activeWindowDurationMs: 600,
      }),
    );

    const result = await resumeWaitingTaskRunWithInput({
      traceId: 'trace-resume-input-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      replyToMessageId: 'response-waiting-1',
      userText: 'Check the Sage repo first.',
      currentTurn: makeCurrentTurn({
        messageId: 'message-followup-1',
        replyTargetMessageId: 'response-waiting-1',
        isDirectReply: true,
      }),
      isAdmin: true,
    });

    expect(continueAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-waiting-1',
        runName: 'sage_agent_user_input_resume',
        clearWaitingState: true,
        context: expect.objectContaining({
          promptMode: 'waiting_follow_up',
          waitingFollowUp: {
            matched: true,
            matchKind: 'direct_reply',
            outstandingPrompt: 'Which repository should I check first?',
            responseMessageId: 'response-waiting-1',
          },
        }),
        appendedMessages: [
          expect.objectContaining({
            content: 'Check the Sage repo first.',
          }),
        ],
      }),
    );
    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-waiting-1',
        sourceMessageId: 'message-followup-1',
        resumeCount: 1,
        taskWallClockMs: 1600,
        responseSessionJson: expect.objectContaining({
          sourceMessageId: 'message-followup-1',
          surfaceAttached: false,
        }),
      }),
    );
    expect(result.delivery).toBe('response_session');
    expect(result.replyText).toBe('I checked that repository and found the issue.');
  });

  it('does not arm background continuation on a waiting-follow-up resume until the fresh response surface is attached', async () => {
    const now = Date.now();
    findWaitingUserInputTaskRunMock.mockResolvedValue({
      id: 'task-waiting-1b',
      threadId: 'thread-waiting-1b',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-1b',
      responseMessageId: 'response-waiting-1b',
      status: 'waiting_user_input',
      waitingKind: 'user_input',
      latestDraftText: 'Which repository should I check first?',
      draftRevision: 2,
      completionKind: 'user_input_pending',
      stopReason: 'user_input_interrupt',
      nextRunnableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      resumeCount: 0,
      taskWallClockMs: 1000,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: {
        responseSessionId: 'thread-waiting-1b',
        status: 'waiting_user_input',
        latestText: 'Which repository should I check first?',
        draftRevision: 2,
        sourceMessageId: 'message-source-1b',
        responseMessageId: 'response-waiting-1b',
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 5_000),
    });
    continueAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Progress update: still checking.',
        completionKind: 'final_answer',
        stopReason: 'background_yield',
        graphStatus: 'running',
        yieldReason: 'slice_budget_exhausted',
        responseSession: {
          responseSessionId: 'thread-waiting-1b',
          status: 'draft',
          latestText: 'Progress update: still checking.',
          draftRevision: 1,
          sourceMessageId: 'message-source-1b',
          responseMessageId: null,
          surfaceAttached: false,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
      }),
    );

    await resumeWaitingTaskRunWithInput({
      traceId: 'trace-resume-input-1b',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      replyToMessageId: 'response-waiting-1b',
      userText: 'Check the Sage repo first.',
      currentTurn: makeCurrentTurn({
        messageId: 'message-followup-1b',
        replyTargetMessageId: 'response-waiting-1b',
        isDirectReply: true,
      }),
      isAdmin: true,
    });

    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-waiting-1b',
        status: 'running',
        sourceMessageId: 'message-followup-1b',
        responseMessageId: null,
        nextRunnableAt: null,
        responseSessionJson: expect.objectContaining({
          sourceMessageId: 'message-followup-1b',
          responseMessageId: null,
          surfaceAttached: false,
        }),
      }),
    );
  });

  it("fails cleanly when a follow-up isn't a direct reply to Sage's waiting question", async () => {
    findWaitingUserInputTaskRunMock.mockResolvedValue(null);
    const result = await resumeWaitingTaskRunWithInput({
      traceId: 'trace-resume-input-single-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'member',
      replyToMessageId: null,
      userText: 'Proceed',
      currentTurn: makeCurrentTurn({
        messageId: 'message-followup-single-1',
        isDirectReply: false,
        replyTargetMessageId: null,
      }),
      isAdmin: false,
    });

    expect(result.status).toBe('failed');
    expect(result.replyText).toBe("I couldn't find the question I was waiting on, so please ask me again.");
    expect(continueAgentGraphTurnMock).not.toHaveBeenCalled();
    expect(upsertAgentTaskRunMock).not.toHaveBeenCalled();
  });

  it('fails a waiting user-input run cleanly after idle expiry instead of starting a fresh turn', async () => {
    const now = Date.now();
    const staleUpdatedAt = new Date(now - 90_000_000);
    findWaitingUserInputTaskRunMock.mockResolvedValue({
      id: 'task-waiting-2',
      threadId: 'thread-waiting-2',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-1',
      responseMessageId: 'response-waiting-2',
      status: 'waiting_user_input',
      waitingKind: 'user_input',
      latestDraftText: 'Which repository should I check first?',
      draftRevision: 2,
      completionKind: 'user_input_pending',
      stopReason: 'user_input_interrupt',
      nextRunnableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      resumeCount: 0,
      taskWallClockMs: 1000,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: null,
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: staleUpdatedAt,
    });

    const result = await resumeWaitingTaskRunWithInput({
      traceId: 'trace-resume-input-2',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      replyToMessageId: 'response-waiting-2',
      userText: 'Check the Sage repo first.',
      currentTurn: makeCurrentTurn({
        messageId: 'message-followup-2',
        replyTargetMessageId: 'response-waiting-2',
        isDirectReply: true,
      }),
      isAdmin: true,
    });

    expect(result.replyText).toBe('I waited too long for that reply, so please ask me again.');
    expect(continueAgentGraphTurnMock).not.toHaveBeenCalled();
    expect(updateAgentTaskRunByThreadIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-waiting-2',
        status: 'failed',
      }),
    );
  });

  it('passes a queued active-run user interrupt into the next background graph continue', async () => {
    const now = Date.now();
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-interrupt-1',
      threadId: 'thread-interrupt-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-interrupt-1',
      responseMessageId: 'response-interrupt-1',
      status: 'running',
      waitingKind: null,
      latestDraftText: 'Still checking.',
      draftRevision: 3,
      completionKind: null,
      stopReason: 'background_yield',
      nextRunnableAt: new Date(now + 60_000),
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(now + 60_000),
      heartbeatAt: new Date(now),
      resumeCount: 1,
      taskWallClockMs: 1_500,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: {
        responseSessionId: 'thread-interrupt-1',
        status: 'draft',
        latestText: 'Still checking.',
        draftRevision: 3,
        sourceMessageId: 'message-source-interrupt-1',
        responseMessageId: 'response-interrupt-1',
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
      activeUserInterruptJson: {
        messageId: 'steer-message-1',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        userText: 'Check the docs before the repo search.',
        userContent: 'Check the docs before the repo search.',
      },
      activeUserInterruptRevision: 3,
      activeUserInterruptConsumedRevision: 2,
      activeUserInterruptQueuedAt: new Date(now - 1_000),
      activeUserInterruptConsumedAt: null,
      activeUserInterruptSupersededAt: null,
      activeUserInterruptSupersededRevision: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 5_000),
    });
    continueAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'I checked the docs first and then verified the repo.',
        activeWindowDurationMs: 400,
        interruptResolution: null,
      }),
    );

    await resumeBackgroundTaskRun({
      traceId: 'trace-interrupt-1',
      threadId: 'thread-interrupt-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      isAdmin: true,
    });

    expect(continueAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-interrupt-1',
        pendingUserInterrupt: expect.objectContaining({
          revision: 3,
          messageId: 'steer-message-1',
          userText: 'Check the docs before the repo search.',
        }),
      }),
    );
    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-interrupt-1',
        activeUserInterruptConsumedRevision: 3,
      }),
    );
  });

  it('continues a just-finished matched task on the same thread instead of forking a fresh turn', async () => {
    const now = Date.now();
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-terminal-race-1',
      threadId: 'thread-terminal-race-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-terminal-race-1',
      responseMessageId: 'response-terminal-race-1',
      status: 'completed',
      waitingKind: null,
      latestDraftText: 'Step 5/5 complete.',
      draftRevision: 5,
      completionKind: 'final_answer',
      stopReason: 'assistant_turn_completed',
      nextRunnableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(now),
      resumeCount: 2,
      taskWallClockMs: 2_500,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: {
        responseSessionId: 'thread-terminal-race-1',
        status: 'final',
        latestText: 'Step 5/5 complete.',
        draftRevision: 5,
        sourceMessageId: 'message-source-terminal-race-1',
        responseMessageId: 'response-terminal-race-1',
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
      activeUserInterruptJson: null,
      activeUserInterruptRevision: 0,
      activeUserInterruptConsumedRevision: 0,
      activeUserInterruptQueuedAt: null,
      activeUserInterruptConsumedAt: null,
      activeUserInterruptSupersededAt: null,
      activeUserInterruptSupersededRevision: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: new Date(now - 1_000),
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 1_000),
    });
    continueAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Switching to the docs repo on the same task.',
        activeWindowDurationMs: 300,
        responseSession: {
          responseSessionId: 'thread-terminal-race-1',
          status: 'final',
          latestText: 'Switching to the docs repo on the same task.',
          draftRevision: 6,
          sourceMessageId: 'message-source-terminal-race-1',
          responseMessageId: 'response-terminal-race-1',
          surfaceAttached: true,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
      }),
    );

    const result = await continueMatchedTaskRunWithInput({
      traceId: 'trace-terminal-race-1',
      threadId: 'thread-terminal-race-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      userText: 'Stop and switch to docs first.',
      currentTurn: makeCurrentTurn({
        messageId: 'message-terminal-race-1',
        invokedBy: 'reply',
        isDirectReply: true,
        replyTargetMessageId: 'response-terminal-race-1',
        replyTargetAuthorId: 'sage-bot',
      }),
      replyTarget: {
        messageId: 'response-terminal-race-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'sage-bot',
        authorDisplayName: 'Sage',
        authorIsBot: true,
        content: 'Step 5/5 complete.',
        mentionedUserIds: [],
      },
      promptMode: 'reply_only',
      isAdmin: true,
    });

    expect(result.replyText).toBe('Switching to the docs repo on the same task.');
    expect(continueAgentGraphTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-terminal-race-1',
        appendedMessages: [new HumanMessage({ content: 'Stop and switch to docs first.' })],
        context: expect.objectContaining({
          routeKind: 'active_interrupt_race_resume',
          currentTurn: expect.objectContaining({
            messageId: 'message-terminal-race-1',
          }),
        }),
      }),
    );
    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-terminal-race-1',
        sourceMessageId: 'message-source-terminal-race-1',
        responseMessageId: 'response-terminal-race-1',
        resumeCount: 3,
        status: 'completed',
      }),
    );
  });

  it('refuses to reopen a matched task race unless the task really finished with a final answer', async () => {
    const now = Date.now();
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-terminal-race-invalid-1',
      threadId: 'thread-terminal-race-invalid-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-source-terminal-race-invalid-1',
      responseMessageId: 'response-terminal-race-invalid-1',
      status: 'waiting_user_input',
      waitingKind: 'user_input',
      latestDraftText: 'Which repo should I check?',
      draftRevision: 5,
      completionKind: null,
      stopReason: 'user_input_interrupt',
      nextRunnableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(now),
      resumeCount: 2,
      taskWallClockMs: 2_500,
      maxTotalDurationMs: 3_600_000,
      maxIdleWaitMs: 86_400_000,
      lastErrorText: null,
      responseSessionJson: {
        responseSessionId: 'thread-terminal-race-invalid-1',
        status: 'waiting_user_input',
        latestText: 'Which repo should I check?',
        draftRevision: 5,
        sourceMessageId: 'message-source-terminal-race-invalid-1',
        responseMessageId: 'response-terminal-race-invalid-1',
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
      activeUserInterruptJson: null,
      activeUserInterruptRevision: 0,
      activeUserInterruptConsumedRevision: 0,
      activeUserInterruptQueuedAt: null,
      activeUserInterruptConsumedAt: null,
      activeUserInterruptSupersededAt: null,
      activeUserInterruptSupersededRevision: null,
      startedAt: new Date(now - 5 * 60_000),
      completedAt: null,
      createdAt: new Date(now - 5 * 60_000),
      updatedAt: new Date(now - 1_000),
    });

    const result = await continueMatchedTaskRunWithInput({
      traceId: 'trace-terminal-race-invalid-1',
      threadId: 'thread-terminal-race-invalid-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      userText: 'Use the docs repo.',
      currentTurn: makeCurrentTurn({
        messageId: 'message-terminal-race-invalid-1',
      }),
      isAdmin: true,
    });

    expect(result.status).toBe('failed');
    expect(result.replyText).toBe('I couldn’t resume that finished task cleanly, so please ask me again.');
    expect(continueAgentGraphTurnMock).not.toHaveBeenCalled();
    expect(upsertAgentTaskRunMock).not.toHaveBeenCalled();
  });

  it('defers terminal persistence when a newer active-run interrupt lands before final completion saves', async () => {
    const now = Date.now();
    getAgentTaskRunByThreadIdMock
      .mockResolvedValueOnce({
        id: 'task-defer-1',
        threadId: 'thread-defer-1',
        originTraceId: 'trace-origin',
        latestTraceId: 'trace-latest',
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedByUserId: 'user-1',
        sourceMessageId: 'message-source-defer-1',
        responseMessageId: 'response-defer-1',
        status: 'running',
        waitingKind: null,
        latestDraftText: 'Still checking.',
        draftRevision: 2,
        completionKind: null,
        stopReason: 'background_yield',
        nextRunnableAt: new Date(now + 60_000),
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date(now + 60_000),
        heartbeatAt: new Date(now),
        resumeCount: 1,
        taskWallClockMs: 2_000,
        maxTotalDurationMs: 3_600_000,
        maxIdleWaitMs: 86_400_000,
        lastErrorText: null,
        responseSessionJson: {
          responseSessionId: 'thread-defer-1',
          status: 'draft',
          latestText: 'Still checking.',
          draftRevision: 2,
          sourceMessageId: 'message-source-defer-1',
          responseMessageId: 'response-defer-1',
          surfaceAttached: true,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
        waitingStateJson: null,
        compactionStateJson: null,
        checkpointMetadataJson: { isAdmin: true, canModerate: false },
        activeUserInterruptJson: null,
        activeUserInterruptRevision: 0,
        activeUserInterruptConsumedRevision: 0,
        activeUserInterruptQueuedAt: null,
        activeUserInterruptConsumedAt: null,
        activeUserInterruptSupersededAt: null,
        activeUserInterruptSupersededRevision: null,
        startedAt: new Date(now - 5 * 60_000),
        completedAt: null,
        createdAt: new Date(now - 5 * 60_000),
        updatedAt: new Date(now - 5_000),
      })
      .mockResolvedValueOnce({
        id: 'task-defer-1',
        threadId: 'thread-defer-1',
        originTraceId: 'trace-origin',
        latestTraceId: 'trace-latest',
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedByUserId: 'user-1',
        sourceMessageId: 'message-source-defer-1',
        responseMessageId: 'response-defer-1',
        status: 'running',
        waitingKind: null,
        latestDraftText: 'Still checking.',
        draftRevision: 2,
        completionKind: null,
        stopReason: 'background_yield',
        nextRunnableAt: new Date(now + 60_000),
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date(now + 60_000),
        heartbeatAt: new Date(now),
        resumeCount: 1,
        taskWallClockMs: 2_000,
        maxTotalDurationMs: 3_600_000,
        maxIdleWaitMs: 86_400_000,
        lastErrorText: null,
        responseSessionJson: {
          responseSessionId: 'thread-defer-1',
          status: 'draft',
          latestText: 'Still checking.',
          draftRevision: 2,
          sourceMessageId: 'message-source-defer-1',
          responseMessageId: 'response-defer-1',
          surfaceAttached: true,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
        waitingStateJson: null,
        compactionStateJson: null,
        checkpointMetadataJson: { isAdmin: true, canModerate: false },
        activeUserInterruptJson: {
          messageId: 'steer-message-late-1',
          userId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          userText: 'Actually also check the docs.',
          userContent: 'Actually also check the docs.',
        },
        activeUserInterruptRevision: 5,
        activeUserInterruptConsumedRevision: 4,
        activeUserInterruptQueuedAt: new Date(now - 500),
        activeUserInterruptConsumedAt: null,
        activeUserInterruptSupersededAt: null,
        activeUserInterruptSupersededRevision: null,
        startedAt: new Date(now - 5 * 60_000),
        completedAt: null,
        createdAt: new Date(now - 5 * 60_000),
        updatedAt: new Date(now - 1_000),
      });
    continueAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Final answer before the late steer.',
        activeWindowDurationMs: 600,
      }),
    );

    const result = await resumeBackgroundTaskRun({
      traceId: 'trace-defer-1',
      threadId: 'thread-defer-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokerAuthority: 'admin',
      isAdmin: true,
    });

    expect(result.status).toBe('running');
    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-defer-1',
        status: 'running',
        completionKind: null,
        stopReason: null,
        checkpointMetadataJson: expect.objectContaining({
          deferredForActiveInterrupt: true,
        }),
      }),
    );
  });

  it('queues active-run user interrupts through the repo contract', async () => {
    queueRunningTaskRunActiveInterruptMock.mockResolvedValue('queued');

    const queued = await queueActiveRunUserInterrupt({
      threadId: 'thread-active-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-active-1',
      userText: 'Pivot the search to docs first.',
      userContent: 'Pivot the search to docs first.',
    });

    expect(queued).toBe('queued');
    expect(queueRunningTaskRunActiveInterruptMock).toHaveBeenCalledWith({
      threadId: 'thread-active-1',
      requestedByUserId: 'user-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'message-active-1',
      userText: 'Pivot the search to docs first.',
      userContent: 'Pivot the search to docs first.',
    });
  });
});

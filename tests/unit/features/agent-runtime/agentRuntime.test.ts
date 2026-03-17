import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

const {
  upsertTraceStartMock,
  updateTraceEndMock,
  clearGitHubFileLookupCacheForTraceMock,
  buildPromptContextMessagesMock,
  globalToolRegistryMock,
  runAgentGraphTurnMock,
  continueAgentGraphTurnMock,
  retryAgentGraphTurnMock,
  getApprovalReviewRequestByIdMock,
  upsertAgentTaskRunMock,
  getAgentTaskRunByThreadIdMock,
  findWaitingUserInputTaskRunMock,
  updateAgentTaskRunByThreadIdMock,
  releaseAgentTaskRunLeaseMock,
} = vi.hoisted(() => ({
  upsertTraceStartMock: vi.fn(),
  updateTraceEndMock: vi.fn(),
  clearGitHubFileLookupCacheForTraceMock: vi.fn(),
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
      (name: string): { metadata?: { access?: 'public' | 'admin' } } | undefined => {
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
    AGENT_GRAPH_GITHUB_GROUNDED_MODE: false,
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

vi.mock('@/features/agent-runtime/toolGrounding', () => ({
  enforceGitHubFileGrounding: vi.fn((replyText: string) => ({
    modified: false,
    replyText,
    ungroundedPaths: [],
    successfulPaths: [],
  })),
}));

vi.mock('@/features/agent-runtime/langgraph/runtime', () => ({
  runAgentGraphTurn: runAgentGraphTurnMock,
  continueAgentGraphTurn: continueAgentGraphTurnMock,
  retryAgentGraphTurn: retryAgentGraphTurnMock,
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  clearGitHubFileLookupCacheForTrace: clearGitHubFileLookupCacheForTraceMock,
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
  updateAgentTaskRunByThreadId: updateAgentTaskRunByThreadIdMock,
  releaseAgentTaskRunLease: releaseAgentTaskRunLeaseMock,
}));

vi.mock('@/features/voice/voiceConversationSessionStore', () => ({
  formatLiveVoiceContext: vi.fn(() => null),
}));

import {
  resumeBackgroundTaskRun,
  resumeWaitingTaskRunWithInput,
  retryFailedChatTurn,
  runChatTurn,
} from '@/features/agent-runtime/agentRuntime';
import { scrubFinalReplyText } from '@/features/agent-runtime/finalReplyScrubber';

function makeCurrentTurn(overrides: Partial<CurrentTurnContext> = {}): CurrentTurnContext {
  return {
    invokerUserId: 'user-1',
    invokerDisplayName: 'User One',
    messageId: 'message-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
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
    clearGitHubFileLookupCacheForTraceMock.mockReset();
    getApprovalReviewRequestByIdMock.mockReset();
    getApprovalReviewRequestByIdMock.mockResolvedValue(null);
    upsertAgentTaskRunMock.mockReset();
    upsertAgentTaskRunMock.mockResolvedValue(undefined);
    getAgentTaskRunByThreadIdMock.mockReset();
    getAgentTaskRunByThreadIdMock.mockResolvedValue(null);
    findWaitingUserInputTaskRunMock.mockReset();
    findWaitingUserInputTaskRunMock.mockResolvedValue(null);
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
    runAgentGraphTurnMock.mockRejectedValueOnce(new Error('AI provider API error: 503 Service Unavailable - upstream down'));

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
    globalToolRegistryMock.listNames.mockReturnValue(['web', 'github_search_code', 'discord_messages_search_history'] as never);
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
          activeToolNames: ['web', 'github_search_code', 'discord_messages_search_history'],
        }),
      }),
    );
  });

  it('keeps all eligible tools available for generic follow-up resumes', async () => {
    const now = Date.now();
    globalToolRegistryMock.listNames.mockReturnValue([
      'web_search',
      'github_search_code',
      'discord_messages_search_history',
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
      completionKind: 'clarification_question',
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
        replyText: 'I dug further and found more evidence.',
        activeWindowDurationMs: 600,
      }),
    );

    await resumeWaitingTaskRunWithInput({
      traceId: 'trace-followup-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
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
          activeToolNames: ['web_search', 'github_search_code', 'discord_messages_search_history'],
        }),
      }),
    );
  });

  it('does not expose admin-only tools to non-admin turns', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['web', 'discord_admin'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const access: 'public' | 'admin' = name === 'discord_admin' ? 'admin' : 'public';
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
      'web_research',
      'github_search_code',
      'discord_messages_search_history',
      'discord_server_list_channels',
      'workflow_npm_github_code_search',
      'image_generate',
      'system_time',
      'system_tool_stats',
    ] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const toolMap: Record<string, { metadata: { access: 'public' | 'admin' }; runtime: { access: 'public' | 'admin'; capabilityTags: string[]; class: string } }> = {
        web_search: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['web', 'search'], class: 'query' } },
        web_research: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['web', 'research'], class: 'query' } },
        github_search_code: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['github', 'developer'], class: 'query' } },
        discord_messages_search_history: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['discord', 'messages'], class: 'query' } },
        discord_server_list_channels: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['discord', 'server'], class: 'query' } },
        workflow_npm_github_code_search: { metadata: { access: 'public' }, runtime: { access: 'public', capabilityTags: ['workflow', 'developer', 'github', 'npm'], class: 'query' } },
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
      'web_research',
      'github_search_code',
      'discord_messages_search_history',
      'discord_server_list_channels',
      'workflow_npm_github_code_search',
      'image_generate',
      'system_time',
      'system_tool_stats',
    ]);
  });

  it('exposes discord_admin to moderator-only turns for moderation workflows', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['web', 'discord_admin_submit_moderation'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const access: 'public' | 'admin' = name === 'discord_admin_submit_moderation' ? 'admin' : 'public';
      return {
        metadata: { access },
        runtime: {
          access,
          capabilityTags: name === 'discord_admin_submit_moderation' ? ['moderation'] : [],
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
        activeToolNames: ['web', 'discord_admin_submit_moderation'],
        invokerCanModerate: true,
      }),
    );
  });

  it('does not expose admin-only tools during autopilot turns even for admins', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['web', 'discord_admin'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) => {
      const access: 'public' | 'admin' = name === 'discord_admin' ? 'admin' : 'public';
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

  it('returns a waiting-user-input task result when the graph asks a clarification question', async () => {
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Which repository should I check first?',
        graphStatus: 'completed',
        completionKind: 'clarification_question',
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
    globalToolRegistryMock.listNames.mockReturnValue(['discord_messages', 'discord_admin'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) =>
      name === 'discord_admin' ? ({ metadata: { access: 'admin' } } as never) : ({ metadata: { access: 'public' } } as never),
    );
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-2',
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
      channelId: 'channel-1',
      guildId: 'guild-1',
      isAdmin: true,
    });

    expect(result.replyText).toBe('Resumed and finished.');
    expect(continueAgentGraphTurnMock).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'trace-resume-1',
      runName: 'sage_agent_background_resume',
      context: expect.objectContaining({
        traceId: 'trace-resume-1',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        apiKey: 'test-api-key',
        model: 'test-main-agent-model',
        invokedBy: 'component',
        invokerIsAdmin: true,
        routeKind: 'background_resume',
        activeToolNames: ['discord_messages', 'discord_admin'],
      }),
    });
    expect(upsertAgentTaskRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        taskWallClockMs: 2000,
        resumeCount: 2,
      }),
    );
    expect(releaseAgentTaskRunLeaseMock).toHaveBeenCalledWith({
      id: 'task-2',
      leaseOwner: 'worker-1',
    });
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
    expect(releaseAgentTaskRunLeaseMock).toHaveBeenCalledWith({
      id: 'task-3',
      leaseOwner: 'worker-1',
    });
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
      completionKind: 'clarification_question',
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
        resumeCount: 1,
        taskWallClockMs: 1600,
      }),
    );
    expect(result.delivery).toBe('response_session');
    expect(result.replyText).toBe('I checked that repository and found the issue.');
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
      completionKind: 'clarification_question',
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
});

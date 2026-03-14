import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

const {
  upsertTraceStartMock,
  updateTraceEndMock,
  clearGitHubFileLookupCacheForTraceMock,
  buildContextMessagesMock,
  globalToolRegistryMock,
  runAgentGraphTurnMock,
  resumeAgentGraphTurnMock,
  getGraphContinuationSessionByIdMock,
  markGraphContinuationSessionExpiredMock,
  getApprovalReviewRequestByIdMock,
} = vi.hoisted(() => ({
  upsertTraceStartMock: vi.fn(),
  updateTraceEndMock: vi.fn(),
  clearGitHubFileLookupCacheForTraceMock: vi.fn(),
  buildContextMessagesMock: vi.fn(() => [new HumanMessage({ content: 'hello' })]),
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
  resumeAgentGraphTurnMock: vi.fn(),
  getGraphContinuationSessionByIdMock: vi.fn(),
  markGraphContinuationSessionExpiredMock: vi.fn(),
  getApprovalReviewRequestByIdMock: vi.fn(),
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    CONTEXT_TRANSCRIPT_MAX_MESSAGES: 10,
    CONTEXT_TRANSCRIPT_MAX_CHARS: 4000,
    AI_PROVIDER_API_KEY: 'test-api-key',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
    CHAT_MAX_OUTPUT_TOKENS: 500,
    AGENT_GRAPH_MAX_OUTPUT_TOKENS: 500,
    AGENT_GRAPH_MAX_STEPS: 2,
    AGENT_GRAPH_MAX_TOOL_CALLS_PER_STEP: 3,
    AGENT_GRAPH_TOOL_TIMEOUT_MS: 1000,
    AGENT_GRAPH_MAX_RESULT_CHARS: 4000,
    AGENT_GRAPH_MAX_DURATION_MS: 5000,
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

vi.mock('@/features/agent-runtime/contextBuilder', () => ({
  buildContextMessages: buildContextMessagesMock,
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
  resumeAgentGraphTurn: resumeAgentGraphTurnMock,
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

vi.mock('@/features/agent-runtime/graphContinuationRepo', () => ({
  getGraphContinuationSessionById: getGraphContinuationSessionByIdMock,
  markGraphContinuationSessionExpired: markGraphContinuationSessionExpiredMock,
}));

vi.mock('@/features/admin/approvalReviewRequestRepo', () => ({
  getApprovalReviewRequestById: getApprovalReviewRequestByIdMock,
}));

vi.mock('@/features/voice/voiceConversationSessionStore', () => ({
  formatLiveVoiceContext: vi.fn(() => null),
}));

import { runChatTurn, resumeContinuationChatTurn } from '@/features/agent-runtime/agentRuntime';
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
    completedWindows: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    truncatedCallCount: 0,
    guardrailBlockedCallCount: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      fallbackUsed: false,
      returnedToolCallCount: 0,
      completedAt: '2026-03-12T00:00:00.000Z',
      terminationReason: 'assistant_reply',
    },
    terminationReason: 'assistant_reply',
    graphStatus: 'completed',
    pendingInterrupt: null,
    interruptResolution: null,
    langSmithRunId: null,
    langSmithTraceId: null,
    ...overrides,
  };
}

describe('agentRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildContextMessagesMock.mockReturnValue([new HumanMessage({ content: 'hello' })]);
    globalToolRegistryMock.listNames.mockReturnValue([]);
    globalToolRegistryMock.get.mockReturnValue(undefined);
    upsertTraceStartMock.mockResolvedValue(undefined);
    updateTraceEndMock.mockResolvedValue(undefined);
    runAgentGraphTurnMock.mockReset();
    resumeAgentGraphTurnMock.mockReset();
    getGraphContinuationSessionByIdMock.mockReset();
    markGraphContinuationSessionExpiredMock.mockReset();
    clearGitHubFileLookupCacheForTraceMock.mockReset();
    getApprovalReviewRequestByIdMock.mockReset();
    getApprovalReviewRequestByIdMock.mockResolvedValue(null);
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
        replyText: 'I will call `discord_admin`.\n```json\n{"action":"update_server_instructions"}\n```',
        graphStatus: 'interrupted',
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

    await runChatTurn({
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

    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetJson: expect.not.objectContaining({
          taskState: expect.anything(),
        }),
      }),
    );
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
        guardrailBlockedCallCount: 1,
        finalization: {
          attempted: true,
          succeeded: true,
          fallbackUsed: false,
          returnedToolCallCount: 0,
          completedAt: '2026-03-11T22:00:00.000Z',
          terminationReason: 'continue_prompt',
        },
        terminationReason: 'continue_prompt',
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
            terminationReason: 'continue_prompt',
            guardrailBlockedCallCount: 1,
          }),
        }),
        toolJson: expect.objectContaining({
          graph: expect.objectContaining({
            terminationReason: 'continue_prompt',
            guardrailBlockedCallCount: 1,
          }),
        }),
      }),
    );
  });

  it('returns continuation delivery when the graph pauses for continue', async () => {
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'I verified the first batch of results and need another continuation window to keep going.',
        graphStatus: 'interrupted',
        terminationReason: 'continue_prompt',
        completedWindows: 1,
        totalRoundsCompleted: 2,
        pendingInterrupt: {
          kind: 'continue_prompt',
          continuationId: 'cont-1',
          requestedByUserId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          summaryText: 'I verified the first batch of results and need another continuation window to keep going.',
          completedWindows: 1,
          maxWindows: 4,
          expiresAtIso: '2026-03-13T09:40:00.000Z',
          resumeNode: 'llm_call',
        },
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

    expect(result.delivery).toBe('chat_reply_with_continue');
    expect(result.meta?.continuation).toMatchObject({
      id: 'cont-1',
      completedWindows: 1,
      maxWindows: 4,
    });
    expect(result.replyText).toContain('need another continuation window');
  });

  it('rehydrates current runtime policy and credentials when resuming a continuation', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['discord_messages', 'discord_admin'] as never);
    globalToolRegistryMock.get.mockImplementation((name: string) =>
      name === 'discord_admin' ? ({ metadata: { access: 'admin' } } as never) : ({ metadata: { access: 'public' } } as never),
    );
    getGraphContinuationSessionByIdMock.mockResolvedValue({
      id: 'cont-2',
      threadId: 'thread-1',
      originTraceId: 'trace-origin',
      latestTraceId: 'trace-latest',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      status: 'pending',
      pauseKind: 'step_window_exhausted',
      completedWindows: 1,
      maxWindows: 4,
      summaryText: 'summary',
      resumeNode: 'llm_call',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-03-13T00:00:00.000Z'),
      updatedAt: new Date('2026-03-13T00:00:00.000Z'),
    });
    resumeAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'Resumed and finished.',
      }),
    );

    const result = await resumeContinuationChatTurn({
      traceId: 'trace-resume-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      continuationId: 'cont-2',
      isAdmin: true,
    });

    expect(result.replyText).toBe('Resumed and finished.');
    expect(resumeAgentGraphTurnMock).toHaveBeenCalledWith({
      threadId: 'thread-1',
      resume: {
        interruptKind: 'continue_prompt',
        decision: 'continue',
        continuationId: 'cont-2',
        resumedByUserId: 'user-1',
        resumeTraceId: 'trace-resume-1',
      },
      context: expect.objectContaining({
        traceId: 'trace-resume-1',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        apiKey: 'test-api-key',
        model: 'test-main-agent-model',
        invokedBy: 'component',
        invokerIsAdmin: true,
        routeKind: 'continue_resume',
        activeToolNames: ['discord_messages', 'discord_admin'],
      }),
    });
  });
});

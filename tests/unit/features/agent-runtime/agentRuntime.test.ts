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
  resumeAgentGraphTurnMock,
  retryAgentGraphTurnMock,
  getGraphContinuationSessionByIdMock,
  markGraphContinuationSessionExpiredMock,
  getApprovalReviewRequestByIdMock,
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
  resumeAgentGraphTurnMock: vi.fn(),
  retryAgentGraphTurnMock: vi.fn(),
  getGraphContinuationSessionByIdMock: vi.fn(),
  markGraphContinuationSessionExpiredMock: vi.fn(),
  getApprovalReviewRequestByIdMock: vi.fn(),
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    CONTEXT_TRANSCRIPT_MAX_MESSAGES: 10,
    AI_PROVIDER_API_KEY: 'test-api-key',
    AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
    CHAT_MAX_OUTPUT_TOKENS: 500,
    AGENT_GRAPH_MAX_OUTPUT_TOKENS: 500,
    AGENT_GRAPH_MAX_STEPS: 2,
    AGENT_GRAPH_TOOL_TIMEOUT_MS: 1000,
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
  resumeAgentGraphTurn: resumeAgentGraphTurnMock,
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

import { retryFailedChatTurn, runChatTurn, resumeContinuationChatTurn } from '@/features/agent-runtime/agentRuntime';
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
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      completedAt: '2026-03-12T00:00:00.000Z',
      stopReason: 'verified_closeout',
      completionKind: 'final_answer',
      deliveryDisposition: 'chat_reply',
      protocolRepairCount: 0,
      protocolRepairInstruction: null,
      toolDeliveredFinal: false,
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
    stopReason: 'verified_closeout',
    deliveryDisposition: 'chat_reply',
    protocolRepairCount: 0,
    protocolRepairInstruction: null,
    toolDeliveredFinal: false,
    contextFrame: {
      objective: 'Finish the request.',
      verifiedFacts: [],
      completedActions: [],
      openQuestions: [],
      pendingApprovals: [],
      deliveryState: 'none',
      nextAction: 'Close out the turn.',
    },
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
    resumeAgentGraphTurnMock.mockReset();
    retryAgentGraphTurnMock.mockReset();
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

  it('narrows the exposed tool subset for obvious web research turns when the eligible surface is large', async () => {
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
    expect(activeToolNames).toEqual(expect.arrayContaining(['web_search', 'web_research', 'system_time']));
    expect(activeToolNames).not.toContain('github_search_code');
    expect(activeToolNames).not.toContain('discord_messages_search_history');
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
        finalization: {
          attempted: true,
          succeeded: true,
          completedAt: '2026-03-11T22:00:00.000Z',
          stopReason: 'step_window_exhausted',
          completionKind: 'pause_handoff',
          deliveryDisposition: 'chat_reply_with_continue',
          protocolRepairCount: 0,
          protocolRepairInstruction: null,
          toolDeliveredFinal: false,
        },
        completionKind: 'pause_handoff',
        stopReason: 'step_window_exhausted',
        deliveryDisposition: 'chat_reply_with_continue',
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
            stopReason: 'step_window_exhausted',
          }),
        }),
        toolJson: expect.objectContaining({
          graph: expect.objectContaining({
            stopReason: 'step_window_exhausted',
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
        completionKind: 'pause_handoff',
        stopReason: 'step_window_exhausted',
        deliveryDisposition: 'chat_reply_with_continue',
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
          resumeNode: 'tool_call_turn',
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

  it('prefers the persisted continuation summary over a raw tool-count fallback when the graph reply text is empty', async () => {
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText:
          'I checked the relevant web sources and still need one more pass to connect the findings cleanly.',
        graphStatus: 'interrupted',
        completionKind: 'pause_handoff',
        stopReason: 'step_window_exhausted',
        deliveryDisposition: 'chat_reply_with_continue',
        completedWindows: 1,
        totalRoundsCompleted: 2,
        toolResults: Array.from({ length: 8 }, () => ({
          name: 'web',
          success: true,
          latencyMs: 10,
        })),
        pendingInterrupt: {
          kind: 'continue_prompt',
          continuationId: 'cont-2',
          requestedByUserId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          summaryText:
            'I checked the relevant web sources and still need one more pass to connect the findings cleanly.',
          completedWindows: 1,
          maxWindows: 4,
          expiresAtIso: '2026-03-13T09:40:00.000Z',
          resumeNode: 'tool_call_turn',
        },
      }),
    );

    const result = await runChatTurn({
      traceId: 'trace-4a',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-4a',
      userText: 'keep digging',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({ messageId: 'message-4a' }),
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(result.delivery).toBe('chat_reply_with_continue');
    expect(result.replyText).toContain('I checked the relevant web sources');
    expect(result.replyText).not.toContain('Completed so far: 8 tool calls');
  });

  it('returns a normal chat reply without continuation metadata when the continuation cap is reached', async () => {
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText:
          'Verified so far: discord_admin: success.\n\nI reached the continuation limit for this request.\n\nAsk me in a new message if you want me to keep going from here.',
        graphStatus: 'completed',
        completionKind: 'pause_handoff',
        stopReason: 'max_windows_reached',
        deliveryDisposition: 'chat_reply',
        completedWindows: 4,
        totalRoundsCompleted: 4,
        pendingInterrupt: null,
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

    expect(result.delivery).toBe('chat_reply');
    expect(result.meta?.continuation).toBeUndefined();
    expect(result.replyText).toContain('I reached the continuation limit for this request.');
    expect(result.replyText).toContain('Ask me in a new message if you want me to keep going from here.');
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
      resumeNode: 'tool_call_turn',
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

  it('uses route-aware runtime failure copy when continuation resume throws', async () => {
    getGraphContinuationSessionByIdMock.mockResolvedValue({
      id: 'cont-3',
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
      resumeNode: 'tool_call_turn',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-03-13T00:00:00.000Z'),
      updatedAt: new Date('2026-03-13T00:00:00.000Z'),
    });
    resumeAgentGraphTurnMock.mockRejectedValueOnce(new Error('resume failed'));

    const result = await resumeContinuationChatTurn({
      traceId: 'trace-resume-failed',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      continuationId: 'cont-3',
      isAdmin: true,
    });

    expect(result.replyText).toBe(
      'I ran into a problem while I was picking that back up, so please press Retry or Continue again.',
    );
    expect(result.meta).toEqual({
      retry: {
        threadId: 'thread-1',
        retryKind: 'continue_resume',
      },
    });
    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        replyText:
          'I ran into a problem while I was picking that back up, so please press Retry or Continue again.',
      }),
    );
  });

  it('does not ask for Continue again when a resumed continuation finishes without producing a new continuation prompt', async () => {
    getGraphContinuationSessionByIdMock.mockResolvedValue({
      id: 'cont-4',
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
      resumeNode: 'tool_call_turn',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-03-13T00:00:00.000Z'),
      updatedAt: new Date('2026-03-13T00:00:00.000Z'),
    });
    resumeAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText:
          'Please send me one more message so I can keep going.',
        toolResults: [],
        pendingInterrupt: null,
      }),
    );

    const result = await resumeContinuationChatTurn({
      traceId: 'trace-resume-empty-final',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      continuationId: 'cont-4',
      isAdmin: true,
    });

    expect(result.delivery).toBe('chat_reply');
    expect(result.replyText).toBe('Please send me one more message so I can keep going.');
    expect(result.replyText).not.toContain('press Continue again');
  });
});

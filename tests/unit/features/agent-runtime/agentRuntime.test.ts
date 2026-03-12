import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

const {
  upsertTraceStartMock,
  updateTraceEndMock,
  clearGitHubFileLookupCacheForTraceMock,
  buildContextMessagesMock,
  globalToolRegistryMock,
  runAgentGraphTurnMock,
} = vi.hoisted(() => ({
  upsertTraceStartMock: vi.fn(),
  updateTraceEndMock: vi.fn(),
  clearGitHubFileLookupCacheForTraceMock: vi.fn(),
  buildContextMessagesMock: vi.fn(() => [{ role: 'user', content: 'hello' }]),
  globalToolRegistryMock: {
    listNames: vi.fn(() => []),
    get: vi.fn(() => undefined),
  },
  runAgentGraphTurnMock: vi.fn(),
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    CONTEXT_TRANSCRIPT_MAX_MESSAGES: 10,
    CONTEXT_TRANSCRIPT_MAX_CHARS: 4000,
    LLM_API_KEY: 'test-api-key',
    CHAT_MODEL: 'kimi',
    CHAT_MAX_OUTPUT_TOKENS: 500,
    AGENT_GRAPH_MAX_OUTPUT_TOKENS: 500,
    AGENT_GRAPH_MAX_STEPS: 2,
    AGENT_GRAPH_MAX_TOOL_CALLS_PER_STEP: 3,
    AGENT_GRAPH_TOOL_TIMEOUT_MS: 1000,
    AGENT_GRAPH_MAX_RESULT_CHARS: 4000,
    AGENT_GRAPH_READONLY_PARALLEL_ENABLED: true,
    AGENT_GRAPH_MAX_PARALLEL_READONLY: 2,
    AGENT_GRAPH_MEMO_ENABLED: false,
    AGENT_GRAPH_MEMO_MAX_ENTRIES: 10,
    AGENT_GRAPH_MEMO_TTL_MS: 1000,
    AGENT_GRAPH_MEMO_MAX_RESULT_JSON_CHARS: 1000,
    AGENT_GRAPH_MAX_DURATION_MS: 5000,
    AGENT_GRAPH_GITHUB_GROUNDED_MODE: false,
    AGENT_GRAPH_RECURSION_LIMIT: 8,
    TIMEOUT_CHAT_MS: 1000,
    TRACE_ENABLED: true,
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

vi.mock('@/features/settings/serverInstructionsRepo', () => ({
  getServerInstructionsText: vi.fn(async () => null),
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

vi.mock('@/features/voice/voiceConversationSessionStore', () => ({
  formatLiveVoiceContext: vi.fn(() => null),
}));

import { runChatTurn } from '@/features/agent-runtime/agentRuntime';
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
    deduplicatedCallCount: 0,
    truncatedCallCount: 0,
    guardrailBlockedCallCount: 0,
    cancellationCount: 0,
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
    approvalInterrupt: null,
    traceEvents: [],
    ...overrides,
  };
}

describe('agentRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildContextMessagesMock.mockReturnValue([{ role: 'user', content: 'hello' }]);
    globalToolRegistryMock.listNames.mockReturnValue([]);
    globalToolRegistryMock.get.mockReturnValue(undefined);
    upsertTraceStartMock.mockResolvedValue(undefined);
    updateTraceEndMock.mockResolvedValue(undefined);
    runAgentGraphTurnMock.mockReset();
    clearGitHubFileLookupCacheForTraceMock.mockReset();
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

  it('falls back to a short approval acknowledgement when scrubbing removes the visible draft', async () => {
    globalToolRegistryMock.listNames.mockReturnValue(['discord_admin'] as never);
    globalToolRegistryMock.get.mockReturnValue({ metadata: { access: 'admin' } } as never);
    runAgentGraphTurnMock.mockResolvedValue(
      makeGraphResult({
        replyText: 'I will call `discord_admin`.\n```json\n{"action":"update_server_instructions"}\n```',
        graphStatus: 'interrupted',
        approvalInterrupt: {
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
      userText: 'update the server instructions',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn(),
      invokedBy: 'mention',
      isAdmin: true,
    });

    expect(result.replyText).toBe('I queued that for approval.');
    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trace-1',
        approvalRequestId: 'request-1',
        replyText: 'I queued that for approval.',
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
      if (name === 'discord_admin') return { metadata: { access: 'admin' } };
      return { metadata: { access: 'public' } };
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
      if (name === 'discord_admin') return { metadata: { access: 'admin' } };
      return { metadata: { access: 'public' } };
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
          terminationReason: 'stagnation',
        },
        terminationReason: 'stagnation',
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
            terminationReason: 'stagnation',
            guardrailBlockedCallCount: 1,
          }),
        }),
        toolJson: expect.objectContaining({
          graph: expect.objectContaining({
            terminationReason: 'stagnation',
            guardrailBlockedCallCount: 1,
          }),
        }),
      }),
    );
  });
});

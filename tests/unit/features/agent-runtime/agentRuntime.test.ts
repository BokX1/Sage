import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockChat,
  upsertTraceStartMock,
  updateTraceEndMock,
  runToolCallLoopMock,
  collectPendingAdminActionIdsMock,
  clearGitHubFileLookupCacheForTraceMock,
  buildContextMessagesMock,
  globalToolRegistryMock,
} = vi.hoisted(() => ({
  mockChat: vi.fn(),
  upsertTraceStartMock: vi.fn(),
  updateTraceEndMock: vi.fn(),
  runToolCallLoopMock: vi.fn(),
  collectPendingAdminActionIdsMock: vi.fn(() => []),
  clearGitHubFileLookupCacheForTraceMock: vi.fn(),
  buildContextMessagesMock: vi.fn(() => [{ role: 'user', content: 'hello' }]),
  globalToolRegistryMock: {
    listNames: vi.fn(() => []),
    get: vi.fn(() => undefined),
  },
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    CONTEXT_TRANSCRIPT_MAX_MESSAGES: 10,
    CONTEXT_TRANSCRIPT_MAX_CHARS: 4000,
    LLM_API_KEY: 'test-api-key',
    CHAT_MODEL: 'kimi',
    AGENTIC_TOOL_LOOP_ENABLED: true,
    AGENTIC_TOOL_MAX_ROUNDS: 2,
    AGENTIC_TOOL_MAX_CALLS_PER_ROUND: 3,
    AGENTIC_TOOL_TIMEOUT_MS: 1000,
    AGENTIC_TOOL_RESULT_MAX_CHARS: 4000,
    AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED: true,
    AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY: 2,
    AGENTIC_TOOL_MEMO_ENABLED: false,
    AGENTIC_TOOL_MEMO_MAX_ENTRIES: 10,
    AGENTIC_TOOL_MEMO_TTL_MS: 1000,
    AGENTIC_TOOL_MEMO_MAX_RESULT_JSON_CHARS: 1000,
    AGENTIC_TOOL_LOOP_TIMEOUT_MS: 5000,
    CHAT_MAX_OUTPUT_TOKENS: 500,
    AGENTIC_TOOL_MAX_OUTPUT_TOKENS: 500,
    TIMEOUT_CHAT_MS: 1000,
    TRACE_ENABLED: true,
    AGENTIC_TOOL_GITHUB_GROUNDED_MODE: false,
    AUTOPILOT_MODE: null,
  },
}));

vi.mock('@/features/awareness/channelRingBuffer', () => ({
  getRecentMessages: vi.fn(() => []),
}));

vi.mock('@/features/awareness/transcriptBuilder', () => ({
  buildTranscriptBlock: vi.fn(() => null),
}));

vi.mock('@/platform/llm', () => ({
  getLLMClient: vi.fn(() => ({ chat: mockChat })),
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApiKey: vi.fn(async () => null),
}));

vi.mock('@/features/settings/guildMemoryRepo', () => ({
  getGuildMemoryText: vi.fn(async () => null),
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

vi.mock('@/features/agent-runtime/toolCallLoop', () => ({
  runToolCallLoop: runToolCallLoopMock,
}));

vi.mock('@/features/agent-runtime/toolGrounding', () => ({
  enforceGitHubFileGrounding: vi.fn((replyText: string) => ({
    modified: false,
    replyText,
    ungroundedPaths: [],
    successfulPaths: [],
  })),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  clearGitHubFileLookupCacheForTrace: clearGitHubFileLookupCacheForTraceMock,
}));

vi.mock('@/features/agent-runtime/pendingApprovals', () => ({
  collectPendingAdminActionIds: collectPendingAdminActionIdsMock,
}));

vi.mock('@/features/agent-runtime/autopilotMode', () => ({
  resolveRuntimeAutopilotMode: vi.fn(() => null),
}));

vi.mock('@/features/agent-runtime/toolRegistry', () => ({
  ToolRegistry: class {
    register() {}
    listOpenAIToolSpecs() {
      return [];
    }
  },
  globalToolRegistry: globalToolRegistryMock,
}));

vi.mock('@/features/voice/voiceConversationSessionStore', () => ({
  formatLiveVoiceContext: vi.fn(() => null),
}));

import { runChatTurn, scrubFinalReplyText } from '@/features/agent-runtime/agentRuntime';

describe('agentRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildContextMessagesMock.mockReturnValue([{ role: 'user', content: 'hello' }]);
    collectPendingAdminActionIdsMock.mockReturnValue([]);
    globalToolRegistryMock.listNames.mockReturnValue([]);
    globalToolRegistryMock.get.mockReturnValue(undefined);
    upsertTraceStartMock.mockResolvedValue(undefined);
    updateTraceEndMock.mockResolvedValue(undefined);
    runToolCallLoopMock.mockReset();
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
    globalToolRegistryMock.get.mockReturnValue({ metadata: { access: 'public' } } as never);
    mockChat.mockResolvedValue({
      text: 'I will call `discord_admin`.\n```json\n{"action":"update_server_instructions"}\n```',
      reasoningText: 'hidden provider reasoning',
      toolCalls: [],
    });
    runToolCallLoopMock.mockResolvedValue({
      replyText: 'I will call `discord_admin`.\n```json\n{"status":"pending_approval","actionId":"action-1"}\n```',
      toolsExecuted: true,
      roundsCompleted: 1,
      toolResults: [
        {
          name: 'discord_admin',
          success: true,
          result: { status: 'pending_approval', actionId: 'action-1' },
          latencyMs: 5,
        },
      ],
      deduplicatedCallCount: 0,
      truncatedCallCount: 0,
      roundEvents: [],
      finalization: {
        attempted: false,
        succeeded: true,
        fallbackUsed: false,
        returnedToolCallCount: 0,
        completedAt: '2026-03-09T10:00:00.000Z',
      },
      cancellationCount: 0,
    });
    collectPendingAdminActionIdsMock.mockReturnValue(['action-1'] as never);

    const result = await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'message-1',
      userText: 'update the server instructions',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isAdmin: true,
    });

    expect(result.replyText).toBe('I queued that for approval.');
    expect(result.pendingAdminActionIds).toEqual(['action-1']);
  });

  it('does not persist provider reasoning text into traces', async () => {
    mockChat.mockResolvedValue({
      text: 'Visible reply',
      reasoningText: 'Need a quick lookup first.',
      toolCalls: [],
    });

    await runChatTurn({
      traceId: 'trace-2',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: null,
      messageId: 'message-2',
      userText: 'hello',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isAdmin: false,
    });

    expect(updateTraceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trace-2',
        reasoningText: null,
        replyText: 'Visible reply',
      }),
    );
  });
});

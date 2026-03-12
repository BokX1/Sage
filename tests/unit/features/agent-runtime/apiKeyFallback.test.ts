import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

const mockConfig = vi.hoisted(() => ({
  LLM_API_KEY: 'env-key',
  TRACE_ENABLED: false,
  TIMEOUT_CHAT_MS: 1000,
  CHAT_MODEL: 'kimi',
  CHAT_MAX_OUTPUT_TOKENS: 800,
  AGENT_GRAPH_MAX_OUTPUT_TOKENS: 800,
  AGENT_GRAPH_GITHUB_GROUNDED_MODE: false,
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 5,
  CONTEXT_TRANSCRIPT_MAX_CHARS: 2000,
  AUTOPILOT_MODE: null,
}));

const mockGetGuildApiKey = vi.hoisted(() => vi.fn());
const mockGetGuildSagePersonaText = vi.hoisted(() => vi.fn());
const mockRunAgentGraphTurn = vi.hoisted(() => vi.fn());
const globalToolRegistryMock = vi.hoisted(() => ({
  listNames: vi.fn(() => []),
  get: vi.fn(() => undefined),
}));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

vi.mock('@/features/awareness/channelRingBuffer', () => ({
  getRecentMessages: vi.fn().mockReturnValue([]),
}));

vi.mock('@/features/awareness/transcriptBuilder', () => ({
  buildTranscriptBlock: vi.fn().mockReturnValue(null),
}));

vi.mock('@/features/agent-runtime/contextBuilder', () => ({
  buildContextMessages: vi.fn().mockReturnValue([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' },
  ]),
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/features/agent-runtime/agent-trace-repo', () => ({
  upsertTraceStart: vi.fn(),
  updateTraceEnd: vi.fn(),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  clearGitHubFileLookupCacheForTrace: vi.fn(),
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
  runAgentGraphTurn: mockRunAgentGraphTurn,
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApiKey: mockGetGuildApiKey,
}));

vi.mock('@/features/settings/guildSagePersonaRepo', () => ({
  getGuildSagePersonaText: mockGetGuildSagePersonaText,
}));

vi.mock('@/features/agent-runtime/toolRegistry', () => ({
  globalToolRegistry: globalToolRegistryMock,
}));

import { runChatTurn } from '@/features/agent-runtime/agentRuntime';

function makeCurrentTurn(overrides: Partial<CurrentTurnContext> = {}): CurrentTurnContext {
  return {
    invokerUserId: 'user-1',
    invokerDisplayName: 'User One',
    messageId: 'msg-1',
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

function makeGraphResult(overrides: Partial<Awaited<ReturnType<typeof mockRunAgentGraphTurn>>> = {}) {
  return {
    replyText: 'ok',
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

describe('agent runtime API key fallback', () => {
  beforeEach(() => {
    mockConfig.LLM_API_KEY = 'env-key';
    mockGetGuildSagePersonaText.mockResolvedValue(null);
    mockRunAgentGraphTurn.mockReset();
    globalToolRegistryMock.listNames.mockReturnValue([]);
    globalToolRegistryMock.get.mockReturnValue(undefined);
  });

  it('uses global API key when guild key is unavailable', async () => {
    mockRunAgentGraphTurn.mockResolvedValueOnce(makeGraphResult({ replyText: 'ok' }));
    mockGetGuildApiKey.mockResolvedValueOnce(undefined);

    const result = await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-1',
      userText: 'Hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn(),
    });

    expect(result.replyText).toBe('ok');
    expect(mockRunAgentGraphTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'env-key',
      }),
    );
  });

  it('returns setup guidance when no keys are available', async () => {
    mockConfig.LLM_API_KEY = '';
    mockGetGuildApiKey.mockResolvedValueOnce(undefined);

    const result = await runChatTurn({
      traceId: 'trace-2',
      userId: 'user-2',
      channelId: 'channel-2',
      guildId: 'guild-2',
      messageId: 'msg-2',
      userText: 'Hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        invokerUserId: 'user-2',
        invokerDisplayName: 'User Two',
        messageId: 'msg-2',
        guildId: 'guild-2',
        channelId: 'channel-2',
      }),
    });

    expect(result.replyText).toContain('I need a server API key before I can respond here');
    expect(result.meta).toEqual({ kind: 'missing_api_key' });
    expect(mockRunAgentGraphTurn).not.toHaveBeenCalled();
  });
});

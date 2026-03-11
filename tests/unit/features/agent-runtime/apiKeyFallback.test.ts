import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

const mockConfig = vi.hoisted(() => ({
  LLM_API_KEY: 'env-key',
  TRACE_ENABLED: false,
  TIMEOUT_CHAT_MS: 1000,
  CHAT_MODEL: 'kimi',
  CHAT_MAX_OUTPUT_TOKENS: 800,
  AGENTIC_TOOL_LOOP_ENABLED: false,
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 5,
  CONTEXT_TRANSCRIPT_MAX_CHARS: 2000,
}));

const mockGetLLMClient = vi.hoisted(() => vi.fn());
const mockGetGuildApiKey = vi.hoisted(() => vi.fn());
const mockGetServerInstructionsText = vi.hoisted(() => vi.fn());

const mockLLM = {
  chat: vi.fn(),
};

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

vi.mock('@/platform/llm', () => ({
  getLLMClient: mockGetLLMClient,
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

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApiKey: mockGetGuildApiKey,
}));

vi.mock('@/features/settings/serverInstructionsRepo', () => ({
  getServerInstructionsText: mockGetServerInstructionsText,
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

describe('agent runtime API key fallback', () => {
  beforeEach(() => {
    mockConfig.LLM_API_KEY = 'env-key';
    mockGetLLMClient.mockReturnValue(mockLLM);
    mockGetServerInstructionsText.mockResolvedValue(null);
    mockLLM.chat.mockReset();
  });

  it('uses global API key when guild key is unavailable', async () => {
    mockLLM.chat.mockResolvedValueOnce({ text: 'ok' });
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
    expect(mockLLM.chat).toHaveBeenCalledWith(
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
    expect(mockLLM.chat).not.toHaveBeenCalled();
  });
});

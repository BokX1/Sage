import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const mockLLM = {
  chat: vi.fn(),
};

vi.mock('@/config', () => ({
  config: mockConfig,
}));

vi.mock('@/core/llm', () => ({
  getLLMClient: mockGetLLMClient,
}));

vi.mock('@/core/awareness/channelRingBuffer', () => ({
  getRecentMessages: vi.fn().mockReturnValue([]),
}));

vi.mock('@/core/awareness/transcriptBuilder', () => ({
  buildTranscriptBlock: vi.fn().mockReturnValue(null),
}));

vi.mock('@/core/agentRuntime/contextBuilder', () => ({
  buildContextMessages: vi.fn().mockReturnValue([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' },
  ]),
}));

vi.mock('@/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/core/agentRuntime/agent-trace-repo', () => ({
  upsertTraceStart: vi.fn(),
  updateTraceEnd: vi.fn(),
}));

vi.mock('@/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: mockGetGuildApiKey,
}));

import { runChatTurn } from '@/core/agentRuntime/agentRuntime';

describe('agent runtime API key fallback', () => {
  beforeEach(() => {
    mockConfig.LLM_API_KEY = 'env-key';
    mockGetLLMClient.mockReturnValue(mockLLM);
    mockLLM.chat.mockReset();
  });

  it('uses global API key when guild key is unavailable', async () => {
    mockLLM.chat.mockResolvedValueOnce({ content: 'ok' });
    mockGetGuildApiKey.mockResolvedValueOnce(undefined);

    const result = await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-1',
      userText: 'Hello',
      userProfileSummary: null,
      replyToBotText: null,
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
      replyToBotText: null,
    });

    expect(result.replyText).toContain('I need a server API key before I can respond here');
    expect(result.replyText).toContain('/sage key login');
    expect(mockLLM.chat).not.toHaveBeenCalled();
  });
});

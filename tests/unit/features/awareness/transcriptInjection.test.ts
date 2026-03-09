import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 5,
  CONTEXT_TRANSCRIPT_MAX_CHARS: 2000,
  CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT: 4000,
  CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY: 2000,
  CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY: 2000,
  CONTEXT_BLOCK_MAX_TOKENS_MEMORY: 2000,
  CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT: 1000,
  CONTEXT_BLOCK_MAX_TOKENS_PROVIDERS: 2000,
  CONTEXT_USER_MAX_TOKENS: 8000,
  CONTEXT_MAX_INPUT_TOKENS: 16000,
  CONTEXT_RESERVED_OUTPUT_TOKENS: 4000,
  CONTEXT_TRUNCATION_NOTICE: true,
  AUTOPILOT_MODE: 'manual',
  RAW_MESSAGE_TTL_DAYS: 3,
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: 200,
  CHAT_MODEL: 'kimi',
  CHAT_MAX_OUTPUT_TOKENS: 800,
  AGENTIC_TOOL_LOOP_ENABLED: false,
  TIMEOUT_CHAT_MS: 1000,
  LLM_API_KEY: 'test-key',
  TRACE_ENABLED: false,
}));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

const mockChat = vi.hoisted(() => ({
  chat: vi.fn(),
}));
const mockGetServerInstructionsText = vi.hoisted(() => vi.fn());

vi.mock('@/platform/llm', () => ({
  getLLMClient: () => mockChat,
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(),
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApiKey: vi.fn().mockResolvedValue('test-key'),
}));

vi.mock('@/features/settings/serverInstructionsRepo', () => ({
  getServerInstructionsText: mockGetServerInstructionsText,
}));

vi.mock('@/features/agent-runtime/agent-trace-repo', () => ({
  upsertTraceStart: vi.fn().mockResolvedValue(undefined),
  updateTraceEnd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  clearGitHubFileLookupCacheForTrace: vi.fn(),
}));

import { appendMessage, clearChannel } from '../../../../src/features/awareness/channelRingBuffer';
import { runChatTurn } from '../../../../src/features/agent-runtime/agentRuntime';
import { isLoggingEnabled } from '../../../../src/features/settings/guildChannelSettings';

describe('transcript injection', () => {
  beforeEach(() => {
    clearChannel({ guildId: 'guild-1', channelId: 'channel-1' });
    mockChat.chat.mockClear();
    mockChat.chat.mockResolvedValue({ text: 'ok' });
    mockGetServerInstructionsText.mockResolvedValue(null);
    vi.mocked(isLoggingEnabled).mockReturnValue(true);
  });

  it('includes a transcript block when logging is enabled', async () => {
    appendMessage({
      messageId: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'user-1',
      authorDisplayName: 'User One',
      authorIsBot: false,
      timestamp: new Date(),
      content: 'Hello there',
      replyToMessageId: undefined,
      mentionsUserIds: [],
      mentionsBot: false,
    });

    await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-1',
      userText: 'Invoke',
      userProfileSummary: null,
      replyToBotText: null,
    });

    const call = mockChat.chat.mock.calls[0][0];
    const transcriptMessage = call.messages.find(
      (message: { role: string; content: string }) =>
        message.role === 'system' && message.content.includes('Recent channel transcript'),
    );

    expect(transcriptMessage?.content).toContain('@User One');
    expect(transcriptMessage?.content).toContain('Hello there');
  });

  it('skips transcript block when logging is disabled', async () => {
    vi.mocked(isLoggingEnabled).mockReturnValue(false);
    appendMessage({
      messageId: 'msg-2',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'user-2',
      authorDisplayName: 'User Two',
      authorIsBot: false,
      timestamp: new Date(),
      content: 'No log',
      replyToMessageId: undefined,
      mentionsUserIds: [],
      mentionsBot: false,
    });

    await runChatTurn({
      traceId: 'trace-2',
      userId: 'user-2',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-2',
      userText: 'Invoke',
      userProfileSummary: null,
      replyToBotText: null,
    });

    const call = mockChat.chat.mock.calls[0][0];
    const hasTranscript = call.messages.some(
      (message: { role: string; content: string }) =>
        message.role === 'system' && message.content.includes('Recent channel transcript'),
    );

    expect(hasTranscript).toEqual(false);
    expect(
      call.messages.filter(
        (message: { role: string; content: string }) =>
          message.role === 'system' && message.content.includes('Recent channel transcript'),
      ),
    ).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 5,
  CONTEXT_TRANSCRIPT_MAX_CHARS: 2000,
  RAW_MESSAGE_TTL_DAYS: 3,
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: 200,
  SUMMARY_ROLLING_WINDOW_MIN: 60,
}));

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

const mockChat = vi.hoisted(() => ({
  chat: vi.fn(),
}));

vi.mock('../../../src/core/llm', () => ({
  getLLMClient: () => mockChat,
}));

vi.mock('../../../src/core/config/legacy-config-adapter', () => ({
  config: {
    llmProvider: 'pollinations',
    logLevel: 'error',
  },
}));

vi.mock('../../../src/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(),
}));

vi.mock('../../../src/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: vi.fn().mockResolvedValue('test-key'),
}));

vi.mock('../../../src/core/agentRuntime/agent-trace-repo', () => ({
  upsertTraceStart: vi.fn().mockResolvedValue(undefined),
  updateTraceEnd: vi.fn().mockResolvedValue(undefined),
  replaceAgentRuns: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/core/orchestration/llmRouter', () => ({
  decideRoute: vi.fn().mockResolvedValue({ kind: 'simple', temperature: 0.7, experts: [] }),
}));

vi.mock('../../../src/core/orchestration/runExperts', () => ({
  runExperts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/core/llm/model-resolver', () => ({
  resolveModelForRequest: vi.fn().mockResolvedValue('kimi'),
  resolveModelForRequestDetailed: vi.fn().mockResolvedValue({
    model: 'kimi',
    route: 'chat',
    requirements: {},
    allowlistApplied: false,
    candidates: ['kimi'],
    decisions: [{ model: 'kimi', accepted: true, reason: 'selected', healthScore: 0.5 }],
  }),
}));

import { appendMessage, clearChannel } from '../../../src/core/awareness/channelRingBuffer';
import { runChatTurn } from '../../../src/core/agentRuntime/agentRuntime';
import { isLoggingEnabled } from '../../../src/core/settings/guildChannelSettings';
import { InMemoryChannelSummaryStore } from '../../../src/core/summary/inMemoryChannelSummaryStore';
import { setChannelSummaryStore } from '../../../src/core/summary/channelSummaryStoreRegistry';

describe('transcript injection', () => {
  let summaryStore: InMemoryChannelSummaryStore;

  beforeEach(() => {
    clearChannel({ guildId: 'guild-1', channelId: 'channel-1' });
    mockChat.chat.mockClear();
    mockChat.chat.mockResolvedValue({ content: 'ok' });
    vi.mocked(isLoggingEnabled).mockReturnValue(true);
    summaryStore = new InMemoryChannelSummaryStore();
    setChannelSummaryStore(summaryStore);
  });

  afterEach(() => {
    setChannelSummaryStore(null);
  });

  it('includes a transcript block when logging is enabled', async () => {
    appendMessage({
      messageId: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'user-1',
      authorDisplayName: 'User One',
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

    expect(hasTranscript).toBe(false);
  });

  it('includes ChannelMemory packet before the transcript', async () => {
    const now = new Date();
    await summaryStore.upsertSummary({
      guildId: 'guild-1',
      channelId: 'channel-1',
      kind: 'rolling',
      windowStart: new Date(now.getTime() - 60 * 60 * 1000),
      windowEnd: now,
      summaryText: 'Rolling summary text.',
      topics: [],
      threads: [],
      unresolved: [],
      glossary: {},
    });
    await summaryStore.upsertSummary({
      guildId: 'guild-1',
      channelId: 'channel-1',
      kind: 'profile',
      windowStart: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      windowEnd: now,
      summaryText: 'Profile summary text.',
      topics: [],
      threads: [],
      unresolved: [],
      glossary: {},
    });

    appendMessage({
      messageId: 'msg-3',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'user-3',
      authorDisplayName: 'User Three',
      timestamp: new Date(),
      content: 'Summary window',
      replyToMessageId: undefined,
      mentionsUserIds: [],
      mentionsBot: false,
    });

    await runChatTurn({
      traceId: 'trace-3',
      userId: 'user-3',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-3',
      userText: 'Invoke',
      userProfileSummary: null,
      replyToBotText: null,
    });

    const call = mockChat.chat.mock.calls[0][0];
    const messages = call.messages as { role: string; content: string }[];
    const systemContent = messages[0].content;

    const channelMemoryIndex = systemContent.indexOf('[ChannelMemory] Channel memory (STM+LTM):');
    const shortTermIndex = systemContent.indexOf('Short-term memory');
    const longTermIndex = systemContent.indexOf('Long-term memory');
    const transcriptIndex = systemContent.indexOf('Recent channel transcript');

    expect(channelMemoryIndex).toBeGreaterThan(-1);
    expect(shortTermIndex).toBeGreaterThan(-1);
    expect(longTermIndex).toBeGreaterThan(-1);
    expect(transcriptIndex).toBeGreaterThan(-1);
    expect(channelMemoryIndex).toBeLessThan(transcriptIndex);
    expect(shortTermIndex).toBeLessThan(transcriptIndex);
    expect(longTermIndex).toBeLessThan(transcriptIndex);
  });

  it('keeps ChannelMemory packet but omits transcript when logging is disabled', async () => {
    vi.mocked(isLoggingEnabled).mockReturnValue(false);
    const now = new Date();
    await summaryStore.upsertSummary({
      guildId: 'guild-1',
      channelId: 'channel-1',
      kind: 'rolling',
      windowStart: new Date(now.getTime() - 60 * 60 * 1000),
      windowEnd: now,
      summaryText: 'Rolling summary text.',
      topics: [],
      threads: [],
      unresolved: [],
      glossary: {},
    });

    await runChatTurn({
      traceId: 'trace-4',
      userId: 'user-4',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-4',
      userText: 'Invoke',
      userProfileSummary: null,
      replyToBotText: null,
    });

    const call = mockChat.chat.mock.calls[0][0];
    const hasChannelMemoryPacket = call.messages.some(
      (message: { role: string; content: string }) =>
        message.role === 'system' && message.content.includes('[ChannelMemory] Channel memory (STM+LTM):'),
    );
    const hasTranscript = call.messages.some(
      (message: { role: string; content: string }) =>
        message.role === 'system' && message.content.includes('Recent channel transcript'),
    );

    expect(hasChannelMemoryPacket).toBe(true);
    expect(hasTranscript).toBe(false);
  });
});

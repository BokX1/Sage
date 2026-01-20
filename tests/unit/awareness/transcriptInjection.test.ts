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

vi.mock('../../../src/core/config/env', () => ({
  config: {
    llmProvider: 'pollinations',
    logLevel: 'error',
  },
}));

vi.mock('../../../src/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(),
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
      timestamp: new Date('2026-01-18T12:00:00.000Z'),
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
      timestamp: new Date('2026-01-18T12:05:00.000Z'),
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

  it('includes rolling and profile summaries before the transcript', async () => {
    await summaryStore.upsertSummary({
      guildId: 'guild-1',
      channelId: 'channel-1',
      kind: 'rolling',
      windowStart: new Date('2026-01-18T11:00:00.000Z'),
      windowEnd: new Date('2026-01-18T12:00:00.000Z'),
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
      windowStart: new Date('2026-01-18T10:00:00.000Z'),
      windowEnd: new Date('2026-01-18T12:00:00.000Z'),
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
      timestamp: new Date('2026-01-18T12:10:00.000Z'),
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

    const rollingIndex = systemContent.indexOf('Channel rolling summary');
    const profileIndex = systemContent.indexOf('Channel profile');
    const transcriptIndex = systemContent.indexOf('Recent channel transcript');

    expect(rollingIndex).toBeGreaterThan(-1);
    expect(profileIndex).toBeGreaterThan(-1);
    expect(transcriptIndex).toBeGreaterThan(-1);
    expect(profileIndex).toBeLessThan(rollingIndex);
    expect(rollingIndex).toBeLessThan(transcriptIndex);
  });

  it('omits summaries when logging is disabled', async () => {
    vi.mocked(isLoggingEnabled).mockReturnValue(false);
    await summaryStore.upsertSummary({
      guildId: 'guild-1',
      channelId: 'channel-1',
      kind: 'rolling',
      windowStart: new Date('2026-01-18T11:00:00.000Z'),
      windowEnd: new Date('2026-01-18T12:00:00.000Z'),
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
    const hasRollingSummary = call.messages.some(
      (message: { role: string; content: string }) =>
        message.role === 'system' && message.content.startsWith('Channel rolling summary'),
    );
    const hasProfileSummary = call.messages.some(
      (message: { role: string; content: string }) =>
        message.role === 'system' && message.content.startsWith('Channel profile'),
    );

    expect(hasRollingSummary).toBe(false);
    expect(hasProfileSummary).toBe(false);
  });
});

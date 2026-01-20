import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  SUMMARY_ROLLING_MIN_MESSAGES: 2,
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: 300,
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: 21600,
  SUMMARY_ROLLING_WINDOW_MIN: 60,
  SUMMARY_SCHED_TICK_SEC: 60,
  SUMMARY_MAX_CHARS: 1800,
  MESSAGE_DB_STORAGE_ENABLED: false,
  RAW_MESSAGE_TTL_DAYS: 3,
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: 200,
}));

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/core/config/env', () => ({
  config: {
    llmProvider: 'pollinations',
    pollinationsBaseUrl: '',
    pollinationsApiKey: undefined,
    pollinationsModel: 'gemini',
  },
}));

vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(() => true),
}));

import { InMemoryMessageStore } from '../../../src/core/awareness/messageStore';
import { InMemoryChannelSummaryStore } from '../../../src/core/summary/inMemoryChannelSummaryStore';
import { ChannelSummaryScheduler } from '../../../src/core/summary/channelSummaryScheduler';
import { isLoggingEnabled } from '../../../src/core/settings/guildChannelSettings';

function createMessage(params: {
  id: string;
  guildId: string;
  channelId: string;
  timestamp: Date;
  content: string;
}): any {
  return {
    messageId: params.id,
    guildId: params.guildId,
    channelId: params.channelId,
    authorId: 'user-1',
    authorDisplayName: 'User',
    timestamp: params.timestamp,
    content: params.content,
    replyToMessageId: undefined,
    mentionsUserIds: [],
    mentionsBot: false,
  };
}

describe('ChannelSummaryScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLoggingEnabled).mockReturnValue(true);
  });

  it('upserts rolling summary and respects min interval', async () => {
    const summaryStore = new InMemoryChannelSummaryStore();
    const messageStore = new InMemoryMessageStore();
    const nowMs = Date.now();
    const summarizeWindow = vi.fn().mockResolvedValue({
      windowStart: new Date(nowMs - 1000),
      windowEnd: new Date(nowMs),
      summaryText: 'Rolling summary',
      topics: [],
      threads: [],
      unresolved: [],
      glossary: {},
    });
    const summarizeProfile = vi.fn().mockResolvedValue({
      windowStart: new Date(nowMs - 1000),
      windowEnd: new Date(nowMs),
      summaryText: 'Profile summary',
      topics: [],
      threads: [],
      unresolved: [],
      glossary: {},
    });

    const scheduler = new ChannelSummaryScheduler({
      summaryStore,
      messageStore,
      summarizeWindow,
      summarizeProfile,
      now: () => nowMs,
    });

    await messageStore.append(
      createMessage({
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        timestamp: new Date(nowMs - 500),
        content: 'First',
      }),
    );
    await messageStore.append(
      createMessage({
        id: 'msg-2',
        guildId: 'guild-1',
        channelId: 'channel-1',
        timestamp: new Date(nowMs - 400),
        content: 'Second',
      }),
    );

    scheduler.markDirty({
      guildId: 'guild-1',
      channelId: 'channel-1',
      lastMessageAt: new Date(nowMs - 400),
    });
    scheduler.markDirty({
      guildId: 'guild-1',
      channelId: 'channel-1',
      lastMessageAt: new Date(nowMs - 300),
    });

    const upsertSpy = vi.spyOn(summaryStore, 'upsertSummary');

    await scheduler.tick();

    expect(summarizeWindow).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalled();

    scheduler.markDirty({
      guildId: 'guild-1',
      channelId: 'channel-1',
      lastMessageAt: new Date(nowMs - 200),
    });
    scheduler.markDirty({
      guildId: 'guild-1',
      channelId: 'channel-1',
      lastMessageAt: new Date(nowMs - 100),
    });

    await scheduler.tick();

    expect(summarizeWindow).toHaveBeenCalledTimes(1);
  });

  it('skips channels when logging is disabled', async () => {
    const summaryStore = new InMemoryChannelSummaryStore();
    const messageStore = new InMemoryMessageStore();
    const nowMs = Date.now();
    const summarizeWindow = vi.fn();

    vi.mocked(isLoggingEnabled).mockReturnValue(false);

    const scheduler = new ChannelSummaryScheduler({
      summaryStore,
      messageStore,
      summarizeWindow,
      summarizeProfile: vi.fn(),
      now: () => nowMs,
    });

    scheduler.markDirty({
      guildId: 'guild-1',
      channelId: 'channel-1',
      lastMessageAt: new Date(nowMs),
    });

    const upsertSpy = vi.spyOn(summaryStore, 'upsertSummary');

    await scheduler.tick();

    expect(summarizeWindow).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

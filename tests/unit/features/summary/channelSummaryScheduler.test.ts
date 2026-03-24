import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelMessage } from '@/features/awareness/awareness-types';

const mockConfig = vi.hoisted(() => ({
  SUMMARY_ROLLING_MIN_MESSAGES: 2,
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: 300,
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: 21600,
  SUMMARY_ROLLING_WINDOW_MIN: 60,
  SUMMARY_SCHED_TICK_SEC: 60,
  MESSAGE_DB_STORAGE_ENABLED: false,
  RAW_MESSAGE_TTL_DAYS: 3,
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: 200,
  AI_PROVIDER_API_KEY: '',
}));

const mockResolveTextProviderRoute = vi.hoisted(() => vi.fn());

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(() => true),
}));

vi.mock('@/features/agent-runtime/apiKeyResolver', () => ({
  resolveTextProviderRoute: mockResolveTextProviderRoute,
}));

import { InMemoryMessageStore } from '@/features/awareness/messageStore';
import { InMemoryChannelSummaryStore } from '@/features/summary/inMemoryChannelSummaryStore';
import { ChannelSummaryScheduler } from '@/features/summary/channelSummaryScheduler';
import { isLoggingEnabled } from '@/features/settings/guildChannelSettings';

function createMessage(params: {
  id: string;
  guildId: string;
  channelId: string;
  timestamp: Date;
  content: string;
  authorId?: string;
  authorDisplayName?: string;
  authorIsBot?: boolean;
}): ChannelMessage {
  return {
    messageId: params.id,
    guildId: params.guildId,
    channelId: params.channelId,
    authorId: params.authorId ?? 'user-1',
    authorDisplayName: params.authorDisplayName ?? 'User',
    authorIsBot: params.authorIsBot ?? false,
    timestamp: params.timestamp,
    content: params.content,
    mentionsUserIds: [],
    mentionsBot: false,
  };
}

describe('ChannelSummaryScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLoggingEnabled).mockReturnValue(true);
    mockResolveTextProviderRoute.mockResolvedValue({
      providerId: 'openai_codex',
      lane: 'summary',
      baseUrl: 'https://chatgpt.com/backend-api',
      model: 'gpt-5.4',
      apiKey: 'host-codex-token',
      authSource: 'host_codex_auth',
      fallbackRoute: {
        providerId: 'default',
        baseUrl: 'https://fallback.example/v1',
        model: 'summary-model',
        apiKey: 'fallback-key',
        authSource: 'host_api_key',
      },
    });
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
      decisions: [],
      actionItems: [],
      unresolved: [],
      glossary: {},
    });
    const summarizeProfile = vi.fn().mockResolvedValue({
      windowStart: new Date(nowMs - 1000),
      windowEnd: new Date(nowMs),
      summaryText: 'Profile summary',
      topics: [],
      threads: [],
      decisions: [],
      actionItems: [],
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
    expect(summarizeWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai_codex',
        providerBaseUrl: 'https://chatgpt.com/backend-api',
        providerModel: 'gpt-5.4',
        apiKey: 'host-codex-token',
        apiKeySource: 'host_codex_auth',
        fallbackRoute: expect.objectContaining({
          providerId: 'default',
          baseUrl: 'https://fallback.example/v1',
          model: 'summary-model',
          apiKey: 'fallback-key',
          authSource: 'host_api_key',
        }),
      }),
    );
    expect(summarizeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai_codex',
        providerBaseUrl: 'https://chatgpt.com/backend-api',
        providerModel: 'gpt-5.4',
        apiKey: 'host-codex-token',
        apiKeySource: 'host_codex_auth',
        fallbackRoute: expect.objectContaining({
          providerId: 'default',
          baseUrl: 'https://fallback.example/v1',
          model: 'summary-model',
          apiKey: 'fallback-key',
          authSource: 'host_api_key',
        }),
      }),
    );
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

  it('does not summarize bot-only dirty activity', async () => {
    const summaryStore = new InMemoryChannelSummaryStore();
    const messageStore = new InMemoryMessageStore();
    const nowMs = Date.now();
    const summarizeWindow = vi.fn();
    const summarizeProfile = vi.fn();

    const scheduler = new ChannelSummaryScheduler({
      summaryStore,
      messageStore,
      summarizeWindow,
      summarizeProfile,
      now: () => nowMs,
    });

    await messageStore.append(
      createMessage({
        id: 'msg-bot-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        timestamp: new Date(nowMs - 500),
        content: 'Sage status update',
        authorId: 'sage-bot',
        authorDisplayName: 'Sage',
        authorIsBot: true,
      }),
    );
    await messageStore.append(
      createMessage({
        id: 'msg-bot-2',
        guildId: 'guild-1',
        channelId: 'channel-1',
        timestamp: new Date(nowMs - 400),
        content: 'DeployBot completed successfully',
        authorId: 'deploy-bot',
        authorDisplayName: 'DeployBot',
        authorIsBot: true,
      }),
    );

    scheduler.markDirty({
      guildId: 'guild-1',
      channelId: 'channel-1',
      lastMessageAt: new Date(nowMs - 400),
      messageCountIncrement: 1,
      humanMessageCountIncrement: 0,
    });
    scheduler.markDirty({
      guildId: 'guild-1',
      channelId: 'channel-1',
      lastMessageAt: new Date(nowMs - 300),
      messageCountIncrement: 1,
      humanMessageCountIncrement: 0,
    });

    await scheduler.tick();

    expect(summarizeWindow).not.toHaveBeenCalled();
    expect(summarizeProfile).not.toHaveBeenCalled();
  });

  it('resolves and forwards the summary provider route during forceSummarize', async () => {
    const summaryStore = new InMemoryChannelSummaryStore();
    const messageStore = new InMemoryMessageStore();
    const nowMs = Date.now();
    const summarizeWindow = vi.fn().mockResolvedValue({
      windowStart: new Date(nowMs - 1000),
      windowEnd: new Date(nowMs),
      summaryText: 'Rolling summary',
      topics: [],
      threads: [],
      decisions: [],
      actionItems: [],
      unresolved: [],
      glossary: {},
    });
    const summarizeProfile = vi.fn().mockResolvedValue({
      windowStart: new Date(nowMs - 1000),
      windowEnd: new Date(nowMs),
      summaryText: 'Profile summary',
      topics: [],
      threads: [],
      decisions: [],
      actionItems: [],
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
        id: 'msg-force-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        timestamp: new Date(nowMs - 500),
        content: 'Force summary me',
      }),
    );

    await scheduler.forceSummarize('guild-1', 'channel-1');

    expect(mockResolveTextProviderRoute).toHaveBeenCalledWith('guild-1', 'summary');
    expect(summarizeWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai_codex',
        providerBaseUrl: 'https://chatgpt.com/backend-api',
        providerModel: 'gpt-5.4',
        apiKey: 'host-codex-token',
        apiKeySource: 'host_codex_auth',
      }),
    );
    expect(summarizeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai_codex',
        providerBaseUrl: 'https://chatgpt.com/backend-api',
        providerModel: 'gpt-5.4',
        apiKey: 'host-codex-token',
        apiKeySource: 'host_codex_auth',
      }),
    );
  });
});

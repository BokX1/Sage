/**
 * @module tests/unit/chatEngine.test
 * @description Defines the chat engine.test module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunChatTurn = vi.hoisted(() => vi.fn());
const mockGetUserProfileRecord = vi.hoisted(() => vi.fn());
const mockUpsertUserProfile = vi.hoisted(() => vi.fn());
const mockGetGuildApiKey = vi.hoisted(() => vi.fn());
const mockUpdateProfileSummary = vi.hoisted(() => vi.fn());
const mockNeedsCompaction = vi.hoisted(() => vi.fn());
const mockCompactUserProfile = vi.hoisted(() => vi.fn());

const mockConfig = vi.hoisted(() => ({
  LLM_API_KEY: 'bot-key',
  PROFILE_UPDATE_INTERVAL: 1,
}));

vi.mock('@/config', () => ({
  config: mockConfig,
}));

vi.mock('@/core/agentRuntime', () => ({
  runChatTurn: mockRunChatTurn,
}));

vi.mock('@/core/memory/userProfileRepo', () => ({
  getUserProfileRecord: mockGetUserProfileRecord,
  upsertUserProfile: mockUpsertUserProfile,
}));

vi.mock('@/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: mockGetGuildApiKey,
}));

vi.mock('@/core/memory/profileUpdater', () => ({
  updateProfileSummary: mockUpdateProfileSummary,
}));

vi.mock('@/core/memory/userProfileCompaction', () => ({
  compactUserProfile: mockCompactUserProfile,
  needsCompaction: mockNeedsCompaction,
  USER_COMPACTION_INTERVAL_DAYS: 30,
}));

import { __resetChatEngineStateForTests, generateChatReply } from '@/core/chat-engine';

describe('ChatEngine', () => {
  beforeEach(() => {
    __resetChatEngineStateForTests();
    mockConfig.LLM_API_KEY = 'bot-key';
    mockConfig.PROFILE_UPDATE_INTERVAL = 1;
    mockGetUserProfileRecord.mockResolvedValue(null);
    mockGetGuildApiKey.mockResolvedValue('guild-key');
    mockNeedsCompaction.mockReturnValue(false);
    mockCompactUserProfile.mockResolvedValue(null);
    mockRunChatTurn.mockResolvedValue({ replyText: 'ok' });
    mockUpdateProfileSummary.mockResolvedValue('New Summary');
    mockUpsertUserProfile.mockResolvedValue(undefined);
  });

  it('returns replyText from the agent runtime', async () => {
    mockRunChatTurn.mockResolvedValueOnce({ replyText: 'Hello there!' });

    const result = await generateChatReply({
      traceId: 'test-trace',
      userId: 'user1',
      channelId: 'chan1',
      guildId: null,
      messageId: 'msg1',
      userText: 'Hi',
    });

    expect(result.replyText).toBe('Hello there!');
    expect(mockRunChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'test-trace',
        userId: 'user1',
        channelId: 'chan1',
        guildId: null,
        messageId: 'msg1',
        userText: 'Hi',
        userProfileSummary: null,
      }),
    );
  });

  it('loads profile summary and passes it into runChatTurn', async () => {
    mockGetUserProfileRecord.mockResolvedValueOnce({
      userId: 'user1',
      summary: 'Likes cats',
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    await generateChatReply({
      traceId: 'test-trace',
      userId: 'user1',
      channelId: 'chan1',
      guildId: null,
      messageId: 'msg1',
      userText: 'Hi',
    });

    expect(mockRunChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userProfileSummary: 'Likes cats',
      }),
    );
  });

  it('triggers background profile update and persists new summary', async () => {
    mockGetUserProfileRecord.mockResolvedValueOnce({
      userId: 'user1',
      summary: 'Old summary',
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    mockRunChatTurn.mockResolvedValueOnce({ replyText: 'Sure, updated.' });
    mockUpdateProfileSummary.mockResolvedValueOnce('Mocked New Summary');

    await generateChatReply({
      traceId: 'test',
      userId: 'user1',
      channelId: 'chan1',
      guildId: 'guild1',
      messageId: 'msg1',
      userText: 'I like dark mode',
    });

    expect(mockUpdateProfileSummary).toHaveBeenCalledWith({
      previousSummary: 'Old summary',
      userMessage: 'I like dark mode',
      assistantReply: 'Sure, updated.',
      channelId: 'chan1',
      guildId: 'guild1',
      userId: 'user1',
      apiKey: 'guild-key',
    });

    await Promise.resolve();

    expect(mockUpsertUserProfile).toHaveBeenCalledWith('user1', 'Mocked New Summary');
  });

  it('avoids duplicate compaction while one compaction is in flight', async () => {
    mockNeedsCompaction.mockReturnValue(true);

    let resolveCompaction!: (value: string | null) => void;
    mockCompactUserProfile.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveCompaction = resolve;
        }),
    );

    mockGetUserProfileRecord.mockResolvedValue({
      userId: 'user1',
      summary: 'Old summary',
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    await generateChatReply({
      traceId: 'test-1',
      userId: 'user1',
      channelId: 'chan1',
      guildId: 'guild1',
      messageId: 'msg1',
      userText: 'First message',
    });

    await generateChatReply({
      traceId: 'test-2',
      userId: 'user1',
      channelId: 'chan1',
      guildId: 'guild1',
      messageId: 'msg2',
      userText: 'Second message',
    });

    expect(mockCompactUserProfile).toHaveBeenCalledTimes(1);

    resolveCompaction('Compacted Summary');
    await Promise.resolve();
  });

  it('falls back to safe profile update interval when config is non-finite', async () => {
    mockConfig.PROFILE_UPDATE_INTERVAL = Number.NaN as unknown as number;

    await generateChatReply({
      traceId: 'test',
      userId: 'user1',
      channelId: 'chan1',
      guildId: 'guild1',
      messageId: 'msg1',
      userText: 'hello',
    });

    await Promise.resolve();
    expect(mockUpdateProfileSummary).toHaveBeenCalledTimes(1);
  });
});

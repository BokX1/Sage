import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/platform/config/env';

const { mockFilterChannelIdsByMemberAccess } = vi.hoisted(() => ({
  mockFilterChannelIdsByMemberAccess: vi.fn(),
}));

vi.mock('@/platform/discord/channel-access', () => ({
  filterChannelIdsByMemberAccess: mockFilterChannelIdsByMemberAccess,
}));

import * as embeddings from '@/features/embeddings';
import { lookupChannelMessage, searchChannelMessages } from '@/features/agent-runtime/toolIntegrations';

describe('toolIntegrations channel message access checks', () => {
  const originalMessageDbStorage = config.MESSAGE_DB_STORAGE_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    config.MESSAGE_DB_STORAGE_ENABLED = true;
  });

  afterEach(() => {
    config.MESSAGE_DB_STORAGE_ENABLED = originalMessageDbStorage;
    vi.restoreAllMocks();
  });

  it('denies searchChannelMessages when requester lacks channel access', async () => {
    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set());

    const statsSpy = vi.spyOn(embeddings, 'getChannelMessageHistoryStats').mockImplementation(async () => {
      throw new Error('getChannelMessageHistoryStats should not be called when access is denied');
    });

    const result = await searchChannelMessages({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requesterUserId: 'user-1',
      query: 'needle',
    });

    expect(statsSpy).not.toHaveBeenCalled();
    expect(mockFilterChannelIdsByMemberAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        userId: 'user-1',
        channelIds: ['channel-1'],
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        found: false,
        channelId: 'channel-1',
      }),
    );
    expect(String((result as { content?: string }).content ?? '')).toContain('Permission denied');
  });

  it('allows searchChannelMessages when requester has channel access', async () => {
    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set(['channel-1']));

    vi.spyOn(embeddings, 'getChannelMessageHistoryStats').mockResolvedValueOnce({
      storedCount: 10,
      retentionCap: 100,
      oldestTimestamp: null,
      newestTimestamp: null,
      possiblyTruncated: false,
    });
    vi.spyOn(embeddings, 'supportsChannelMessageSemanticSearch').mockResolvedValueOnce(false);
    vi.spyOn(embeddings, 'searchChannelMessagesLexical').mockResolvedValueOnce([
      {
        messageId: 'msg-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'user-2',
        authorDisplayName: 'User',
        authorIsBot: false,
        timestamp: '2026-02-01T00:00:00.000Z',
        content: 'needle in haystack',
        score: 0.9,
      },
    ]);

    const result = await searchChannelMessages({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requesterUserId: 'user-1',
      query: 'needle',
      topK: 1,
      mode: 'hybrid',
    });

    expect(result).toEqual(
      expect.objectContaining({
        found: true,
        guildId: 'guild-1',
        channelId: 'channel-1',
        resultCount: 1,
      }),
    );
    expect(
      (result as { items?: Array<{ messageId: string; guildId: string | null; channelId: string }> }).items?.[0],
    ).toMatchObject({
      messageId: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
    });
  });

  it('denies lookupChannelMessage when requester lacks channel access', async () => {
    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set());

    const windowSpy = vi.spyOn(embeddings, 'getChannelMessageWindowById').mockImplementation(async () => {
      throw new Error('getChannelMessageWindowById should not be called when access is denied');
    });

    const result = await lookupChannelMessage({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requesterUserId: 'user-1',
      messageId: 'msg-1',
    });

    expect(windowSpy).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        found: false,
        channelId: 'channel-1',
      }),
    );
    expect(String((result as { content?: string }).content ?? '')).toContain('Permission denied');
  });

  it('allows lookupChannelMessage when requester has channel access', async () => {
    mockFilterChannelIdsByMemberAccess.mockResolvedValueOnce(new Set(['channel-1']));

    vi.spyOn(embeddings, 'getChannelMessageWindowById').mockResolvedValueOnce([
      {
        messageId: 'msg-0',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'user-2',
        authorDisplayName: 'User',
        authorIsBot: false,
        timestamp: '2026-02-01T00:00:00.000Z',
        content: 'before',
        score: 0,
      },
      {
        messageId: 'msg-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'user-3',
        authorDisplayName: 'Other',
        authorIsBot: false,
        timestamp: '2026-02-01T00:01:00.000Z',
        content: 'target',
        score: 1,
      },
    ]);

    const result = await lookupChannelMessage({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requesterUserId: 'user-1',
      messageId: 'msg-1',
      before: 1,
      after: 0,
    });

    expect(result).toEqual(
      expect.objectContaining({
        found: true,
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'msg-1',
      }),
    );
    expect(String((result as { content?: string }).content ?? '')).toContain('Channel message window');
    expect(
      (result as { items?: Array<{ messageId: string; guildId: string | null; channelId: string }> }).items?.[1],
    ).toMatchObject({
      messageId: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
    });
  });
});

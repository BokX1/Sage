import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaMessageStore } from '../../../../src/features/awareness/prismaMessageStore';

const { mockUpsert, mockFindMany, mockDeleteMany } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindMany: vi.fn(),
  mockDeleteMany: vi.fn(),
}));

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    channelMessage: {
      upsert: mockUpsert,
      findMany: mockFindMany,
      deleteMany: mockDeleteMany,
    },
  },
}));

describe('PrismaMessageStore', () => {
  let store: PrismaMessageStore;

  beforeEach(() => {
    mockUpsert.mockReset().mockResolvedValue({});
    mockFindMany.mockReset().mockResolvedValue([]);
    mockDeleteMany.mockReset().mockResolvedValue({ count: 0 });
    store = new PrismaMessageStore();
  });

  it('upserts messages to ensure idempotent storage', async () => {
    const message = {
      messageId: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'user-1',
      authorDisplayName: 'User One',
      authorIsBot: false,
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      content: 'hello',
      replyToMessageId: undefined,
      mentionsUserIds: ['user-2'],
      mentionsBot: false,
    };

    await store.append(message);
    await store.append(message);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenNthCalledWith(1, {
      where: { messageId: message.messageId },
      create: {
        ...message,
        replyToMessageId: null,
      },
      update: {
        ...message,
        replyToMessageId: null,
      },
    });
  });

  it('fetches recent messages and reverses them to chronological order', async () => {
    mockFindMany.mockResolvedValue([
      {
        messageId: 'msg-2',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        authorIsBot: false,
        timestamp: new Date('2024-01-01T00:01:00.000Z'),
        content: 'world',
        replyToMessageId: null,
        mentionsUserIds: [],
        mentionsBot: false,
      },
      {
        messageId: 'msg-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'user-1',
        authorDisplayName: 'User One',
        authorIsBot: false,
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        content: 'hello',
        replyToMessageId: null,
        mentionsUserIds: [],
        mentionsBot: false,
      },
    ]);

    const result = await store.fetchRecent({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 2,
    });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        guildId: 'guild-1',
        channelId: 'channel-1',
      },
      orderBy: { timestamp: 'desc' },
      take: 2,
    });

    expect(result).toHaveLength(2);
    expect(result[0].messageId).toBe('msg-1');
    expect(result[1].messageId).toBe('msg-2');
  });

  it('filters fetchRecent by sinceMs', async () => {
    mockFindMany.mockResolvedValue([]);

    await store.fetchRecent({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 10,
      sinceMs: 1704067200000, // 2024-01-01T00:00:00.000Z
    });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        timestamp: { gte: new Date('2024-01-01T00:00:00.000Z') },
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });
  });

  it('applies sinceMs when it is zero', async () => {
    mockFindMany.mockResolvedValue([]);

    await store.fetchRecent({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 10,
      sinceMs: 0,
    });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        timestamp: { gte: new Date(0) },
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });
  });

  it('returns empty results without querying when limit is non-positive', async () => {
    const result = await store.fetchRecent({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 0,
    });

    expect(result).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('coerces null mentionsBot values to false', async () => {
    mockFindMany.mockResolvedValue([
      {
        messageId: 'msg-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'user-1',
        authorDisplayName: 'User One',
        authorIsBot: false,
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        content: 'hello',
        replyToMessageId: null,
        mentionsUserIds: [],
        mentionsBot: null,
      },
    ]);

    const result = await store.fetchRecent({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 5,
    });

    expect(result).toHaveLength(1);
    expect(result[0].mentionsBot).toBe(false);
  });

  it('deletes messages older than cutoff', async () => {
    mockDeleteMany.mockResolvedValue({ count: 5 });

    const count = await store.deleteOlderThan(1704067200000);

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { timestamp: { lt: new Date('2024-01-01T00:00:00.000Z') } },
    });
    expect(count).toBe(5);
  });

  it('prunes channel to limit iteratively', async () => {
    // Return 2 rows on first batch (which is less than PRUNE_BATCH_SIZE 1000)
    mockFindMany.mockResolvedValueOnce([
      { messageId: 'msg-old-1' },
      { messageId: 'msg-old-2' },
    ]);
    mockDeleteMany.mockResolvedValueOnce({ count: 2 });

    const count = await store.pruneChannelToLimit({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 5,
    });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { guildId: 'guild-1', channelId: 'channel-1' },
      orderBy: { timestamp: 'desc' },
      skip: 5,
      select: { messageId: true },
      take: 1000,
    });

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: { in: ['msg-old-1', 'msg-old-2'] },
      },
    });

    expect(count).toBe(2);
  });

  it('returns 0 immediately if pruning to a limit <= 0', async () => {
    const count = await store.pruneChannelToLimit({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 0,
    });

    expect(count).toBe(0);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});

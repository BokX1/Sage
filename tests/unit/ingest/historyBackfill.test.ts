import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 15,
  MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL: 15,
  MESSAGE_DB_STORAGE_ENABLED: true,
}));

const mockChannelMessages = vi.hoisted(() => ({
  rows: [] as Array<{
    messageId: string;
    guildId: string | null;
    channelId: string;
    timestamp: Date;
  }>,
}));

const mockFetchChannel = vi.hoisted(() => vi.fn());

const TestTextChannel = vi.hoisted(
  () =>
    class TestTextChannel {
      id: string;
      guildId: string;
      messages: { fetch: (args: { limit: number }) => Promise<Map<string, unknown>> };

      constructor(params: {
        id: string;
        guildId: string;
        messages: { fetch: (args: { limit: number }) => Promise<Map<string, unknown>> };
      }) {
        this.id = params.id;
        this.guildId = params.guildId;
        this.messages = params.messages;
      }
    },
);

vi.mock('@/config', () => ({
  config: mockConfig,
}));

vi.mock('@/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(() => true),
}));

vi.mock('@/core/ingest/ingestEvent', () => ({
  ingestEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/db/prisma-client', () => ({
  prisma: {
    channelMessage: {
      create: vi.fn(),
      findMany: vi.fn((args: {
        where: { guildId: string | null; channelId: string };
        orderBy: { timestamp: 'asc' | 'desc' };
        take: number;
        skip?: number;
        select?: { messageId: boolean };
      }) => {
        const filtered = mockChannelMessages.rows.filter(
          (row) =>
            row.guildId === args.where.guildId && row.channelId === args.where.channelId,
        );
        const sorted = [...filtered].sort((a, b) => {
          return args.orderBy.timestamp === 'desc'
            ? b.timestamp.getTime() - a.timestamp.getTime()
            : a.timestamp.getTime() - b.timestamp.getTime();
        });
        const start = args.skip ?? 0;
        const slice = sorted.slice(start, start + args.take);
        if (args.select?.messageId) {
          return Promise.resolve(slice.map((row) => ({ messageId: row.messageId })));
        }
        return Promise.resolve(slice);
      }),
      deleteMany: vi.fn((args: { where: { messageId: { in: string[] } } }) => {
        const before = mockChannelMessages.rows.length;
        mockChannelMessages.rows = mockChannelMessages.rows.filter(
          (row) => !args.where.messageId.in.includes(row.messageId),
        );
        return Promise.resolve({ count: before - mockChannelMessages.rows.length });
      }),
    },
  },
}));

vi.mock('discord.js', () => ({
  TextChannel: TestTextChannel,
  Message: class Message {},
}));

vi.mock('@/bot/client', () => ({
  client: {
    channels: {
      fetch: mockFetchChannel,
    },
  },
}));

import { backfillChannelHistory } from '@/core/ingest/historyBackfill';
import { ingestEvent } from '@/core/ingest/ingestEvent';

function seedMessages(count: number, channelId: string, guildId: string) {
  mockChannelMessages.rows = Array.from({ length: count }, (_, index) => ({
    messageId: `msg-${index}`,
    guildId,
    channelId,
    timestamp: new Date(Date.now() - index * 1000),
  }));
}

describe('historyBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES = 15;
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = 15;
    mockConfig.MESSAGE_DB_STORAGE_ENABLED = true;
    mockChannelMessages.rows = [];
  });

  it('prunes stored history to the configured startup limit', async () => {
    seedMessages(50, 'channel-1', 'guild-1');

    const fetchMessages = vi.fn().mockResolvedValue(new Map());
    mockFetchChannel.mockResolvedValue(
      new TestTextChannel({
        id: 'channel-1',
        guildId: 'guild-1',
        messages: { fetch: fetchMessages },
      }),
    );

    await backfillChannelHistory('channel-1');

    expect(fetchMessages).toHaveBeenCalledWith({ limit: 15 });
    expect(mockChannelMessages.rows).toHaveLength(15);
  });

  it('honors a configured transcript cap override', async () => {
    mockConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES = 20;
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = 20;
    seedMessages(50, 'channel-1', 'guild-1');

    const fetchMessages = vi.fn().mockResolvedValue(new Map());
    mockFetchChannel.mockResolvedValue(
      new TestTextChannel({
        id: 'channel-1',
        guildId: 'guild-1',
        messages: { fetch: fetchMessages },
      }),
    );

    await backfillChannelHistory('channel-1');

    expect(fetchMessages).toHaveBeenCalledWith({ limit: 20 });
    expect(mockChannelMessages.rows).toHaveLength(20);
  });

  it('allows DB retention to be larger than prompt transcript startup limit', async () => {
    mockConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES = 10;
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = 25;
    seedMessages(50, 'channel-1', 'guild-1');

    const fetchMessages = vi.fn().mockResolvedValue(new Map());
    mockFetchChannel.mockResolvedValue(
      new TestTextChannel({
        id: 'channel-1',
        guildId: 'guild-1',
        messages: { fetch: fetchMessages },
      }),
    );

    await backfillChannelHistory('channel-1');

    expect(fetchMessages).toHaveBeenCalledWith({ limit: 10 });
    expect(mockChannelMessages.rows).toHaveLength(25);
  });

  it('disables social graph publishing during backfill ingestion', async () => {
    const message = {
      id: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      content: 'hello',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      createdTimestamp: new Date('2024-01-01T00:00:00.000Z').getTime(),
      author: { id: 'user-1', username: 'User 1', bot: false },
      member: { displayName: 'User 1' },
      mentions: {
        users: new Map([['user-2', {}]]),
        has: vi.fn(() => false),
      },
      reference: null,
    };

    const fetchMessages = vi.fn().mockResolvedValue(new Map([['msg-1', message]]));
    mockFetchChannel.mockResolvedValue(
      new TestTextChannel({
        id: 'channel-1',
        guildId: 'guild-1',
        messages: { fetch: fetchMessages },
      }),
    );

    await backfillChannelHistory('channel-1', 1);

    expect(ingestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message',
        messageId: 'msg-1',
      }),
      { publishSocialGraph: false },
    );
  });
});

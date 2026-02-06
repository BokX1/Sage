import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 15,
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

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(() => true),
}));

vi.mock('../../../src/core/ingest/ingestEvent', () => ({
  ingestEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/core/db/prisma-client', () => ({
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
  TextChannel: class TextChannel {
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
  Message: class Message {},
}));

vi.mock('../../../src/bot/client', () => ({
  client: {
    channels: {
      fetch: mockFetchChannel,
    },
  },
}));

import { backfillChannelHistory } from '../../../src/core/ingest/historyBackfill';
import { TextChannel } from 'discord.js';

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
    mockConfig.MESSAGE_DB_STORAGE_ENABLED = true;
    mockChannelMessages.rows = [];
  });

  it('prunes stored history to the configured startup limit', async () => {
    seedMessages(50, 'channel-1', 'guild-1');

    const fetchMessages = vi.fn().mockResolvedValue(new Map());
    mockFetchChannel.mockResolvedValue(
      new TextChannel({
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
    seedMessages(50, 'channel-1', 'guild-1');

    const fetchMessages = vi.fn().mockResolvedValue(new Map());
    mockFetchChannel.mockResolvedValue(
      new TextChannel({
        id: 'channel-1',
        guildId: 'guild-1',
        messages: { fetch: fetchMessages },
      }),
    );

    await backfillChannelHistory('channel-1');

    expect(fetchMessages).toHaveBeenCalledWith({ limit: 20 });
    expect(mockChannelMessages.rows).toHaveLength(20);
  });
});

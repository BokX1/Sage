/**
 * @description Validates channel-message RAG limit normalization behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  MESSAGE_DB_STORAGE_ENABLED: true,
  MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL: 20,
}));

const mockQueryRaw = vi.hoisted(() => vi.fn());
const mockExecuteRaw = vi.hoisted(() => vi.fn());
const mockEmbedText = vi.hoisted(() => vi.fn(async () => [0.1, 0.2]));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
  },
}));

vi.mock('@/features/embeddings/embeddingEngine', () => ({
  embedText: mockEmbedText,
}));

import {
  getChannelMessageHistoryStats,
  getChannelMessageWindowById,
  searchChannelMessagesLexical,
} from '../../../../src/features/embeddings/channelMessageRAG';

describe('channelMessageRAG', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.MESSAGE_DB_STORAGE_ENABLED = true;
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = 20;
  });

  it('falls back to safe lexical topK when input is non-finite', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    await searchChannelMessagesLexical({
      guildId: 'guild-1',
      channelId: 'channel-1',
      query: 'needle',
      topK: Number.NaN as unknown as number,
    });

    const limitParam = mockQueryRaw.mock.calls[0]?.at(-1);
    expect(limitParam).toBe(10);
  });

  it('falls back to safe retention cap when configured DB cap is non-finite', async () => {
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = Number.NaN as unknown as number;
    mockQueryRaw.mockResolvedValueOnce([
      {
        count: '3',
        oldest: '2024-01-01T00:00:00.000Z',
        newest: '2024-01-03T00:00:00.000Z',
      },
    ]);

    const stats = await getChannelMessageHistoryStats({
      guildId: 'guild-1',
      channelId: 'channel-1',
    });

    expect(stats).toMatchObject({
      storedCount: 3,
      retentionCap: 1,
      possiblyTruncated: true,
    });
  });

  it('normalizes non-finite context-window limits to zero', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        messageId: 'msg-1',
        authorId: 'user-1',
        authorDisplayName: 'User 1',
        authorIsBot: false,
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        content: 'hello',
      },
    ]);

    const rows = await getChannelMessageWindowById({
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'msg-1',
      before: Number.NaN as unknown as number,
      after: Number.POSITIVE_INFINITY,
    });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      messageId: 'msg-1',
      score: 1,
    });
  });
});

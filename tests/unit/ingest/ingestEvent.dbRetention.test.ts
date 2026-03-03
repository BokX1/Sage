/**
 * @module tests/unit/ingest/ingestEvent.dbRetention.test
 * @description Defines ingestEvent DB retention limit normalization tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  MESSAGE_DB_STORAGE_ENABLED: true,
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 15,
  MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL: 15,
}));

const mockIsLoggingEnabled = vi.hoisted(() => vi.fn(() => true));
const mockAppendMessage = vi.hoisted(() => vi.fn());
const mockDbAppend = vi.hoisted(() => vi.fn(async () => undefined));
const mockDbPrune = vi.hoisted(() => vi.fn(async () => 0));
const mockQueueChannelMessageEmbedding = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: mockIsLoggingEnabled,
}));

vi.mock('../../../src/core/awareness/channelRingBuffer', () => ({
  appendMessage: mockAppendMessage,
}));

vi.mock('../../../src/core/awareness/prismaMessageStore', () => ({
  PrismaMessageStore: class PrismaMessageStore {
    append = mockDbAppend;
    pruneChannelToLimit = mockDbPrune;
  },
}));

vi.mock('../../../src/core/summary/channelSummaryScheduler', () => ({
  getChannelSummaryScheduler: vi.fn(() => null),
}));

vi.mock('../../../src/core/embeddings', () => ({
  queueChannelMessageEmbedding: mockQueueChannelMessageEmbedding,
}));

vi.mock('../../../src/social-graph/kafkaProducer', () => ({
  publishInteraction: vi.fn(async () => undefined),
}));

import { ingestEvent } from '../../../src/core/ingest/ingestEvent';

describe('ingestEvent - db retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.MESSAGE_DB_STORAGE_ENABLED = true;
    mockConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES = 15;
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = 15;
    mockIsLoggingEnabled.mockReturnValue(true);
  });

  it('uses configured DB retention when finite', async () => {
    mockConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES = 10;
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = 25;

    await ingestEvent({
      type: 'message',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'msg-1',
      authorId: 'user-1',
      authorDisplayName: 'User 1',
      content: 'hello',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      mentionsUserIds: [],
    });

    expect(mockDbPrune).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        limit: 25,
      }),
    );
  });

  it('falls back to transcript retention when DB retention is non-finite', async () => {
    mockConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES = 12;
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = Number.NaN as unknown as number;

    await ingestEvent({
      type: 'message',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'msg-2',
      authorId: 'user-1',
      authorDisplayName: 'User 1',
      content: 'hello',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      mentionsUserIds: [],
    });

    expect(mockDbPrune).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 12,
      }),
    );
  });

  it('falls back to minimum safe retention when both limits are non-finite', async () => {
    mockConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES = Number.NaN as unknown as number;
    mockConfig.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL = Number.NaN as unknown as number;

    await ingestEvent({
      type: 'message',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'msg-3',
      authorId: 'user-1',
      authorDisplayName: 'User 1',
      content: 'hello',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      mentionsUserIds: [],
    });

    expect(mockDbPrune).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
      }),
    );
  });
});

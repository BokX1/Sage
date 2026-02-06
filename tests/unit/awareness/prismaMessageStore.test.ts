import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaMessageStore } from '../../../src/core/awareness/prismaMessageStore';

const { mockUpsert } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
}));

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    channelMessage: {
      upsert: mockUpsert,
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('PrismaMessageStore', () => {
  beforeEach(() => {
    mockUpsert.mockReset().mockResolvedValue({});
  });

  it('upserts messages to ensure idempotent storage', async () => {
    const store = new PrismaMessageStore();
    const message = {
      messageId: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'user-1',
      authorDisplayName: 'User One',
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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindMany = vi.hoisted(() => vi.fn());
const mockPublishInteractionStrict = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPublishVoiceSessionStrict = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockEnsureKafkaProducerAvailable = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockShutdownKafkaProducer = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/core/db/prisma-client', () => ({
  prisma: {
    relationshipEdge: {
      findMany: mockFindMany,
    },
  },
}));

vi.mock('@/social-graph/kafkaProducer', () => ({
  ensureKafkaProducerAvailable: mockEnsureKafkaProducerAvailable,
  publishInteractionStrict: mockPublishInteractionStrict,
  publishVoiceSessionStrict: mockPublishVoiceSessionStrict,
  shutdownKafkaProducer: mockShutdownKafkaProducer,
}));

describe('migratePostgresToMemgraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureKafkaProducerAvailable.mockResolvedValue(undefined);
    mockShutdownKafkaProducer.mockResolvedValue(undefined);
  });

  it('replays counts and reciprocal directions from relationship features', async () => {
    mockFindMany.mockResolvedValue([
      {
        guildId: 'guild-1',
        userA: 'user-a',
        userB: 'user-b',
        weight: 0.5,
        confidence: 0.8,
        featuresJson: {
          mentions: {
            count: 4,
            lastAt: Date.parse('2024-01-01T00:00:00.000Z'),
          },
          replies: {
            count: 5,
            lastAt: Date.parse('2024-01-02T00:00:00.000Z'),
            reciprocalCount: 2,
          },
          voice: {
            overlapMs: 600,
            lastAt: Date.parse('2024-01-03T00:00:00.000Z'),
          },
        },
        updatedAt: new Date('2024-01-04T00:00:00.000Z'),
      },
    ]);

    const { migratePostgresToMemgraph } = await import(
      '@/social-graph/migratePostgresToMemgraph'
    );

    await migratePostgresToMemgraph();

    const interactionEvents = mockPublishInteractionStrict.mock.calls.map(
      ([event]) =>
        event as {
          type: string;
          guildId: string;
          sourceUserId: string;
          targetUserId: string;
          timestamp: string;
          channelId: string;
        },
    );
    const mentionEvents = interactionEvents.filter((event) => event.type === 'MENTION');
    const replyEvents = interactionEvents.filter((event) => event.type === 'REPLY');

    expect(mentionEvents).toHaveLength(4);
    expect(
      mentionEvents.filter(
        (event) => event.sourceUserId === 'user-a' && event.targetUserId === 'user-b',
      ),
    ).toHaveLength(2);
    expect(
      mentionEvents.filter(
        (event) => event.sourceUserId === 'user-b' && event.targetUserId === 'user-a',
      ),
    ).toHaveLength(2);
    expect(mentionEvents.every((event) => event.timestamp === '2024-01-01T00:00:00.000Z')).toBe(
      true,
    );

    expect(replyEvents).toHaveLength(5);
    expect(
      replyEvents.filter(
        (event) => event.sourceUserId === 'user-a' && event.targetUserId === 'user-b',
      ),
    ).toHaveLength(3);
    expect(
      replyEvents.filter(
        (event) => event.sourceUserId === 'user-b' && event.targetUserId === 'user-a',
      ),
    ).toHaveLength(2);
    expect(replyEvents.every((event) => event.timestamp === '2024-01-02T00:00:00.000Z')).toBe(
      true,
    );
    expect(interactionEvents.every((event) => event.guildId === 'guild-1')).toBe(true);
    expect(interactionEvents.every((event) => event.channelId === 'migration:guild-1')).toBe(true);

    const voiceEvents = mockPublishVoiceSessionStrict.mock.calls.map(
      ([event]) =>
        event as {
          guildId: string;
          userA: string;
          userB: string;
          durationMs: number;
          timestamp: string;
        },
    );
    expect(voiceEvents).toHaveLength(2);
    expect(voiceEvents.every((event) => event.guildId === 'guild-1')).toBe(true);
    expect(voiceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userA: 'user-a',
          userB: 'user-b',
          durationMs: 300,
          timestamp: '2024-01-03T00:00:00.000Z',
        }),
        expect.objectContaining({
          userA: 'user-b',
          userB: 'user-a',
          durationMs: 300,
          timestamp: '2024-01-03T00:00:00.000Z',
        }),
      ]),
    );
    expect(mockShutdownKafkaProducer).toHaveBeenCalledTimes(1);
  });

  it('prefers explicit directional reply counters when exporting REPLY events', async () => {
    mockFindMany.mockResolvedValue([
      {
        guildId: 'guild-2',
        userA: 'user-a',
        userB: 'user-b',
        weight: 0.4,
        confidence: 0.7,
        featuresJson: {
          replies: {
            count: 4,
            lastAt: Date.parse('2024-01-06T00:00:00.000Z'),
            fromAToBCount: 0,
            fromBToACount: 4,
          },
        },
        updatedAt: new Date('2024-01-07T00:00:00.000Z'),
      },
    ]);

    const { migratePostgresToMemgraph } = await import(
      '@/social-graph/migratePostgresToMemgraph'
    );

    await migratePostgresToMemgraph();

    const replyEvents = mockPublishInteractionStrict.mock.calls
      .map(
        ([event]) =>
          event as { type: string; sourceUserId: string; targetUserId: string; channelId: string },
      )
      .filter((event) => event.type === 'REPLY');

    expect(replyEvents).toHaveLength(4);
    expect(
      replyEvents.filter(
        (event) => event.sourceUserId === 'user-a' && event.targetUserId === 'user-b',
      ),
    ).toHaveLength(0);
    expect(
      replyEvents.filter(
        (event) => event.sourceUserId === 'user-b' && event.targetUserId === 'user-a',
      ),
    ).toHaveLength(4);
    expect(replyEvents.every((event) => event.channelId === 'migration:guild-2')).toBe(true);
    expect(mockShutdownKafkaProducer).toHaveBeenCalledTimes(1);
  });

  it('uses neutral splitting when reply direction hints are missing', async () => {
    mockFindMany.mockResolvedValue([
      {
        guildId: 'x',
        userA: 'a',
        userB: 'b',
        weight: 0.3,
        confidence: 0.6,
        featuresJson: {
          replies: {
            count: 1,
            lastAt: Date.parse('2024-01-08T00:00:00.000Z'),
          },
        },
        updatedAt: new Date('2024-01-09T00:00:00.000Z'),
      },
    ]);

    const { migratePostgresToMemgraph } = await import(
      '@/social-graph/migratePostgresToMemgraph'
    );

    await migratePostgresToMemgraph();

    const replyEvents = mockPublishInteractionStrict.mock.calls
      .map(
        ([event]) =>
          event as { type: string; sourceUserId: string; targetUserId: string; channelId: string },
      )
      .filter((event) => event.type === 'REPLY');

    expect(replyEvents).toHaveLength(1);
    expect(replyEvents[0]).toMatchObject({
      sourceUserId: 'b',
      targetUserId: 'a',
      channelId: 'migration:x',
    });
    expect(mockShutdownKafkaProducer).toHaveBeenCalledTimes(1);
  });

  it('aborts when kafka producer is unavailable before replay starts', async () => {
    mockFindMany.mockResolvedValue([
      {
        guildId: 'guild-1',
        userA: 'user-a',
        userB: 'user-b',
        weight: 0.5,
        confidence: 0.8,
        featuresJson: {
          mentions: { count: 1 },
        },
        updatedAt: new Date('2024-01-04T00:00:00.000Z'),
      },
    ]);
    mockEnsureKafkaProducerAvailable.mockRejectedValueOnce(new Error('Kafka unavailable'));

    const { migratePostgresToMemgraph } = await import(
      '@/social-graph/migratePostgresToMemgraph'
    );

    await expect(migratePostgresToMemgraph()).rejects.toThrow('Kafka unavailable');
    expect(mockEnsureKafkaProducerAvailable).toHaveBeenCalledTimes(1);
    expect(mockPublishInteractionStrict).not.toHaveBeenCalled();
    expect(mockPublishVoiceSessionStrict).not.toHaveBeenCalled();
    expect(mockShutdownKafkaProducer).toHaveBeenCalledTimes(1);
  });
});

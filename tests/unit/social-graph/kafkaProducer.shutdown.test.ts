import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('kafkaProducer shutdown draining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const kafkaProducer = await import('@/social-graph/kafkaProducer');
    kafkaProducer.setSocialGraphPublisherForTests(null);
    await kafkaProducer.awaitPendingPublishes(50);
  });

  it('awaits pending publishes before calling override shutdown', async () => {
    const kafkaProducer = await import('@/social-graph/kafkaProducer');

    let resolvePendingPublish!: () => void;
    const publishDeferred = new Promise<void>((resolve) => {
      resolvePendingPublish = () => resolve(undefined);
    });

    const publisher = {
      publishInteraction: vi.fn(async () => {
        await publishDeferred;
      }),
      publishVoiceSession: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
    };

    kafkaProducer.setSocialGraphPublisherForTests(publisher);

    void kafkaProducer.publishInteraction({
      type: 'MENTION',
      guildId: 'guild-1',
      sourceUserId: 'source-1',
      targetUserId: 'target-1',
      channelId: 'channel-1',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    const shutdownPromise = kafkaProducer.shutdownKafkaProducer();
    await Promise.resolve();

    expect(publisher.shutdown).not.toHaveBeenCalled();

    resolvePendingPublish();
    await shutdownPromise;

    expect(publisher.shutdown).toHaveBeenCalledTimes(1);
  });

  it('drains publishes that start while shutdown is already waiting', async () => {
    const kafkaProducer = await import('@/social-graph/kafkaProducer');

    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstPublish = new Promise<void>((resolve) => {
      resolveFirst = () => resolve(undefined);
    });
    const secondPublish = new Promise<void>((resolve) => {
      resolveSecond = () => resolve(undefined);
    });
    let callCount = 0;

    const publisher = {
      publishInteraction: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          await firstPublish;
          return;
        }
        await secondPublish;
      }),
      publishVoiceSession: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
    };

    kafkaProducer.setSocialGraphPublisherForTests(publisher);

    void kafkaProducer.publishInteraction({
      type: 'MENTION',
      guildId: 'guild-1',
      sourceUserId: 'source-1',
      targetUserId: 'target-1',
      channelId: 'channel-1',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    const shutdownPromise = kafkaProducer.shutdownKafkaProducer();
    await Promise.resolve();

    void kafkaProducer.publishInteraction({
      type: 'REPLY',
      guildId: 'guild-1',
      sourceUserId: 'source-2',
      targetUserId: 'target-2',
      channelId: 'channel-2',
      timestamp: '2024-01-01T00:01:00.000Z',
    });

    resolveFirst();
    await Promise.resolve();
    expect(publisher.shutdown).not.toHaveBeenCalled();

    resolveSecond();
    await shutdownPromise;

    expect(publisher.shutdown).toHaveBeenCalledTimes(1);
  });

  it('returns immediately when there are no pending publishes', async () => {
    const kafkaProducer = await import('@/social-graph/kafkaProducer');

    await expect(kafkaProducer.awaitPendingPublishes(10)).resolves.toBeUndefined();
  });

  it('propagates override publish errors in strict mode', async () => {
    const kafkaProducer = await import('@/social-graph/kafkaProducer');

    const publisher = {
      publishInteraction: vi.fn(async () => {
        throw new Error('publish failed');
      }),
      publishVoiceSession: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
    };

    kafkaProducer.setSocialGraphPublisherForTests(publisher);

    await expect(
      kafkaProducer.publishInteractionStrict({
        type: 'MENTION',
        guildId: 'guild-1',
        sourceUserId: 'source-1',
        targetUserId: 'target-1',
        channelId: 'channel-1',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('publish failed');
  });

  it('clears drain timeout when pending publishes settle before timeout', async () => {
    vi.useFakeTimers();

    try {
      const kafkaProducer = await import('@/social-graph/kafkaProducer');

      let resolvePendingPublish!: () => void;
      const publishDeferred = new Promise<void>((resolve) => {
        resolvePendingPublish = () => resolve(undefined);
      });

      const publisher = {
        publishInteraction: vi.fn(async () => {
          await publishDeferred;
        }),
        publishVoiceSession: vi.fn(async () => undefined),
        shutdown: vi.fn(async () => undefined),
      };

      kafkaProducer.setSocialGraphPublisherForTests(publisher);

      const publishPromise = kafkaProducer.publishInteraction({
        type: 'MENTION',
        guildId: 'guild-1',
        sourceUserId: 'source-1',
        targetUserId: 'target-1',
        channelId: 'channel-1',
        timestamp: '2024-01-01T00:00:00.000Z',
      });

      const drainPromise = kafkaProducer.awaitPendingPublishes(1_000);
      await Promise.resolve();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      resolvePendingPublish();
      await publishPromise;
      await drainPromise;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

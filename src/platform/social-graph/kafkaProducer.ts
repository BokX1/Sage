import { config } from '../config/env';
import { logger } from '../logging/logger';
import type { Producer } from 'kafkajs';

/**
 * Represents the InteractionType type.
 */
export type InteractionType = 'MENTION' | 'REPLY' | 'REACT';

/**
 * Represents the SocialInteractionEvent type.
 */
export type SocialInteractionEvent = {
  type: InteractionType;
  guildId: string;
  sourceUserId: string;
  targetUserId: string;
  channelId: string;
  timestamp: string;
  sentimentScore?: number;
};

/**
 * Represents the VoiceSessionEvent type.
 */
export type VoiceSessionEvent = {
  guildId: string;
  userA: string;
  userB: string;
  timestamp: string;
  durationMs: number;
};

type KafkaJsModule = typeof import('kafkajs');

/**
 * Represents the SocialGraphPublisher type.
 */
export type SocialGraphPublisher = {
  publishInteraction: (event: SocialInteractionEvent) => Promise<void>;
  publishVoiceSession: (event: VoiceSessionEvent) => Promise<void>;
  shutdown: () => Promise<void>;
};

let publisherOverride: SocialGraphPublisher | null = null;

let producer: Producer | null = null;
let producerInit: Promise<Producer | null> | null = null;
const pendingPublishes = new Set<Promise<void>>();
const DEFAULT_PENDING_DRAIN_TIMEOUT_MS = 5_000;

function trackPendingPublish(task: Promise<void>): Promise<void> {
  pendingPublishes.add(task);
  void task.then(
    () => {
      pendingPublishes.delete(task);
    },
    () => {
      pendingPublishes.delete(task);
    },
  );
  return task;
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function tryLoadKafkaJs(): Promise<KafkaJsModule | null> {
  try {
    return await import('kafkajs');
  } catch (error) {
    logger.warn(
      { error },
      'Kafka export is configured but kafkajs is not installed; skipping publish',
    );
    return null;
  }
}

async function getProducer(): Promise<Producer | null> {
  if (producer) return producer;
  if (producerInit) return producerInit;

  const brokers = parseCsv(config.KAFKA_BROKERS);
  if (brokers.length === 0) {
    return null;
  }

  producerInit = (async () => {
    const kafkaJs = await tryLoadKafkaJs();
    if (!kafkaJs) return null;

    const kafka = new kafkaJs.Kafka({
      clientId: 'sage',
      brokers,
      logLevel: kafkaJs.logLevel?.NOTHING,
    });

    const created = kafka.producer({ allowAutoTopicCreation: false });
    await created.connect();
    producer = created;

    logger.info(
      {
        brokers,
        interactionsTopic: config.KAFKA_INTERACTIONS_TOPIC,
        voiceTopic: config.KAFKA_VOICE_TOPIC,
      },
      'Kafka social-graph producer connected',
    );

    return created;
  })().catch((error) => {
    producerInit = null;
    logger.warn({ error }, 'Kafka producer initialization failed; skipping publish');
    return null;
  });

  return producerInit;
}

async function sendJson(topic: string, payload: unknown): Promise<void> {
  const activeProducer = await getProducer();
  if (!activeProducer) return;

  try {
    await activeProducer.send({
      topic,
      messages: [{ value: JSON.stringify(payload) }],
    });
  } catch (error) {
    logger.warn({ error, topic }, 'Kafka publish failed (non-fatal)');
  }
}

export function setSocialGraphPublisherForTests(publisher: SocialGraphPublisher | null): void {
  publisherOverride = publisher;
}

export async function publishInteraction(event: SocialInteractionEvent): Promise<void> {
  const task = (async () => {
    if (publisherOverride) {
      try {
        await publisherOverride.publishInteraction(event);
      } catch (error) {
        logger.warn({ error, event }, 'Test publisher publishInteraction failed');
      }
      return;
    }

    await sendJson(config.KAFKA_INTERACTIONS_TOPIC, event);
  })();

  return trackPendingPublish(task);
}

export async function publishVoiceSession(event: VoiceSessionEvent): Promise<void> {
  const task = (async () => {
    if (publisherOverride) {
      try {
        await publisherOverride.publishVoiceSession(event);
      } catch (error) {
        logger.warn({ error, event }, 'Test publisher publishVoiceSession failed');
      }
      return;
    }

    await sendJson(config.KAFKA_VOICE_TOPIC, event);
  })();

  return trackPendingPublish(task);
}

export async function publishInteractionStrict(event: SocialInteractionEvent): Promise<void> {
  const task = (async () => {
    if (publisherOverride) {
      await publisherOverride.publishInteraction(event);
      return;
    }

    const activeProducer = await getProducer();
    if (!activeProducer) {
      throw new Error('Kafka producer unavailable for social-graph publish');
    }

    await activeProducer.send({
      topic: config.KAFKA_INTERACTIONS_TOPIC,
      messages: [{ value: JSON.stringify(event) }],
    });
  })();

  return trackPendingPublish(task);
}

export async function publishVoiceSessionStrict(event: VoiceSessionEvent): Promise<void> {
  const task = (async () => {
    if (publisherOverride) {
      await publisherOverride.publishVoiceSession(event);
      return;
    }

    const activeProducer = await getProducer();
    if (!activeProducer) {
      throw new Error('Kafka producer unavailable for social-graph publish');
    }

    await activeProducer.send({
      topic: config.KAFKA_VOICE_TOPIC,
      messages: [{ value: JSON.stringify(event) }],
    });
  })();

  return trackPendingPublish(task);
}

export async function ensureKafkaProducerAvailable(): Promise<void> {
  if (publisherOverride) return;

  const activeProducer = await getProducer();
  if (!activeProducer) {
    throw new Error(
      'Kafka producer unavailable for social-graph publish. Configure KAFKA_BROKERS and ensure Kafka is reachable.',
    );
  }
}

export async function awaitPendingPublishes(
  timeoutMs = DEFAULT_PENDING_DRAIN_TIMEOUT_MS,
): Promise<void> {
  if (pendingPublishes.size === 0) return;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    // Keep draining until producer activity fully settles.
    while (pendingPublishes.size > 0) {
      await Promise.allSettled(Array.from(pendingPublishes));
    }
    return;
  }

  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  const deadlineMs = Date.now() + boundedTimeoutMs;

  while (pendingPublishes.size > 0) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      logger.warn(
        { timeoutMs: boundedTimeoutMs, pendingCount: pendingPublishes.size },
        'Timed out while waiting for pending social-graph publishes during shutdown',
      );
      return;
    }

    const batch = Array.from(pendingPublishes);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      await Promise.race([
        Promise.allSettled(batch),
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(resolve, remainingMs);
          timeoutHandle.unref?.();
        }),
      ]);
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

export async function shutdownKafkaProducer(): Promise<void> {
  await awaitPendingPublishes();

  if (publisherOverride) {
    try {
      await publisherOverride.shutdown();
    } catch (error) {
      logger.warn({ error }, 'Test publisher shutdown failed');
    }
    return;
  }

  const activeProducer = producer;
  producer = null;
  producerInit = null;

  if (!activeProducer) return;
  try {
    await activeProducer.disconnect();
  } catch (error) {
    logger.warn({ error }, 'Kafka producer disconnect failed (non-fatal)');
  }
}

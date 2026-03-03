import { config } from '../config';
import { logger } from '../core/utils/logger';
import { createMemgraphClient } from './memgraphClient';
import { Kafka, logLevel } from 'kafkajs';

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function ensureKafkaTopics(params: {
  brokersCsv: string;
  topics: Array<{ name: string; partitions: number; replication: number }>;
}): Promise<void> {
  const brokers = parseCsv(params.brokersCsv);
  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKERS is empty; cannot create topics.');
  }

  const kafka = new Kafka({
    clientId: 'sage-setup',
    brokers,
    logLevel: logLevel.NOTHING,
  });
  const admin = kafka.admin();
  await admin.connect();

  try {
    const existing = new Set(await admin.listTopics());
    const missing = params.topics.filter((topic) => !existing.has(topic.name));
    if (missing.length === 0) {
      logger.info({ topics: params.topics.map((t) => t.name) }, 'Kafka topics already exist');
      return;
    }

    await admin.createTopics({
      topics: missing.map((topic) => ({
        topic: topic.name,
        numPartitions: topic.partitions,
        replicationFactor: topic.replication,
      })),
      waitForLeaders: true,
    });

    logger.info({ topics: missing.map((t) => t.name) }, 'Kafka topics created');
  } finally {
    await admin.disconnect();
  }
}

function looksLikeAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}

function looksLikeAlreadyRunningError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already running/i.test(message);
}

async function ensureMemgraphIndexes(): Promise<void> {
  const memgraph = createMemgraphClient();
  try {
    const constraints = [
      'CREATE CONSTRAINT ON (u:User) ASSERT u.id IS UNIQUE',
      'CREATE CONSTRAINT ON (g:Guild) ASSERT g.id IS UNIQUE',
      'CREATE CONSTRAINT ON (c:Channel) ASSERT c.id IS UNIQUE',
    ];
    for (const statement of constraints) {
      try {
        await memgraph.run(statement);
      } catch (error) {
        if (!looksLikeAlreadyExistsError(error)) {
          logger.warn({ error, statement }, 'Memgraph unique constraint setup skipped');
        }
      }
    }

    const statements = ['CREATE INDEX ON :User(id)', 'CREATE INDEX ON :Channel(id)'];
    for (const statement of statements) {
      try {
        await memgraph.run(statement);
      } catch (error) {
        if (!looksLikeAlreadyExistsError(error)) {
          throw error;
        }
      }
    }
    logger.info('Memgraph indexes and uniqueness constraints ensured');
  } finally {
    await memgraph.close();
  }
}

async function listExistingStreams(): Promise<Set<string>> {
  const memgraph = createMemgraphClient();
  try {
    const result = await memgraph.run('SHOW STREAMS');
    const names = new Set<string>();
    for (const record of result.records) {
      const keyCandidates = ['name', 'Name', 'stream_name', 'STREAM_NAME'];
      let found: string | null = null;
      for (const key of keyCandidates) {
        if (!record.keys.includes(key)) continue;
        const value = record.get(key);
        if (typeof value === 'string') {
          found = value;
          break;
        }
      }

      if (!found && record.keys.length > 0) {
        const value = record.get(record.keys[0]);
        if (typeof value === 'string') found = value;
      }

      if (found) names.add(found);
    }
    return names;
  } finally {
    await memgraph.close();
  }
}

async function ensureMemgraphStream(params: {
  name: string;
  topic: string;
  transform: string;
}): Promise<void> {
  const existingStreams = await listExistingStreams();
  const memgraph = createMemgraphClient();

  try {
    if (!existingStreams.has(params.name)) {
      const createStatement = `
CREATE KAFKA STREAM ${params.name}
TOPICS "${params.topic}"
TRANSFORM ${params.transform}
BOOTSTRAP_SERVERS "${config.MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS}"
`;
      try {
        await memgraph.run(createStatement);
        logger.info({ stream: params.name }, 'Memgraph stream created');
      } catch (error) {
        if (!looksLikeAlreadyExistsError(error)) {
          throw error;
        }
        logger.info({ stream: params.name }, 'Memgraph stream already exists (create ignored)');
      }
    } else {
      logger.info({ stream: params.name }, 'Memgraph stream already exists');
    }

    try {
      await memgraph.run(`START STREAM ${params.name}`);
      logger.info({ stream: params.name }, 'Memgraph stream started');
    } catch (error) {
      if (!looksLikeAlreadyRunningError(error)) {
        throw error;
      }
      logger.info({ stream: params.name }, 'Memgraph stream already running');
    }
  } finally {
    await memgraph.close();
  }
}

async function main(): Promise<void> {
  logger.info('Setting up social graph infrastructure (Kafka topics + Memgraph streams/indexes)...');

  await ensureKafkaTopics({
    brokersCsv: config.KAFKA_BROKERS,
    topics: [
      { name: config.KAFKA_INTERACTIONS_TOPIC, partitions: 3, replication: 1 },
      { name: config.KAFKA_VOICE_TOPIC, partitions: 3, replication: 1 },
    ],
  });

  await ensureMemgraphIndexes();

  await ensureMemgraphStream({
    name: 'social_interactions',
    topic: config.KAFKA_INTERACTIONS_TOPIC,
    transform: 'custom.social_transform',
  });

  await ensureMemgraphStream({
    name: 'voice_sessions',
    topic: config.KAFKA_VOICE_TOPIC,
    transform: 'custom.voice_transform',
  });

  logger.info('Social graph setup complete');
}

void main().catch((error) => {
  logger.error({ error }, 'Social graph setup failed');
  process.exitCode = 1;
});

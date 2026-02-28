import { logger } from '../core/utils/logger';
import { prisma } from '../core/db/prisma-client';
import {
  ensureKafkaProducerAvailable,
  publishInteractionStrict,
  publishVoiceSessionStrict,
  type InteractionType,
} from './kafkaProducer';

type PrismaEdgeRow = {
  guildId: string;
  userA: string;
  userB: string;
  weight: number;
  confidence: number;
  featuresJson: {
    mentions?: { count?: number; lastAt?: number };
    replies?: {
      count?: number;
      lastAt?: number;
      reciprocalCount?: number;
      fromAToBCount?: number;
      fromBToACount?: number;
    };
    voice?: { overlapMs?: number; lastAt?: number };
  };
  updatedAt: Date;
};

type PrismaRelationshipEdgeClient = {
  findMany: (args: { orderBy: { updatedAt: 'desc' } }) => Promise<PrismaEdgeRow[]>;
};

function getRelationshipEdgeClient(): PrismaRelationshipEdgeClient {
  return (prisma as unknown as { relationshipEdge: PrismaRelationshipEdgeClient }).relationshipEdge;
}

function toNonNegativeInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function toIsoTimestamp(epochMs: unknown, fallbackIso: string): string {
  const parsed = typeof epochMs === 'number' ? epochMs : Number(epochMs);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackIso;
  }

  return new Date(parsed).toISOString();
}

function getMigrationChannelId(guildId: string): string {
  return `migration:${guildId}`;
}

function splitUndirectedCount(total: number, seed: string): { forward: number; reverse: number } {
  if (total <= 0) {
    return { forward: 0, reverse: 0 };
  }

  const base = Math.floor(total / 2);
  const remainder = total - base * 2;
  if (remainder === 0) {
    return { forward: base, reverse: base };
  }

  const parity =
    seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 2;
  return parity === 0
    ? { forward: base + 1, reverse: base }
    : { forward: base, reverse: base + 1 };
}

function splitReplyDirection(params: {
  totalCount: number;
  replies: PrismaEdgeRow['featuresJson']['replies'];
  seed: string;
}): { forward: number; reverse: number } {
  if (params.totalCount <= 0) {
    return { forward: 0, reverse: 0 };
  }

  let forward = toNonNegativeInt(params.replies?.fromAToBCount);
  let reverse = toNonNegativeInt(params.replies?.fromBToACount);

  if (forward + reverse === 0) {
    const hasReciprocalHint =
      !!params.replies &&
      Object.prototype.hasOwnProperty.call(params.replies, 'reciprocalCount');
    if (hasReciprocalHint) {
      reverse = Math.min(params.totalCount, toNonNegativeInt(params.replies?.reciprocalCount));
      forward = params.totalCount - reverse;
    } else {
      const split = splitUndirectedCount(params.totalCount, `${params.seed}:replies-neutral`);
      forward = split.forward;
      reverse = split.reverse;
    }
    return { forward, reverse };
  }

  const assigned = forward + reverse;
  if (assigned < params.totalCount) {
    const missing = params.totalCount - assigned;
    if (forward === 0 && reverse > 0) {
      reverse += missing;
    } else if (reverse === 0 && forward > 0) {
      forward += missing;
    } else {
      const split = splitUndirectedCount(missing, `${params.seed}:replies`);
      forward += split.forward;
      reverse += split.reverse;
    }
  } else if (assigned > params.totalCount) {
    const overflow = assigned - params.totalCount;
    if (forward >= reverse) {
      const trimmedForward = Math.min(forward, overflow);
      forward -= trimmedForward;
      reverse = Math.max(0, reverse - (overflow - trimmedForward));
    } else {
      const trimmedReverse = Math.min(reverse, overflow);
      reverse -= trimmedReverse;
      forward = Math.max(0, forward - (overflow - trimmedReverse));
    }
  }

  return { forward, reverse };
}

async function publishInteractionCopies(params: {
  count: number;
  type: InteractionType;
  guildId: string;
  sourceUserId: string;
  targetUserId: string;
  channelId: string;
  timestamp: string;
}): Promise<number> {
  let sent = 0;
  for (let index = 0; index < params.count; index += 1) {
    await publishInteractionStrict({
      type: params.type,
      guildId: params.guildId,
      sourceUserId: params.sourceUserId,
      targetUserId: params.targetUserId,
      channelId: params.channelId,
      timestamp: params.timestamp,
    });
    sent += 1;
  }
  return sent;
}

export async function migratePostgresToMemgraph(): Promise<void> {
  const startMs = Date.now();
  logger.info('Starting Postgres → Memgraph migration');

  const edgeClient = getRelationshipEdgeClient();

  const edges = await edgeClient.findMany({
    orderBy: { updatedAt: 'desc' },
  });

  logger.info({ edgeCount: edges.length }, 'Loaded edges from PostgreSQL');

  if (edges.length === 0) {
    logger.info('No edges to migrate');
    return;
  }

  await ensureKafkaProducerAvailable();

  let publishedCount = 0;
  let errorCount = 0;

  for (const edge of edges) {
    try {
      const features = edge.featuresJson;
      const fallbackTimestamp = edge.updatedAt.toISOString();
      const seed = `${edge.guildId}:${edge.userA}:${edge.userB}`;

      const mentionCount = toNonNegativeInt(features.mentions?.count);
      if (mentionCount > 0) {
        const mentionTimestamp = toIsoTimestamp(features.mentions?.lastAt, fallbackTimestamp);
        const mentionSplit = splitUndirectedCount(mentionCount, `${seed}:mentions`);
        // Preserve guild isolation in Memgraph channel topology during replay.
        const channelId = getMigrationChannelId(edge.guildId);
        publishedCount += await publishInteractionCopies({
          count: mentionSplit.forward,
          type: 'MENTION',
          guildId: edge.guildId,
          sourceUserId: edge.userA,
          targetUserId: edge.userB,
          channelId,
          timestamp: mentionTimestamp,
        });
        publishedCount += await publishInteractionCopies({
          count: mentionSplit.reverse,
          type: 'MENTION',
          guildId: edge.guildId,
          sourceUserId: edge.userB,
          targetUserId: edge.userA,
          channelId,
          timestamp: mentionTimestamp,
        });
      }

      const replyCount = toNonNegativeInt(features.replies?.count);
      if (replyCount > 0) {
        const replyTimestamp = toIsoTimestamp(features.replies?.lastAt, fallbackTimestamp);
        const { forward: forwardReplies, reverse: reverseReplies } = splitReplyDirection({
          totalCount: replyCount,
          replies: features.replies,
          seed,
        });
        // Preserve guild isolation in Memgraph channel topology during replay.
        const channelId = getMigrationChannelId(edge.guildId);

        publishedCount += await publishInteractionCopies({
          count: forwardReplies,
          type: 'REPLY',
          guildId: edge.guildId,
          sourceUserId: edge.userA,
          targetUserId: edge.userB,
          channelId,
          timestamp: replyTimestamp,
        });

        publishedCount += await publishInteractionCopies({
          count: reverseReplies,
          type: 'REPLY',
          guildId: edge.guildId,
          sourceUserId: edge.userB,
          targetUserId: edge.userA,
          channelId,
          timestamp: replyTimestamp,
        });
      }

      const voiceOverlapMs = toNonNegativeInt(features.voice?.overlapMs);
      if (voiceOverlapMs > 0) {
        const voiceTimestamp = toIsoTimestamp(features.voice?.lastAt, fallbackTimestamp);
        const voiceSplit = splitUndirectedCount(voiceOverlapMs, `${seed}:voice`);

        if (voiceSplit.forward > 0) {
          await publishVoiceSessionStrict({
            guildId: edge.guildId,
            userA: edge.userA,
            userB: edge.userB,
            durationMs: voiceSplit.forward,
            timestamp: voiceTimestamp,
          });
          publishedCount += 1;
        }

        if (voiceSplit.reverse > 0) {
          await publishVoiceSessionStrict({
            guildId: edge.guildId,
            userA: edge.userB,
            userB: edge.userA,
            durationMs: voiceSplit.reverse,
            timestamp: voiceTimestamp,
          });
          publishedCount += 1;
        }
      }
    } catch (error) {
      errorCount++;
      logger.warn(
        { error, userA: edge.userA, userB: edge.userB },
        'Failed to migrate edge (non-fatal)',
      );
    }
  }

  const elapsedMs = Date.now() - startMs;
  logger.info(
    { elapsedMs, edgeCount: edges.length, publishedCount, errorCount },
    'Postgres → Memgraph migration completed',
  );
}

if (require.main === module) {
  void migratePostgresToMemgraph()
    .then(() => {
      logger.info('Migration script finished');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Migration script failed');
      process.exit(1);
    });
}

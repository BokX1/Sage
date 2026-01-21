import { logger } from '../../utils/logger';
import {
  findEdge,
  findEdgesForUser,
  findTopEdges,
  RelationshipEdge,
  RelationshipFeatures,
  upsertEdge,
} from './relationshipEdgeRepo';

const DECAY_LAMBDA_PER_DAY = 0.06; // Half-life ~11.5 days
const WEIGHT_K = 0.2; // Sigmoid steepness for score->weight
const CONFIDENCE_C = 0.25; // Sigmoid steepness for evidence->confidence
const MENTION_WEIGHT = 0.4;
const REPLY_WEIGHT = 0.4;
const VOICE_WEIGHT = 0.2;

/**
 * Normalize a user ID pair for consistent edge keys.
 *
 * Details: ensures deterministic lexicographic ordering so edge lookups and
 * writes use the same key regardless of argument order.
 *
 * Side effects: none.
 * Error behavior: none.
 *
 * @param user1 - First user ID.
 * @param user2 - Second user ID.
 * @returns Ordered user IDs as userA/userB.
 */
export function normalizePair(user1: string, user2: string): { userA: string; userB: string } {
  if (user1 < user2) {
    return { userA: user1, userB: user2 };
  }
  return { userA: user2, userB: user1 };
}

/**
 * Apply exponential decay based on time elapsed.
 *
 * Details: decays the provided value using the configured lambda constant.
 *
 * Side effects: none.
 * Error behavior: none.
 */
function applyDecay(value: number, lastAt: number, now: number): number {
  const deltaDays = (now - lastAt) / (1000 * 60 * 60 * 24);
  return value * Math.exp(-DECAY_LAMBDA_PER_DAY * deltaDays);
}

/**
 * Compute normalized weight from a raw score.
 *
 * Details: uses a sigmoid-like function to clamp results to [0, 1].
 *
 * Side effects: none.
 * Error behavior: none.
 */
function computeWeight(score: number): number {
  return Math.max(0, Math.min(1, 1 - Math.exp(-WEIGHT_K * score)));
}

/**
 * Compute confidence from evidence volume.
 *
 * Details: uses a sigmoid-like function to clamp results to [0, 1].
 *
 * Side effects: none.
 * Error behavior: none.
 */
function computeConfidence(evidence: number): number {
  return Math.max(0, Math.min(1, 1 - Math.exp(-CONFIDENCE_C * evidence)));
}

/**
 * Compute relationship weight and confidence for features.
 *
 * Details: applies decay to counts, combines weighted signals, and derives
 * confidence from evidence volume.
 *
 * Side effects: none.
 * Error behavior: none.
 */
function computeScoreAndWeight(features: RelationshipFeatures, now: number) {
  const nowMs = now;

  const decayedMentions = applyDecay(features.mentions.count, features.mentions.lastAt, nowMs);
  const decayedReplies = applyDecay(features.replies.count, features.replies.lastAt, nowMs);
  const voiceOverlapHours = features.voice.overlapMs / (1000 * 60 * 60);

  const score =
    MENTION_WEIGHT * decayedMentions +
    REPLY_WEIGHT * decayedReplies +
    VOICE_WEIGHT * Math.log1p(voiceOverlapHours);

  const weight = computeWeight(score);

  const evidence = decayedMentions + decayedReplies + Math.min(5, voiceOverlapHours);
  const confidence = computeConfidence(evidence);

  return { weight, confidence };
}

/**
 * Update relationship edges based on a message event.
 *
 * Details: increments mention and reply features, then recomputes weight and
 * confidence for each affected pair.
 *
 * Side effects: writes relationship edges to storage.
 * Error behavior: logs and suppresses errors to avoid impacting ingestion.
 *
 * @param params - Message event details used to update edges.
 */
export async function updateFromMessage(params: {
  guildId: string;
  authorId: string;
  mentionedUserIds: string[];
  replyToAuthorId?: string | null;
  now?: Date;
}): Promise<void> {
  const { guildId, authorId, mentionedUserIds, replyToAuthorId, now = new Date() } = params;
  const nowMs = now.getTime();

  try {
    for (const mentionedUserId of mentionedUserIds) {
      if (mentionedUserId === authorId) continue; // Skip self-mentions

      const { userA, userB } = normalizePair(authorId, mentionedUserId);
      const existing = await findEdge({ guildId, userA, userB });

      let features: RelationshipFeatures;
      if (existing) {
        features = existing.featuresJson;
        features.mentions.count += 1;
        features.mentions.lastAt = nowMs;
        features.meta.lastComputedAt = nowMs;
      } else {
        features = {
          mentions: { count: 1, lastAt: nowMs },
          replies: { count: 0, lastAt: nowMs },
          voice: { overlapMs: 0, lastAt: nowMs },
          meta: { lastComputedAt: nowMs },
        };
      }

      const { weight, confidence } = computeScoreAndWeight(features, nowMs);
      await upsertEdge({
        guildId,
        userA,
        userB,
        weight,
        confidence,
        featuresJson: features,
        manualOverride: existing?.manualOverride ?? null,
      });
    }

    if (replyToAuthorId && replyToAuthorId !== authorId) {
      const { userA, userB } = normalizePair(authorId, replyToAuthorId);
      const existing = await findEdge({ guildId, userA, userB });

      let features: RelationshipFeatures;
      if (existing) {
        features = existing.featuresJson;
        features.replies.count += 1;
        features.replies.lastAt = nowMs;
        features.meta.lastComputedAt = nowMs;

        if (authorId === userB && replyToAuthorId === userA) {
          features.replies.reciprocalCount = (features.replies.reciprocalCount ?? 0) + 1;
        }
      } else {
        features = {
          mentions: { count: 0, lastAt: nowMs },
          replies: { count: 1, lastAt: nowMs },
          voice: { overlapMs: 0, lastAt: nowMs },
          meta: { lastComputedAt: nowMs },
        };
      }

      const { weight, confidence } = computeScoreAndWeight(features, nowMs);
      await upsertEdge({
        guildId,
        userA,
        userB,
        weight,
        confidence,
        featuresJson: features,
        manualOverride: existing?.manualOverride ?? null,
      });
    }
  } catch (error) {
    logger.warn({ error, guildId, authorId }, 'Relationship update from message failed');
  }
}

/**
 * Update relationship edges based on voice overlap.
 *
 * Details: accumulates overlapping time and recomputes weight/confidence.
 *
 * Side effects: writes relationship edges to storage.
 * Error behavior: logs and suppresses errors to avoid impacting ingestion.
 *
 * @param params - Voice overlap details used to update edges.
 */
export async function updateFromVoiceOverlap(params: {
  guildId: string;
  userId: string;
  otherUserId: string;
  overlapMs: number;
  now?: Date;
}): Promise<void> {
  const { guildId, userId, otherUserId, overlapMs, now = new Date() } = params;
  const nowMs = now.getTime();

  if (userId === otherUserId) return;
  if (overlapMs <= 0) return;

  try {
    const { userA, userB } = normalizePair(userId, otherUserId);
    const existing = await findEdge({ guildId, userA, userB });

    let features: RelationshipFeatures;
    if (existing) {
      features = existing.featuresJson;
      features.voice.overlapMs += overlapMs;
      features.voice.lastAt = nowMs;
      features.meta.lastComputedAt = nowMs;
    } else {
      features = {
        mentions: { count: 0, lastAt: nowMs },
        replies: { count: 0, lastAt: nowMs },
        voice: { overlapMs, lastAt: nowMs },
        meta: { lastComputedAt: nowMs },
      };
    }

    const { weight, confidence } = computeScoreAndWeight(features, nowMs);
    await upsertEdge({
      guildId,
      userA,
      userB,
      weight,
      confidence,
      featuresJson: features,
      manualOverride: existing?.manualOverride ?? null,
    });
  } catch (error) {
    logger.warn({ error, guildId, userId, otherUserId }, 'Relationship update from voice failed');
  }
}

/**
 * Fetch top relationship edges in a guild.
 *
 * Details: respects the repository's limit and optional minimum weight.
 *
 * Side effects: reads from storage.
 * Error behavior: propagates repository errors.
 *
 * @param params - Guild, limit, and minimum weight filter.
 * @returns Relationship edges sorted by weight.
 */
export async function getTopEdges(params: {
  guildId: string;
  limit: number;
  minWeight?: number;
}): Promise<RelationshipEdge[]> {
  return findTopEdges(params);
}

/**
 * Fetch relationship edges for a specific user.
 *
 * Details: returns edges involving the target user, limited by the repository.
 *
 * Side effects: reads from storage.
 * Error behavior: propagates repository errors.
 *
 * @param params - Guild, user, and result limit.
 * @returns Relationship edges involving the user.
 */
export async function getEdgesForUser(params: {
  guildId: string;
  userId: string;
  limit: number;
}): Promise<RelationshipEdge[]> {
  return findEdgesForUser(params);
}

/**
 * Set a manual relationship level between two users.
 *
 * Details: clamps the level to [0, 1] and overwrites weight/confidence while
 * preserving feature history.
 *
 * Side effects: writes relationship edges to storage.
 * Error behavior: propagates repository errors.
 *
 * @param params - Admin override details for the user pair.
 */
export async function setManualRelationship(params: {
  guildId: string;
  user1: string;
  user2: string;
  level0to1: number;
  adminId?: string;
}): Promise<void> {
  const { guildId, user1, user2, level0to1 } = params;
  const { userA, userB } = normalizePair(user1, user2);

  const clampedLevel = Math.max(0, Math.min(1, level0to1));
  const existing = await findEdge({ guildId, userA, userB });
  const nowMs = Date.now();

  let features: RelationshipFeatures;
  if (existing) {
    features = existing.featuresJson;
    features.meta.lastComputedAt = nowMs;
  } else {
    features = {
      mentions: { count: 0, lastAt: nowMs },
      replies: { count: 0, lastAt: nowMs },
      voice: { overlapMs: 0, lastAt: nowMs },
      meta: { lastComputedAt: nowMs },
    };
  }

  // Manual overrides pin confidence at 1.0 to reflect explicit admin intent.
  await upsertEdge({
    guildId,
    userA,
    userB,
    weight: clampedLevel,
    confidence: 1.0,
    featuresJson: features,
    manualOverride: clampedLevel,
  });
}

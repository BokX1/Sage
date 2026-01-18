import { logger } from '../../utils/logger';
import {
    findEdge,
    findEdgesForUser,
    findTopEdges,
    RelationshipEdge,
    RelationshipFeatures,
    upsertEdge,
} from './relationshipEdgeRepo';

/**
 * Configuration for relationship scoring algorithm
 */
const DECAY_LAMBDA_PER_DAY = 0.06; // Half-life ~11.5 days
const WEIGHT_K = 0.2; // Sigmoid steepness for score->weight
const CONFIDENCE_C = 0.25; // Sigmoid steepness for evidence->confidence
const MENTION_WEIGHT = 0.4;
const REPLY_WEIGHT = 0.4;
const VOICE_WEIGHT = 0.2;

/**
 * Normalize a pair of user IDs so userA < userB lexicographically.
 * This ensures consistent ordering for edge lookups.
 */
export function normalizePair(user1: string, user2: string): { userA: string; userB: string } {
    if (user1 < user2) {
        return { userA: user1, userB: user2 };
    }
    return { userA: user2, userB: user1 };
}

/**
 * Apply exponential decay to a value based on time elapsed.
 * decay = value * e^(-lambda * deltaDays)
 */
function applyDecay(value: number, lastAt: number, now: number): number {
    const deltaDays = (now - lastAt) / (1000 * 60 * 60 * 24);
    return value * Math.exp(-DECAY_LAMBDA_PER_DAY * deltaDays);
}

/**
 * Compute weight from raw score using sigmoid-like function.
 * weight = 1 - e^(-k * score)
 */
function computeWeight(score: number): number {
    return Math.max(0, Math.min(1, 1 - Math.exp(-WEIGHT_K * score)));
}

/**
 * Compute confidence from evidence volume.
 * confidence = 1 - e^(-c * evidence)
 */
function computeConfidence(evidence: number): number {
    return Math.max(0, Math.min(1, 1 - Math.exp(-CONFIDENCE_C * evidence)));
}

/**
 * Compute relationship score and update edge.
 */
function computeScoreAndWeight(features: RelationshipFeatures, now: number) {
    const nowMs = now;

    // Apply decay
    const decayedMentions = applyDecay(features.mentions.count, features.mentions.lastAt, nowMs);
    const decayedReplies = applyDecay(features.replies.count, features.replies.lastAt, nowMs);
    const voiceOverlapHours = features.voice.overlapMs / (1000 * 60 * 60);

    // Raw score
    const score =
        MENTION_WEIGHT * decayedMentions +
        REPLY_WEIGHT * decayedReplies +
        VOICE_WEIGHT * Math.log1p(voiceOverlapHours);

    // Weight
    const weight = computeWeight(score);

    // Confidence (evidence volume)
    const evidence = decayedMentions + decayedReplies + Math.min(5, voiceOverlapHours);
    const confidence = computeConfidence(evidence);

    return { weight, confidence };
}

/**
 * Update relationship edge based on a message event.
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
        // Update edges for mentions
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

        // Update edge for reply
        if (replyToAuthorId && replyToAuthorId !== authorId) {
            const { userA, userB } = normalizePair(authorId, replyToAuthorId);
            const existing = await findEdge({ guildId, userA, userB });

            let features: RelationshipFeatures;
            if (existing) {
                features = existing.featuresJson;
                features.replies.count += 1;
                features.replies.lastAt = nowMs;
                features.meta.lastComputedAt = nowMs;

                // Track reciprocity (optional enhancement)
                if (authorId === userA && replyToAuthorId === userB) {
                    // A replied to B
                } else if (authorId === userB && replyToAuthorId === userA) {
                    // B replied to A (reciprocal)
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
 * Update relationship edge based on voice overlap.
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

    if (userId === otherUserId) return; // Skip self-overlap
    if (overlapMs <= 0) return; // Skip zero overlap

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
 * Get top relationship edges in a guild.
 */
export async function getTopEdges(params: {
    guildId: string;
    limit: number;
    minWeight?: number;
}): Promise<RelationshipEdge[]> {
    return findTopEdges(params);
}

/**
 * Get relationship edges for a specific user.
 */
export async function getEdgesForUser(params: {
    guildId: string;
    userId: string;
    limit: number;
}): Promise<RelationshipEdge[]> {
    return findEdgesForUser(params);
}

/**
 * Set manual relationship level between two users (admin action).
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

    // Admin override: weight = manual level, confidence = 1.0
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

import { logger } from '../../platform/logging/logger';
import { updateProfileSummary } from './profileUpdater';
import { prisma } from '../../platform/db/prisma-client';

import { config } from '../../platform/config/env';

// ============================================
// User Profile 30-Day Time Decay
// ============================================
// Compacts user profiles on a rolling TTL (configured in .env).
// Retains core <directives> and <background>, decays stale <active_focus>.

const COMPACTION_INTERVAL_DAYS = config.USER_PROFILE_COMPACTION_INTERVAL_DAYS;

/**
 * The compaction prompt tells the profile updater to decay stale active_focus.
 * We simulate it as a special "system maintenance" conversation turn.
 */
const COMPACTION_USER_MESSAGE = `[SYSTEM MAINTENANCE — 30-Day Profile Compaction]
Please review and compact this user's profile:
- RETAIN all <directives> and <background> sections unchanged.
- DECAY the <active_focus> section: remove any items that appear stale or completed.
- If all items in <active_focus> still seem relevant, keep them.
- Do NOT add new information. Only remove stale data.`;

const COMPACTION_ASSISTANT_REPLY = 'Profile compaction acknowledged. Reviewing for stale active focus items.';

/**
 * Check if a user's profile needs compaction based on its updatedAt timestamp.
 */
export function needsCompaction(updatedAt: Date, nowMs: number = Date.now()): boolean {
    const ageMs = nowMs - updatedAt.getTime();
    const thresholdMs = COMPACTION_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    return ageMs >= thresholdMs;
}

/**
 * Compact a single user's profile by passing it through the profile updater
 * with a compaction-specific prompt.
 */
export async function compactUserProfile(params: {
    userId: string;
    guildId: string | null;
    channelId: string;
    previousSummary: string;
}): Promise<string | null> {
    logger.info({ userId: params.userId }, 'Running 30-day user profile compaction');

    try {
        if (params.previousSummary) {
            await prisma.userProfileArchive.create({
                data: {
                    userId: params.userId,
                    summary: params.previousSummary,
                },
            });
            logger.debug({ userId: params.userId }, 'Saved pre-compaction user profile archive');
        }

        const result = await updateProfileSummary({
            previousSummary: params.previousSummary,
            userMessage: COMPACTION_USER_MESSAGE,
            assistantReply: COMPACTION_ASSISTANT_REPLY,
            channelId: params.channelId,
            guildId: params.guildId,
            userId: params.userId,
        });

        if (result) {
            logger.info({ userId: params.userId }, 'User profile compacted successfully');
        } else {
            logger.warn({ userId: params.userId }, 'User profile compaction returned null, preserving original');
        }

        return result;
    } catch (error) {
        logger.error({ error, userId: params.userId }, 'User profile compaction failed');
        return null;
    }
}

/**
 * Declares exported bindings: USER_COMPACTION_INTERVAL_DAYS.
 */
export const USER_COMPACTION_INTERVAL_DAYS = COMPACTION_INTERVAL_DAYS;

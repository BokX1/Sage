import { logger } from '../../utils/logger';
import { getGuildPresence } from './voicePresenceIndex';
import { updateFromVoiceOverlap } from '../relationships/relationshipGraph';

/**
 * Compute and update relationship edges for voice overlap.
 *
 * Details: uses the current channel presence to determine overlap with users
 * still connected when a member leaves.
 *
 * Side effects: writes relationship edges and logs warnings on failure.
 * Error behavior: swallows errors to avoid disrupting voice state handling.
 *
 * @param params - Voice session details for the departing user.
 */
export async function computeVoiceOverlapForUser(params: {
  guildId: string;
  userId: string;
  channelId: string;
  joinedAt: Date;
  leftAt: Date;
}): Promise<void> {
  const { guildId, userId, channelId, joinedAt, leftAt } = params;

  try {
    const guildPresence = getGuildPresence(guildId);
    const channelPresence = guildPresence.find((c) => c.channelId === channelId);

    if (!channelPresence || channelPresence.members.length === 0) {
      return;
    }

    const userJoinMs = joinedAt.getTime();
    const userLeaveMs = leftAt.getTime();
    const userDurationMs = userLeaveMs - userJoinMs;

    if (userDurationMs <= 0) {
      return;
    }

    for (const member of channelPresence.members) {
      if (member.userId === userId) continue;

      const otherJoinMs = member.joinedAt.getTime();
      const overlapStart = Math.max(userJoinMs, otherJoinMs);
      const overlapEnd = userLeaveMs;
      const overlapMs = Math.max(0, overlapEnd - overlapStart);

      if (overlapMs > 0) {
        await updateFromVoiceOverlap({
          guildId,
          userId,
          otherUserId: member.userId,
          overlapMs,
          now: leftAt,
        });
      }
    }
  } catch (error) {
    logger.warn(
      { error, guildId, userId, channelId },
      'Voice overlap computation failed (non-fatal)',
    );
  }
}

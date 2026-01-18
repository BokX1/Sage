import { logger } from '../../utils/logger';
import { getGuildPresence } from './voicePresenceIndex';
import { updateFromVoiceOverlap } from '../relationships/relationshipGraph';

/**
 * Compute and update relationship edges for voice overlap.
 * Called when a user leaves a voice channel.
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
    // Get current presence in the channel
    const guildPresence = getGuildPresence(guildId);
    const channelPresence = guildPresence.find((c) => c.channelId === channelId);

    if (!channelPresence || channelPresence.members.length === 0) {
      return; // No one else in channel
    }

    const userJoinMs = joinedAt.getTime();
    const userLeaveMs = leftAt.getTime();
    const userDurationMs = userLeaveMs - userJoinMs;

    if (userDurationMs <= 0) {
      return; // Invalid duration
    }

    // Compute overlap with each other user currently in channel
    for (const member of channelPresence.members) {
      if (member.userId === userId) continue; // Skip self

      const otherJoinMs = member.joinedAt.getTime();
      const overlapStart = Math.max(userJoinMs, otherJoinMs);
      const overlapEnd = userLeaveMs; // User is leaving, other is still present
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

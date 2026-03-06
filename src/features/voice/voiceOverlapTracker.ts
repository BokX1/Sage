import { logger } from '../../platform/logging/logger';
import { getGuildPresence } from './voicePresenceIndex';
import { publishVoiceSession } from '../../platform/social-graph/kafkaProducer';

/**
 * Compute and publish voice overlap events for the social graph pipeline.
 *
 * Details: uses the current channel presence to determine overlap with users
 * still connected when a member leaves.
 *
 * Side effects: publishes Kafka voice-session events and logs warnings on failure.
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
        void publishVoiceSession({
          guildId,
          userA: userId,
          userB: member.userId,
          durationMs: overlapMs,
          timestamp: leftAt.toISOString(),
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

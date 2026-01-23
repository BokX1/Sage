import { getUserProfile, upsertUserProfile } from '../memory/userProfileRepo';
import { getGuildApiKey } from '../settings/guildSettingsRepo';
import { updateProfileSummary } from '../memory/profileUpdater';
import { logger } from '../utils/logger';
import { runChatTurn } from '../agentRuntime';
import { LLMMessageContent } from '../llm/types';
import { config } from '../../config';

import { limitByKey } from '../utils/perKeyConcurrency';

/**
 * Per-user interaction counter for profile update throttling.
 * Maps userId to count of messages since last profile update.
 */
const userInteractionCounts = new Map<string, number>();

/**
 * Generate a chat reply using the agent runtime.
 * This is the main entry point for chat interactions.
 *
 * Flow:
 * 1. Load user profile
 * 2. Delegate to agentRuntime.runChatTurn
 * 3. Trigger background profile update (throttled every N messages)
 */
export async function generateChatReply(params: {
  traceId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  messageId: string;
  userText: string;
  userContent?: LLMMessageContent;
  replyToBotText?: string | null;
  replyReferenceContent?: LLMMessageContent | null;
  intent?: string | null;
  mentionedUserIds?: string[];
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
  isVoiceActive?: boolean;
}): Promise<{ replyText: string; styleHint?: string; voice?: string }> {
  // Enforce sequential processing per user
  const limit = limitByKey(params.userId, 1);

  return limit(async () => {
    const {
      traceId,
      userId,
      channelId,
      guildId,
      messageId,
      userText,
      userContent,
      replyToBotText,
      replyReferenceContent,
      intent,
      mentionedUserIds,
      invokedBy = 'mention',
      isVoiceActive,
    } = params;

    // 1. Load Profile
    let profileSummary: string | null = null;
    try {
      profileSummary = await getUserProfile(userId);
    } catch (err) {
      logger.warn({ error: err, userId }, 'Failed to load user profile (non-fatal)');
    }

    logger.debug({ userId, profileSummary: profileSummary || 'None' }, 'Memory Context');

    // 2. Call Agent Runtime
    const result = await runChatTurn({
      traceId,
      userId,
      channelId,
      guildId,
      messageId,
      userText,
      userContent,
      userProfileSummary: profileSummary,
      replyToBotText: replyToBotText ?? null,
      replyReferenceContent: replyReferenceContent ?? null,
      intent: intent ?? null,
      mentionedUserIds,
      invokedBy,
      isVoiceActive,
    });

    const replyText = result.replyText;

    // 3. Update Profile (Background, Throttled)
    // Only trigger profile update every PROFILE_UPDATE_INTERVAL messages
    const apiKey = (guildId ? await getGuildApiKey(guildId) : undefined) ?? config.POLLINATIONS_API_KEY;

    if (apiKey) {
      // Increment interaction count
      const currentCount = (userInteractionCounts.get(userId) || 0) + 1;
      userInteractionCounts.set(userId, currentCount);

      const shouldUpdateProfile = currentCount >= config.PROFILE_UPDATE_INTERVAL;

      if (shouldUpdateProfile) {
        // Reset counter before update
        userInteractionCounts.set(userId, 0);

        logger.debug(
          { userId, messageCount: currentCount, interval: config.PROFILE_UPDATE_INTERVAL },
          'Profile update triggered (throttled)'
        );

        updateProfileSummary({
          previousSummary: profileSummary,
          userMessage: userText,
          assistantReply: replyText,
          channelId,
          guildId,
          userId,
          apiKey,
        })
          .then((newSummary) => {
            if (newSummary && newSummary !== profileSummary) {
              upsertUserProfile(userId, newSummary).catch((err) =>
                logger.error({ error: err }, 'Failed to save profile'),
              );
            }
          })
          .catch((err) => {
            logger.error({ error: err }, 'Profile update failed');
          });
      } else {
        logger.debug(
          { userId, messageCount: currentCount, threshold: config.PROFILE_UPDATE_INTERVAL },
          'Profile update skipped (throttled)'
        );
      }
    }

    return { replyText, styleHint: result.styleHint, voice: result.voice };
  });
}

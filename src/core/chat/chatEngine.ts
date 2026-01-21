import { getUserProfile, upsertUserProfile } from '../memory/userProfileRepo';
import { updateProfileSummary } from '../memory/profileUpdater';
import { logger } from '../utils/logger';
import { runChatTurn } from '../agentRuntime';
import { LLMMessageContent } from '../llm/types';

import { limitByKey } from '../utils/perKeyConcurrency';

/**
 * Generate a chat reply using the agent runtime.
 * This is the main entry point for chat interactions.
 *
 * Flow:
 * 1. Load user profile
 * 2. Delegate to agentRuntime.runChatTurn
 * 3. Trigger background profile update
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
}): Promise<{ replyText: string }> {
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
    });

    const replyText = result.replyText;

    // 3. Update Profile (Background)
    updateProfileSummary({
      previousSummary: profileSummary,
      userMessage: userText,
      assistantReply: replyText,
      channelId,
      guildId,
      userId,
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

    return { replyText };
  });
}

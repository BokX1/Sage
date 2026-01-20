import { getUserProfile, upsertUserProfile } from '../memory/userProfileRepo';
import { updateProfileSummary } from '../memory/profileUpdater';
import { logger } from '../utils/logger';
import { runChatTurn } from '../agentRuntime';

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
  replyToBotText?: string | null;
  intent?: string | null;
  mentionedUserIds?: string[];
}): Promise<{ replyText: string }> {
  const {
    traceId,
    userId,
    channelId,
    guildId,
    messageId,
    userText,
    replyToBotText,
    intent,
    mentionedUserIds,
  } = params;

  // 1. Load Profile
  const profileSummary = await getUserProfile(userId);

  logger.debug({ userId, profileSummary: profileSummary || 'None' }, 'Memory Context');

  // 2. Call Agent Runtime
  const result = await runChatTurn({
    traceId,
    userId,
    channelId,
    guildId,
    messageId,
    userText,
    userProfileSummary: profileSummary,
    replyToBotText: replyToBotText ?? null,
    intent: intent ?? null,
    mentionedUserIds,
  });

  const replyText = result.replyText;

  // 3. Update Profile (Background)
  updateProfileSummary({
    previousSummary: profileSummary,
    userMessage: userText,
    assistantReply: replyText,
  }).then((newSummary) => {
    if (newSummary && newSummary !== profileSummary) {
      upsertUserProfile(userId, newSummary).catch((err) =>
        logger.error({ error: err }, 'Failed to save profile'),
      );
    }
  });

  return { replyText };
}

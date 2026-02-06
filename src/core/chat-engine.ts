import { getUserProfile, upsertUserProfile } from './memory/userProfileRepo';
import { getGuildApiKey } from './settings/guildSettingsRepo';
import { updateProfileSummary } from './memory/profileUpdater';
import { logger } from './utils/logger';
import { runChatTurn } from './agentRuntime';
import { LLMMessageContent } from './llm/llm-types';
import { config } from '../config';

import { limitByKey } from './utils/perKeyConcurrency';

/**
 * Per-user interaction counter for profile update throttling.
 * Maps userId to { count, lastActiveAt } for cleanup support.
 */
type InteractionEntry = { count: number; lastActiveAt: number };
const userInteractionCounts = new Map<string, InteractionEntry>();
const INTERACTION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastInteractionCleanupMs = Date.now();

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
  hasAttachment?: boolean;
}): Promise<{
  replyText: string;
  styleHint?: string;
  voice?: string;
  files?: Array<{ attachment: Buffer; name: string }>;
}> {
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
      hasAttachment,
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
      hasAttachment,
    });

    const replyText = result.replyText;

    // 3. Update Profile (Background, Throttled)
    // Only trigger profile update every PROFILE_UPDATE_INTERVAL messages
    const apiKey = (guildId ? await getGuildApiKey(guildId) : undefined) ?? config.LLM_API_KEY;

    if (apiKey) {
      const nowMs = Date.now();

      // Periodic cleanup of stale interaction entries (every hour)
      if (nowMs - lastInteractionCleanupMs > 60 * 60 * 1000) {
        lastInteractionCleanupMs = nowMs;
        for (const [uid, entry] of userInteractionCounts) {
          if (nowMs - entry.lastActiveAt > INTERACTION_TTL_MS) {
            userInteractionCounts.delete(uid);
          }
        }
      }

      // Increment interaction count
      const existing = userInteractionCounts.get(userId);
      const currentCount = (existing?.count || 0) + 1;
      userInteractionCounts.set(userId, { count: currentCount, lastActiveAt: nowMs });

      const shouldUpdateProfile = currentCount >= config.PROFILE_UPDATE_INTERVAL;

      if (shouldUpdateProfile) {
        // Reset counter before update
        userInteractionCounts.set(userId, { count: 0, lastActiveAt: nowMs });

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

    return {
      replyText,
      styleHint: result.styleHint,
      voice: result.voice,
      files: result.files
    };
  });
}

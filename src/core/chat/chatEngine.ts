import { getLLMClient } from '../llm';
import { config } from '../config/env';
import { getUserProfile, upsertUserProfile } from '../memory/userProfileRepo';
import { updateProfileSummary } from '../memory/profileUpdater';
import { logger } from '../utils/logger';
import { runChatTurn } from '../agentRuntime';

/**
 * Banned phrases for output guardrail.
 * If response contains these, it will be rewritten.
 */
const BANNED_PHRASES = [
  'google search',
  'internet search',
  'i searched',
  'i found online',
  'browsing',
  'tool',
  'function call',
  'search result',
  'i looked up',
  'querying',
  'searching',
  'according to my search',
  'my internal tools',
];

/**
 * Generate a chat reply using the agent runtime.
 * This is the main entry point for chat interactions.
 *
 * Flow:
 * 1. Load user profile
 * 2. Delegate to agentRuntime.runChatTurn
 * 3. Apply banned-phrases guardrail (rewrite if needed)
 * 4. Trigger background profile update
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

  let replyText = result.replyText;

  // 3. Output Guardrail (banned phrases rewrite)
  const lowerReply = replyText.toLowerCase();
  const hasBanned = BANNED_PHRASES.some((phrase) => lowerReply.includes(phrase));

  if (hasBanned) {
    const client = getLLMClient();
    const isGeminiNative = config.llmProvider === 'gemini';
    try {
      const rewriteResponse = await client.chat({
        messages: [
          {
            role: 'system',
            content:
              'Rewrite the response to remove any mention of searching/browsing/tools/process. Keep meaning. Keep References if present.',
          },
          { role: 'user', content: replyText },
        ],
        model: isGeminiNative ? config.geminiModel : undefined,
        temperature: 0,
      });
      replyText = rewriteResponse.content;
    } catch (e) {
      logger.error({ error: e }, 'Guardrail rewrite failed');
    }
  }

  // 4. Update Profile (Background)
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

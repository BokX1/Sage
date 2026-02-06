import { logger } from '../../core/utils/logger';
import { ExpertName, ExpertPacket } from './experts/expert-types';
import { runMemoryExpert } from './experts/memoryExpert';
import { runSocialGraphExpert } from './experts/socialGraphExpert';
import { runVoiceAnalyticsExpert } from './experts/voiceAnalyticsExpert';
import { runSummarizerExpert } from './experts/summarizerExpert';
import { runImageGenExpert } from './experts/imageGenExpert';
import { LLMMessageContent, LLMChatMessage } from '../llm/llm-types';

export interface RunExpertsParams {
  experts: ExpertName[];
  guildId: string | null;
  channelId: string;
  userId: string;
  traceId: string;
  skipMemory?: boolean;
  userText?: string;
  userContent?: LLMMessageContent;
  replyReferenceContent?: LLMMessageContent | null;
  conversationHistory?: LLMChatMessage[];
  apiKey?: string;
}

/**
 * Execute a single expert and return its context packet.
 * Handles per-expert error isolation.
 */
async function executeExpert(
  expertName: ExpertName,
  params: RunExpertsParams,
): Promise<ExpertPacket | null> {
  const { guildId, channelId, userId, traceId } = params;

  try {
    switch (expertName) {
      case 'Memory':
        if (params.skipMemory) {
          return null; // Skip - already loaded
        }
        return await runMemoryExpert({ userId });

      case 'SocialGraph':
        if (!guildId) {
          return {
            name: 'SocialGraph',
            content: 'Social context: Not available in DM context.',
            tokenEstimate: 10,
          };
        }
        return await runSocialGraphExpert({ guildId, userId });

      case 'VoiceAnalytics':
        if (!guildId) {
          return {
            name: 'VoiceAnalytics',
            content: 'Voice analytics: Not available in DM context.',
            tokenEstimate: 10,
          };
        }
        return await runVoiceAnalyticsExpert({ guildId, userId });

      case 'Summarizer':
        if (!guildId) {
          return {
            name: 'Summarizer',
            content: 'Summarization context: Not available in DM context.',
            tokenEstimate: 10,
          };
        }
        return await runSummarizerExpert({ guildId, channelId });

      case 'ImageGenerator':
        if (!params.userText) {
          return {
            name: 'ImageGenerator',
            content: 'ImageGenerator: Missing prompt text.',
            tokenEstimate: 5,
          };
        }
        return await runImageGenExpert({
          userText: params.userText,
          userContent: params.userContent,
          replyReferenceContent: params.replyReferenceContent,
          conversationHistory: params.conversationHistory,
          apiKey: params.apiKey,
        });

      default:
        logger.warn({ expertName, traceId }, 'Unknown expert name');
        return null;
    }
  } catch (error) {
    logger.warn({ error, expertName, traceId }, 'Expert execution failed');
    return {
      name: expertName,
      content: `${expertName}: Error loading data.`,
      json: { error: String(error) },
      tokenEstimate: 10,
    };
  }
}

/**
 * Execute selected experts in parallel and return their context packets.
 * Experts may perform DB queries, external HTTP requests, and LLM calls.
 * Some experts can also return attachments (e.g., image bytes).
 *
 * Performance: Experts are executed concurrently using Promise.allSettled
 * to maximize throughput and isolate failures.
 */
export async function runExperts(params: RunExpertsParams): Promise<ExpertPacket[]> {
  const { experts, traceId } = params;

  // Execute all experts in parallel
  const expertPromises = experts.map((expertName) => executeExpert(expertName, params));
  const results = await Promise.allSettled(expertPromises);

  // Collect successful results, filter out nulls and rejected promises
  const packets: ExpertPacket[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const expertName = experts[i];

    if (result.status === 'fulfilled') {
      if (result.value !== null) {
        packets.push(result.value);
      }
    } else {
      // Promise.allSettled rejected - shouldn't happen due to try/catch in executeExpert
      // but handle defensively
      logger.error({ error: result.reason, expertName, traceId }, 'Expert promise rejected');
      packets.push({
        name: expertName,
        content: `${expertName}: Unexpected error.`,
        json: { error: String(result.reason) },
        tokenEstimate: 10,
      });
    }
  }

  return packets;
}

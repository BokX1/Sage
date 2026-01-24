import { logger } from '../../utils/logger';
import { ExpertName, ExpertPacket } from './experts/types';
import { runMemoryExpert } from './experts/memoryExpert';
import { runSocialGraphExpert } from './experts/socialGraphExpert';
import { runVoiceAnalyticsExpert } from './experts/voiceAnalyticsExpert';
import { runSummarizerExpert } from './experts/summarizerExpert';
import { runImageGenExpert } from './experts/imageGenExpert';
import { LLMMessageContent, LLMChatMessage } from '../llm/types';

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
 * Execute selected experts and return their context packets.
 * Experts may perform DB queries, external HTTP requests, and LLM calls.
 * Some experts can also return attachments (e.g., image bytes).
 */
export async function runExperts(params: RunExpertsParams): Promise<ExpertPacket[]> {
  const { experts, guildId, channelId, userId, traceId } = params;

  const packets: ExpertPacket[] = [];

  for (const expertName of experts) {
    try {
      let packet: ExpertPacket;

      switch (expertName) {
        case 'Memory':
          if (params.skipMemory) {
            // Optimization: Skip valid memory if already loaded
            continue;
          }
          packet = await runMemoryExpert({ userId });
          break;

        case 'SocialGraph':
          if (!guildId) {
            packet = {
              name: 'SocialGraph',
              content: 'Social context: Not available in DM context.',
              tokenEstimate: 10,
            };
          } else {
            packet = await runSocialGraphExpert({ guildId, userId });
          }
          break;

        case 'VoiceAnalytics':
          if (!guildId) {
            packet = {
              name: 'VoiceAnalytics',
              content: 'Voice analytics: Not available in DM context.',
              tokenEstimate: 10,
            };
          } else {
            packet = await runVoiceAnalyticsExpert({ guildId, userId });
          }
          break;

        case 'Summarizer':
          if (!guildId) {
            packet = {
              name: 'Summarizer',
              content: 'Summarization context: Not available in DM context.',
              tokenEstimate: 10,
            };
          } else {
            packet = await runSummarizerExpert({ guildId, channelId });
          }
          break;

        case 'ImageGenerator':
          if (!params.userText) {
            packet = {
              name: 'ImageGenerator',
              content: 'ImageGenerator: Missing prompt text.',
              tokenEstimate: 5,
            };
          } else {
            packet = await runImageGenExpert({
              userText: params.userText,
              userContent: params.userContent,
              replyReferenceContent: params.replyReferenceContent,
              conversationHistory: params.conversationHistory,
              apiKey: params.apiKey
            });
          }
          break;

        default:
          logger.warn({ expertName, traceId }, 'Unknown expert name');
          continue;
      }

      packets.push(packet);
    } catch (error) {
      logger.warn({ error, expertName, traceId }, 'Expert execution failed');
      packets.push({
        name: expertName,
        content: `${expertName}: Error loading data.`,
        json: { error: String(error) },
        tokenEstimate: 10,
      });
    }
  }

  return packets;
}

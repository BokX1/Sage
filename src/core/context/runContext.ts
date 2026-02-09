import { logger } from '../utils/logger';
import { ContextProviderName, ContextPacket } from './context-types';
import { runMemoryProvider } from './providers/memoryProvider';
import { runSocialGraphProvider } from './providers/socialGraphProvider';
import { runVoiceAnalyticsProvider } from './providers/voiceAnalyticsProvider';
import { runSummarizerProvider } from './providers/summarizerProvider';

export interface RunContextParams {
  providers: ContextProviderName[];
  guildId: string | null;
  channelId: string;
  userId: string;
  traceId: string;
  skipMemory?: boolean;
}

/**
 * Execute a single provider and return its context packet.
 * Handles per-provider error isolation.
 */
async function executeProvider(
  providerName: ContextProviderName,
  params: RunContextParams,
): Promise<ContextPacket | null> {
  const { guildId, channelId, userId, traceId } = params;

  try {
    switch (providerName) {
      case 'Memory':
        if (params.skipMemory) {
          return null; // Skip - already loaded
        }
        return await runMemoryProvider({ userId });

      case 'SocialGraph':
        if (!guildId) {
          return {
            name: 'SocialGraph',
            content: 'Social context: Not available in DM context.',
            tokenEstimate: 10,
          };
        }
        return await runSocialGraphProvider({ guildId, userId });

      case 'VoiceAnalytics':
        if (!guildId) {
          return {
            name: 'VoiceAnalytics',
            content: 'Voice analytics: Not available in DM context.',
            tokenEstimate: 10,
          };
        }
        return await runVoiceAnalyticsProvider({ guildId, userId });

      case 'Summarizer':
        if (!guildId) {
          return {
            name: 'Summarizer',
            content: 'Summarization context: Not available in DM context.',
            tokenEstimate: 10,
          };
        }
        return await runSummarizerProvider({ guildId, channelId });

      default:
        logger.warn({ providerName, traceId }, 'Unknown context provider name');
        return null;
    }
  } catch (error) {
    logger.warn({ error, providerName, traceId }, 'Context provider execution failed');
    return {
      name: providerName,
      content: `${providerName}: Error loading data.`,
      json: { error: String(error) },
      tokenEstimate: 10,
    };
  }
}

/**
 * Execute selected context providers in parallel and return their context packets.
 * Providers may perform DB queries or other fetch operations.
 *
 * Performance: Providers are executed concurrently using Promise.allSettled
 * to maximize throughput and isolate failures.
 */
export async function runContextProviders(params: RunContextParams): Promise<ContextPacket[]> {
  const { providers, traceId } = params;

  // Execute all providers in parallel
  const providerPromises = providers.map((name) => executeProvider(name, params));
  const results = await Promise.allSettled(providerPromises);

  // Collect successful results, filter out nulls
  const packets: ContextPacket[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const providerName = providers[i];

    if (result.status === 'fulfilled') {
      if (result.value !== null) {
        packets.push(result.value);
      }
    } else {
      logger.error({ error: result.reason, providerName, traceId }, 'Provider promise rejected');
      packets.push({
        name: providerName,
        content: `${providerName}: Unexpected error.`,
        json: { error: String(result.reason) },
        tokenEstimate: 10,
      });
    }
  }

  return packets;
}

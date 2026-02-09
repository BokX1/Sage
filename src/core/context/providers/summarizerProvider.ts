import { getChannelSummaryStore } from '../../summary/channelSummaryStoreRegistry';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ContextPacket } from '../context-types';

export interface RunSummarizerProviderParams {
  guildId: string;
  channelId: string;
  maxChars?: number;
}

/**
 * Summarizer provider: gathers best available summary context.
 * This provider does NOT run an LLM - it just retrieves stored summaries.
 */
export async function runSummarizerProvider(
  params: RunSummarizerProviderParams,
): Promise<ContextPacket> {
  const { guildId, channelId, maxChars = 600 } = params;

  try {
    const summaryStore = getChannelSummaryStore();

    const [rollingSummary, profileSummary] = await Promise.all([
      summaryStore.getLatestSummary({ guildId, channelId, kind: 'rolling' }),
      summaryStore.getLatestSummary({ guildId, channelId, kind: 'profile' }),
    ]);

    const parts: string[] = [];

    if (rollingSummary) {
      parts.push(`Recent: ${rollingSummary.summaryText}`);
    }

    if (profileSummary) {
      parts.push(`Profile: ${profileSummary.summaryText}`);
    }

    if (parts.length === 0) {
      return {
        name: 'Summarizer',
        content: 'Summarization context: No stored summaries available. Use transcript directly.',
        json: { rollingSummary: null, profileSummary: null },
        tokenEstimate: 20,
      };
    }

    let content = `Summarization context: ${parts.join(' | ')}`;

    // Truncate if needed
    if (content.length > maxChars) {
      content = content.slice(0, maxChars).trim() + '...';
    }

    return {
      name: 'Summarizer',
      content,
      json: {
        hasRolling: !!rollingSummary,
        hasProfile: !!profileSummary,
      },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'Summarizer',
      content: 'Summarization context: Error loading summaries.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}

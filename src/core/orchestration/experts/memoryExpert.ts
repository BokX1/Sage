import { getUserProfile } from '../../memory/userProfileRepo';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ExpertPacket } from './types';

export interface RunMemoryExpertParams {
  userId: string;
  maxChars?: number;
}

/**
 * Memory expert: retrieves user profile summary.
 * Returns a bounded, compressed memory packet.
 */
export async function runMemoryExpert(params: RunMemoryExpertParams): Promise<ExpertPacket> {
  const { userId, maxChars = 1000 } = params;

  try {
    const summary = await getUserProfile(userId);

    if (!summary || summary.trim().length === 0) {
      return {
        name: 'Memory',
        content: 'User memory: No personalization data available.',
        json: { summary: null },
        tokenEstimate: 10,
      };
    }

    // Truncate if needed
    let content = summary;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars).trim() + '...';
    }

    const formatted = `User memory (compressed): ${content}`;

    return {
      name: 'Memory',
      content: formatted,
      json: { summary: content, truncated: content.length < summary.length },
      tokenEstimate: estimateTokens(formatted),
    };
  } catch (error) {
    return {
      name: 'Memory',
      content: 'User memory: Error loading profile.',
      json: { error: String(error) },
      tokenEstimate: 10,
    };
  }
}

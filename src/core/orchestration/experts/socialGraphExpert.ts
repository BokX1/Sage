import { getEdgesForUser } from '../../relationships/relationshipGraph';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ExpertPacket } from './types';

export interface RunSocialGraphExpertParams {
  guildId: string;
  userId: string;
  maxEdges?: number;
  maxChars?: number;
}

/**
 * Social graph expert: retrieves top relationship edges for a user.
 * Returns probabilistic phrasing with evidence counts.
 */
export async function runSocialGraphExpert(
  params: RunSocialGraphExpertParams,
): Promise<ExpertPacket> {
  const { guildId, userId, maxEdges = 10, maxChars = 1200 } = params;

  try {
    const edges = await getEdgesForUser({ guildId, userId, limit: maxEdges });

    if (edges.length === 0) {
      return {
        name: 'SocialGraph',
        content: 'Social context: No relationship data available for this user.',
        json: { edges: [] },
        tokenEstimate: 15,
      };
    }

    const lines: string[] = [];
    for (const edge of edges) {
      const otherId = edge.userA === userId ? edge.userB : edge.userA;
      const f = edge.featuresJson;

      const evidenceParts: string[] = [];
      if (f.mentions?.count > 0) evidenceParts.push(`${f.mentions.count} mentions`);
      if (f.replies?.count > 0) evidenceParts.push(`${f.replies.count} replies`);
      if (f.voice?.overlapMs > 0) {
        const mins = Math.round(f.voice.overlapMs / 60000);
        if (mins > 0) evidenceParts.push(`${mins}min voice`);
      }

      const evidence = evidenceParts.join(', ') || 'minimal activity';
      const strength = (edge.weight * 100).toFixed(0);
      lines.push(`- User <@${otherId}>: ${strength}% relationship (${evidence})`);
    }

    let content = `Social context: Top relationships for this user:\n${lines.join('\n')}`;

    // Truncate if needed
    if (content.length > maxChars) {
      content = content.slice(0, maxChars).trim() + '\n(truncated)';
    }

    return {
      name: 'SocialGraph',
      content,
      json: { edgeCount: edges.length, topEdges: edges.slice(0, 5) },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'SocialGraph',
      content: 'Social context: Error loading relationship graph.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}

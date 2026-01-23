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
 * Relationship tier labels based on weight.
 * Provides human-readable context for the LLM.
 */
type RelationshipTier = 'Best Friend' | 'Close Friend' | 'Friend' | 'Acquaintance' | 'New Connection';

function getRelationshipTier(weight: number): RelationshipTier {
  if (weight >= 0.8) return 'Best Friend';
  if (weight >= 0.6) return 'Close Friend';
  if (weight >= 0.4) return 'Friend';
  if (weight >= 0.2) return 'Acquaintance';
  return 'New Connection';
}

function getRelationshipEmoji(tier: RelationshipTier): string {
  switch (tier) {
    case 'Best Friend': return '💜';
    case 'Close Friend': return '💙';
    case 'Friend': return '💚';
    case 'Acquaintance': return '🤝';
    case 'New Connection': return '👋';
  }
}

/**
 * Format evidence into a natural language description.
 */
function formatEvidenceNarrative(features: {
  mentions?: { count?: number };
  replies?: { count?: number };
  voice?: { overlapMs?: number };
}): string {
  const parts: string[] = [];

  const mentionsCount = features.mentions?.count ?? 0;
  if (mentionsCount > 0) {
    if (mentionsCount >= 50) parts.push('frequently mentions each other');
    else if (mentionsCount >= 20) parts.push('regularly interact via mentions');
    else if (mentionsCount >= 5) parts.push('occasionally mention each other');
    else parts.push('have exchanged a few mentions');
  }

  const repliesCount = features.replies?.count ?? 0;
  if (repliesCount > 0) {
    if (repliesCount >= 30) parts.push('have many conversations');
    else if (repliesCount >= 10) parts.push('engage in discussions');
    else parts.push('have replied to each other');
  }

  const overlapMs = features.voice?.overlapMs ?? 0;
  if (overlapMs > 0) {
    const hours = overlapMs / 3600000;
    if (hours >= 10) parts.push('spend significant time together in voice');
    else if (hours >= 2) parts.push('hang out in voice regularly');
    else if (hours >= 0.5) parts.push('have shared voice time');
    else parts.push('have been in voice together briefly');
  }

  if (parts.length === 0) return 'minimal recorded interaction';

  return parts.join(', ');
}

/**
 * Social graph expert: retrieves top relationship edges for a user.
 * Returns narrative descriptions with relationship tiers.
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
        content: 'Social context: This user is new or has no recorded relationships yet. They may be getting to know the community.',
        json: { edges: [], tier: 'none' },
        tokenEstimate: 20,
      };
    }

    const lines: string[] = [];
    for (const edge of edges) {
      const otherId = edge.userA === userId ? edge.userB : edge.userA;
      const tier = getRelationshipTier(edge.weight);
      const emoji = getRelationshipEmoji(tier);
      const narrative = formatEvidenceNarrative(edge.featuresJson);

      lines.push(`${emoji} <@${otherId}> is a "${tier}" — ${narrative}`);
    }

    // Build narrative summary
    const bestFriends = edges.filter(e => e.weight >= 0.8).length;
    const closeFriends = edges.filter(e => e.weight >= 0.6 && e.weight < 0.8).length;

    let summary = 'Social context: ';
    if (bestFriends > 0) {
      summary += `User has ${bestFriends} best friend${bestFriends > 1 ? 's' : ''} in this server. `;
    }
    if (closeFriends > 0) {
      summary += `They also have ${closeFriends} close friend${closeFriends > 1 ? 's' : ''}. `;
    }
    if (bestFriends === 0 && closeFriends === 0) {
      summary += 'User is still building deeper connections. ';
    }
    summary += '\n\nRelationships:\n' + lines.join('\n');

    let content = summary;

    // Truncate if needed
    if (content.length > maxChars) {
      content = content.slice(0, maxChars).trim() + '\n(truncated)';
    }

    return {
      name: 'SocialGraph',
      content,
      json: {
        edgeCount: edges.length,
        bestFriends,
        closeFriends,
        topEdges: edges.slice(0, 5)
      },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'SocialGraph',
      content: 'Social context: Unable to load relationship data at this time.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}

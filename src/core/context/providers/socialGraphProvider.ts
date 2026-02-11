import { getEdgesForUser } from '../../relationships/relationshipGraph';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ContextPacket } from '../context-types';

export interface RunSocialGraphProviderParams {
  guildId: string;
  userId: string;
  maxEdges?: number;
  maxChars?: number;
}

type RelationshipTier = 'Best Friend' | 'Close Friend' | 'Friend' | 'Acquaintance' | 'New Connection';

function getRelationshipTier(weight: number): RelationshipTier {
  if (weight >= 0.8) return 'Best Friend';
  if (weight >= 0.6) return 'Close Friend';
  if (weight >= 0.4) return 'Friend';
  if (weight >= 0.2) return 'Acquaintance';
  return 'New Connection';
}

function formatHours(ms: number): string {
  if (ms <= 0) return '0.0h';
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatRecency(epochMs: number | undefined, nowMs: number): string {
  if (!epochMs || epochMs <= 0) return 'unknown';
  const deltaMs = Math.max(0, nowMs - epochMs);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatSignals(features: {
  mentions?: { count?: number };
  replies?: { count?: number };
  voice?: { overlapMs?: number };
}): string {
  const mentionsCount = features.mentions?.count ?? 0;
  const repliesCount = features.replies?.count ?? 0;
  const overlapMs = features.voice?.overlapMs ?? 0;
  return `mentions=${mentionsCount}, replies=${repliesCount}, voice_overlap=${formatHours(overlapMs)}`;
}

function truncateWithEllipsis(text: string, maxChars: number): { value: string; truncated: boolean } {
  if (text.length <= maxChars) return { value: text, truncated: false };
  return {
    value: `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`,
    truncated: true,
  };
}

/**
 * Social graph provider: retrieves top relationship edges for a user.
 * Returns compact relationship signals for personalized tone calibration.
 */
export async function runSocialGraphProvider(
  params: RunSocialGraphProviderParams,
): Promise<ContextPacket> {
  const { guildId, userId, maxEdges = 10, maxChars = 1800 } = params;

  try {
    const edges = await getEdgesForUser({ guildId, userId, limit: maxEdges });
    const nowMs = Date.now();

    if (edges.length === 0) {
      return {
        name: 'SocialGraph',
        content:
          'Social graph memory: no relationship edges found for this user yet. Treat social familiarity as unknown and avoid over-personalized assumptions.',
        json: { edges: [], tier: 'none' },
        tokenEstimate: 25,
      };
    }

    const lines: string[] = [];
    for (const edge of edges) {
      const otherId = edge.userA === userId ? edge.userB : edge.userA;
      const tier = getRelationshipTier(edge.weight);
      const lastSignalAt = Math.max(
        edge.featuresJson.mentions?.lastAt ?? 0,
        edge.featuresJson.replies?.lastAt ?? 0,
        edge.featuresJson.voice?.lastAt ?? 0,
      );
      const recency = formatRecency(lastSignalAt, nowMs);
      const signals = formatSignals(edge.featuresJson);

      lines.push(
        `- <@${otherId}>: tier=${tier}, strength=${edge.weight.toFixed(2)}, confidence=${edge.confidence.toFixed(2)}, recency=${recency}, signals=${signals}`,
      );
    }

    const bestFriends = edges.filter((e) => e.weight >= 0.8).length;
    const closeFriends = edges.filter((e) => e.weight >= 0.6 && e.weight < 0.8).length;
    const friends = edges.filter((e) => e.weight >= 0.4 && e.weight < 0.6).length;

    let guidance = 'Keep tone neutral unless social cues are explicit.';
    if (bestFriends > 0 || closeFriends > 0) {
      guidance =
        'You can use a warmer, familiar tone when mentioning established relationships; avoid inventing personal details.';
    } else if (friends > 0) {
      guidance = 'Use lightly familiar tone, but keep claims conservative.';
    }

    const built = [
      'Social graph memory:',
      `- Edge count: ${edges.length}`,
      `- Tier mix: best=${bestFriends}, close=${closeFriends}, friend=${friends}`,
      `- Guidance: ${guidance}`,
      'Relationships:',
      ...lines,
    ].join('\n');
    const { value: content, truncated } = truncateWithEllipsis(built, maxChars);

    return {
      name: 'SocialGraph',
      content,
      json: {
        edgeCount: edges.length,
        bestFriends,
        closeFriends,
        friends,
        topEdges: edges.slice(0, 5).map((edge) => {
          const otherId = edge.userA === userId ? edge.userB : edge.userA;
          return {
            otherId,
            tier: getRelationshipTier(edge.weight),
            weight: edge.weight,
            confidence: edge.confidence,
            mentions: edge.featuresJson.mentions?.count ?? 0,
            replies: edge.featuresJson.replies?.count ?? 0,
            voiceOverlapMs: edge.featuresJson.voice?.overlapMs ?? 0,
          };
        }),
        truncated,
      },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'SocialGraph',
      content: 'Social graph memory: unable to load relationship data at this time.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}

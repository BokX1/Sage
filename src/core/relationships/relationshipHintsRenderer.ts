import { getTopEdges, getEdgesForUser } from './relationshipGraph';
import type { RelationshipEdge } from './relationshipEdgeRepo';

/**
 * Render relationship hints for LLM context.
 *
 * Details: combines top guild edges with user-specific edges, then formats
 * probabilistic bullets with evidence counts.
 *
 * Side effects: reads relationship data.
 * Error behavior: returns null on rendering or data failures.
 *
 * @param params - Rendering limits and optional user focus.
 * @returns Rendered hint block or null when no edges are available.
 */
export async function renderRelationshipHints(params: {
  guildId: string;
  userId?: string;
  maxEdges: number;
  maxChars: number;
}): Promise<string | null> {
  const { guildId, userId, maxEdges, maxChars } = params;

  try {
    const [topEdges, userEdges] = await Promise.all([
      getTopEdges({ guildId, limit: Math.ceil(maxEdges / 2), minWeight: 0.1 }),
      userId ? getEdgesForUser({ guildId, userId, limit: Math.ceil(maxEdges / 2) }) : [],
    ]);

    const edgeMap = new Map<string, RelationshipEdge>();
    for (const edge of [...topEdges, ...userEdges]) {
      const key = `${edge.userA}-${edge.userB}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, edge);
      }
    }

    const edges = Array.from(edgeMap.values())
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxEdges);

    if (edges.length === 0) {
      return null;
    }

    const lines: string[] = ['Relationship hints (probabilistic):'];

    for (const edge of edges) {
      const { userA, userB, weight, featuresJson } = edge;
      const f = featuresJson;

      const evidenceParts: string[] = [];
      if (f.mentions.count > 0) {
        evidenceParts.push(
          `${f.mentions.count} ${f.mentions.count === 1 ? 'mention' : 'mentions'}`,
        );
      }
      if (f.replies.count > 0) {
        evidenceParts.push(`${f.replies.count} ${f.replies.count === 1 ? 'reply' : 'replies'}`);
      }
      if (f.voice.overlapMs > 0) {
        const minutes = Math.round(f.voice.overlapMs / 60000);
        if (minutes > 0) {
          evidenceParts.push(`${minutes}m voice`);
        }
      }

      const evidence = evidenceParts.length > 0 ? evidenceParts.join(', ') : 'no recent activity';

      let strength = 'weak';
      if (weight >= 0.7) {
        strength = 'likely close';
      } else if (weight >= 0.4) {
        strength = 'moderate';
      } else if (weight >= 0.2) {
        strength = 'emerging';
      }

      const line = `- <@${userA}> ↔ <@${userB}>: ${strength} (${evidence})`;
      lines.push(line);
    }

    const result = lines.join('\n');
    if (result.length > maxChars) {
      return result.slice(0, maxChars - 3) + '...';
    }

    return result;
  } catch (_error) {
    return null;
  }
}

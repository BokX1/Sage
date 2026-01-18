import { getTopEdges, getEdgesForUser } from './relationshipGraph';
import type { RelationshipEdge } from './relationshipEdgeRepo';

/**
 * Render relationship hints for LLM context.
 * Format as probabilistic bullet points with evidence counts.
 */
export async function renderRelationshipHints(params: {
    guildId: string;
    userId?: string;
    maxEdges: number;
    maxChars: number;
}): Promise<string | null> {
    const { guildId, userId, maxEdges, maxChars } = params;

    try {
        // Fetch top edges (guild-wide) and user-specific edges
        const [topEdges, userEdges] = await Promise.all([
            getTopEdges({ guildId, limit: Math.ceil(maxEdges / 2), minWeight: 0.1 }),
            userId ? getEdgesForUser({ guildId, userId, limit: Math.ceil(maxEdges / 2) }) : [],
        ]);

        // Merge and deduplicate
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

        // Render hints
        const lines: string[] = ['Relationship hints (probabilistic):'];

        for (const edge of edges) {
            const { userA, userB, weight, featuresJson } = edge;
            const f = featuresJson;

            // Build evidence string
            const evidenceParts: string[] = [];
            if (f.mentions.count > 0) {
                evidenceParts.push(`${f.mentions.count} ${f.mentions.count === 1 ? 'mention' : 'mentions'}`);
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

            // Phrase relationship strength
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
    } catch (error) {
        // Non-fatal: return null if rendering fails
        return null;
    }
}

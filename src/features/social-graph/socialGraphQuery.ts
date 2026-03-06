import neo4j from 'neo4j-driver';
import { logger } from '../../platform/logging/logger';
import { getDunbarLabel } from './graphAnalyticsPulse';
import { createMemgraphClient } from '../../platform/social-graph/memgraphClient';

/**
 * Represents the SocialGraphEdge type.
 */
export type SocialGraphEdge = {
  userId: string;
  outgoingCount: number;
  incomingCount: number;
  dunbarLayer: number;
  dunbarLabel: string;
  reciprocity: number;
  pagerank: number;
  communityId: number | null;
  avgSentiment: number;
  interactionBreakdown: {
    mentions: number;
    replies: number;
    reacts: number;
    voiceSessions: number;
  };
  lastInteractionAt: string | null;
};

/**
 * Represents the SocialGraphSummary type.
 */
export type SocialGraphSummary = {
  userPagerank: number;
  userCommunityId: number | null;
  totalConnections: number;
  edges: SocialGraphEdge[];
};

/**
 * Represents the SocialGraphPairEdge type.
 */
export type SocialGraphPairEdge = {
  userA: string;
  userB: string;
  mentions: number;
  replies: number;
  reacts: number;
  voiceSessions: number;
  totalInteractions: number;
};

function parseFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const bounded =
      value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value;
    return Number(bounded);
  }
  if (
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    try {
      const normalized = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(normalized) ? normalized : null;
    } catch {
      return null;
    }
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function toNumber(value: unknown): number {
  return parseFiniteNumber(value) ?? 0;
}

function toNumberOrNull(value: unknown): number | null {
  return parseFiniteNumber(value);
}

function dunbarLayerFromRank(rank: number): number {
  if (rank <= 5) return 1;
  if (rank <= 15) return 2;
  if (rank <= 50) return 3;
  if (rank <= 150) return 4;
  return 5;
}

export async function querySocialGraph(
  guildId: string,
  userId: string,
  limit = 10,
): Promise<SocialGraphSummary | null> {
  const memgraph = createMemgraphClient();
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 10;

  try {
    const edgeResult = await memgraph.run(
      `
      MATCH (u:User {id: $userId})
      OPTIONAL MATCH (u)-[rOut:INTERACTED]->(otherOut:User)
      WHERE rOut.guild_id = $guildId
      WITH u, collect(DISTINCT otherOut) AS out_others
      OPTIONAL MATCH (otherIn:User)-[rIn:INTERACTED]->(u)
      WHERE rIn.guild_id = $guildId
      WITH u, out_others, collect(DISTINCT otherIn) AS in_others
      OPTIONAL MATCH (u)-[vAny:VOICE_SESSION]-(otherVoice:User)
      WHERE vAny.guild_id = $guildId
      WITH u, out_others + in_others + collect(DISTINCT otherVoice) AS raw_others
      UNWIND raw_others AS other
      WITH DISTINCT u, other
      WHERE other IS NOT NULL
      OPTIONAL MATCH (u)-[r:INTERACTED]->(other)
      WHERE r.guild_id = $guildId
      WITH u, other, count(r) AS outgoing_count,
           avg(CASE WHEN r.sentiment_score IS NOT NULL THEN r.sentiment_score ELSE 0.0 END) AS avg_sent_out
      OPTIONAL MATCH (other)-[r2:INTERACTED]->(u)
      WHERE r2.guild_id = $guildId
      WITH u, other, outgoing_count, avg_sent_out, count(r2) AS incoming_count
      OPTIONAL MATCH (u)-[m:INTERACTED {type: 'MENTION'}]->(other)
      WHERE m.guild_id = $guildId
      WITH u, other, outgoing_count, incoming_count, avg_sent_out,
           count(m) AS mention_count
      OPTIONAL MATCH (u)-[rp:INTERACTED {type: 'REPLY'}]->(other)
      WHERE rp.guild_id = $guildId
      WITH u, other, outgoing_count, incoming_count, avg_sent_out,
           mention_count, count(rp) AS reply_count
      OPTIONAL MATCH (u)-[rc:INTERACTED {type: 'REACT'}]->(other)
      WHERE rc.guild_id = $guildId
      WITH u, other, outgoing_count, incoming_count, avg_sent_out,
           mention_count, reply_count, count(rc) AS react_count
      OPTIONAL MATCH (u)-[v:VOICE_SESSION]-(other)
      WHERE v.guild_id = $guildId
      WITH u, other, outgoing_count, incoming_count, avg_sent_out,
           mention_count, reply_count, react_count,
           count(
             DISTINCT CASE
               WHEN v IS NULL THEN NULL
               ELSE coalesce(v.ts, toString(id(v)))
             END
           ) AS voice_count,
           CASE
             WHEN outgoing_count >= incoming_count AND outgoing_count > 0
               THEN toFloat(incoming_count) / toFloat(outgoing_count)
             WHEN incoming_count > 0
               THEN toFloat(outgoing_count) / toFloat(incoming_count)
             ELSE 0.0
           END AS reciprocity
      WITH u, other, outgoing_count, incoming_count, avg_sent_out,
           mention_count, reply_count, react_count, voice_count, reciprocity
      WHERE outgoing_count + incoming_count + voice_count > 0
      RETURN other.id AS other_id,
             outgoing_count, incoming_count,
             coalesce(reciprocity, 0.0) AS reciprocity,
             avg_sent_out AS avg_sentiment,
             mention_count, reply_count, react_count, voice_count
      ORDER BY outgoing_count + incoming_count + voice_count DESC
      LIMIT $limit
      `,
      { guildId, userId, limit: neo4j.int(normalizedLimit) },
    );

    if (edgeResult.records.length === 0) return null;

    const edges: SocialGraphEdge[] = [];
    for (let index = 0; index < edgeResult.records.length; index += 1) {
      const record = edgeResult.records[index];
      const otherId = record.get('other_id') as string;
      const dunbarLayer = dunbarLayerFromRank(index + 1);

      edges.push({
        userId: otherId,
        outgoingCount: toNumber(record.get('outgoing_count')),
        incomingCount: toNumber(record.get('incoming_count')),
        dunbarLayer,
        dunbarLabel: getDunbarLabel(dunbarLayer),
        reciprocity: toNumber(record.get('reciprocity')),
        pagerank: 0,
        communityId: null,
        avgSentiment: toNumber(record.get('avg_sentiment')),
        interactionBreakdown: {
          mentions: toNumber(record.get('mention_count')),
          replies: toNumber(record.get('reply_count')),
          reacts: toNumber(record.get('react_count')),
          voiceSessions: toNumber(record.get('voice_count')),
        },
        lastInteractionAt: null,
      });
    }

    const metricIds = Array.from(new Set([userId, ...edges.map((edge) => edge.userId)]));
    const metricResult = await memgraph.run(
      `
      UNWIND $userIds AS scoped_user_id
      MATCH (u:User {id: scoped_user_id})
      OPTIONAL MATCH (u)-[membership:ACTIVE_IN_GUILD]->(:Guild {id: $guildId})
      WITH
        scoped_user_id,
        collect(membership.guild_community_id) AS community_candidates,
        max(coalesce(membership.guild_pagerank, 0.0)) AS guild_pagerank
      RETURN
        scoped_user_id AS user_id,
        guild_pagerank,
        head([community_id IN community_candidates WHERE community_id IS NOT NULL]) AS guild_community_id
      `,
      { guildId, userIds: metricIds },
    );

    const guildMetricMap = new Map<string, { pagerank: number; communityId: number | null }>();
    for (const record of metricResult.records) {
      const scopedUserId = record.get('user_id');
      if (typeof scopedUserId !== 'string' || scopedUserId.length === 0) continue;

      guildMetricMap.set(scopedUserId, {
        pagerank: toNumber(record.get('guild_pagerank')),
        communityId: toNumberOrNull(record.get('guild_community_id')),
      });
    }

    const userMetric = guildMetricMap.get(userId) ?? { pagerank: 0, communityId: null };
    for (const edge of edges) {
      const edgeMetric = guildMetricMap.get(edge.userId) ?? { pagerank: 0, communityId: null };
      edge.pagerank = edgeMetric.pagerank;
      edge.communityId = edgeMetric.communityId;
    }

    if (edges.length > 0) {
      try {
        const recencyResult = await memgraph.run(
          `
          MATCH (u:User {id: $userId})-[r]-(other:User)
          WHERE other.id IN $otherIds
            AND (type(r) = 'INTERACTED' OR type(r) = 'VOICE_SESSION')
            AND r.guild_id = $guildId
          WITH other.id AS other_id, max(r.ts) AS last_ts
          RETURN other_id, last_ts
          `,
          { guildId, userId, otherIds: edges.map((e) => e.userId) },
        );

        const recencyMap = new Map<string, string>();
        for (const record of recencyResult.records) {
          const id = record.get('other_id') as string;
          const ts = record.get('last_ts');
          if (ts) recencyMap.set(id, String(ts));
        }

        for (const edge of edges) {
          edge.lastInteractionAt = recencyMap.get(edge.userId) ?? null;
        }
      } catch (error) {
        logger.debug({ error }, 'Recency query failed (non-fatal)');
      }
    }

    return {
      userPagerank: userMetric.pagerank,
      userCommunityId: userMetric.communityId,
      totalConnections: edges.length,
      edges,
    };
  } catch (error) {
    logger.warn({ error, guildId, userId }, 'Memgraph social graph query failed');
    throw error;
  } finally {
    await memgraph.close();
  }
}

export async function queryTopSocialGraphEdges(
  guildId: string,
  limit = 15,
): Promise<SocialGraphPairEdge[]> {
  const memgraph = createMemgraphClient();
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 15;

  try {
    const result = await memgraph.run(
      `
      MATCH (a:User)-[r:INTERACTED]-(b:User)
      WHERE r.guild_id = $guildId AND a.id < b.id
      WITH a, b,
           sum(CASE WHEN r.type = 'MENTION' THEN 1 ELSE 0 END) AS mention_count,
           sum(CASE WHEN r.type = 'REPLY' THEN 1 ELSE 0 END) AS reply_count,
           sum(CASE WHEN r.type = 'REACT' THEN 1 ELSE 0 END) AS react_count
      OPTIONAL MATCH (a)-[v:VOICE_SESSION]-(b)
      WHERE v.guild_id = $guildId
      WITH a, b, mention_count, reply_count, react_count,
           count(
             DISTINCT CASE
               WHEN v IS NULL THEN NULL
               ELSE coalesce(v.ts, toString(id(v)))
             END
           ) AS voice_count
      WITH a, b, mention_count, reply_count, react_count, voice_count,
           mention_count + reply_count + react_count + voice_count AS total_interactions
      WHERE total_interactions > 0
      RETURN a.id AS user_a,
             b.id AS user_b,
             mention_count,
             reply_count,
             react_count,
             voice_count,
             total_interactions
      ORDER BY total_interactions DESC
      LIMIT $limit
      `,
      { guildId, limit: neo4j.int(normalizedLimit) },
    );

    return result.records.map((record) => ({
      userA: String(record.get('user_a')),
      userB: String(record.get('user_b')),
      mentions: toNumber(record.get('mention_count')),
      replies: toNumber(record.get('reply_count')),
      reacts: toNumber(record.get('react_count')),
      voiceSessions: toNumber(record.get('voice_count')),
      totalInteractions: toNumber(record.get('total_interactions')),
    }));
  } catch (error) {
    logger.warn({ error, guildId }, 'Memgraph top social-graph query failed');
    throw error;
  } finally {
    await memgraph.close();
  }
}

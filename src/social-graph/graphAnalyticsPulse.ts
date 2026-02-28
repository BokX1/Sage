import { logger } from '../core/utils/logger';
import { createMemgraphClient } from './memgraphClient';

const DUNBAR_LAYERS = [
  { maxRank: 5, layer: 1, label: 'intimate' },
  { maxRank: 15, layer: 2, label: 'close' },
  { maxRank: 50, layer: 3, label: 'active' },
  { maxRank: 150, layer: 4, label: 'acquaintance' },
] as const;

export async function runGraphAnalyticsPulse(): Promise<void> {
  const startMs = Date.now();
  const memgraph = createMemgraphClient();

  try {
    const countResult = await memgraph.run('MATCH (g:Guild) RETURN count(g) AS c');
    const guildCount = countResult.records[0]?.get('c')?.toNumber?.() ?? countResult.records[0]?.get('c') ?? 0;

    if (typeof guildCount === 'number' && guildCount === 0) {
      logger.info('Social graph analytics pulse: no guilds in graph, skipping');
      return;
    }

    logger.info({ guildCount }, 'Social graph analytics pulse starting');

    // Compute guild-scoped influence metrics on ACTIVE_IN_GUILD relationships.
    try {
      await memgraph.run(`
        MATCH (g:Guild)
        MATCH (u:User)-[active:ACTIVE_IN_GUILD]->(g)
        OPTIONAL MATCH (u)-[rOut:INTERACTED]->(:User)
        WHERE rOut.guild_id = g.id
        WITH g, u, active, count(rOut) AS out_count
        OPTIONAL MATCH (:User)-[rIn:INTERACTED]->(u)
        WHERE rIn.guild_id = g.id
        WITH g, u, active, out_count, count(rIn) AS in_count
        OPTIONAL MATCH (u)-[v:VOICE_SESSION]-(voice_peer:User)
        WHERE v.guild_id = g.id
        WITH g, u, active, out_count, in_count,
             count(
               DISTINCT CASE
                 WHEN v IS NULL THEN NULL
                 ELSE coalesce(toString(v.ts), toString(id(v))) + ':' + coalesce(voice_peer.id, '')
               END
             ) AS voice_count
        SET active.guild_activity = out_count + in_count + voice_count,
            active.guild_metrics_updated_at = datetime()
      `);

      await memgraph.run(`
        MATCH (g:Guild)
        MATCH (:User)-[active:ACTIVE_IN_GUILD]->(g)
        WITH g, max(coalesce(active.guild_activity, 0)) AS max_activity
        MATCH (:User)-[active:ACTIVE_IN_GUILD]->(g)
        SET active.guild_pagerank =
          CASE
            WHEN max_activity > 0
              THEN toFloat(coalesce(active.guild_activity, 0)) / toFloat(max_activity)
            ELSE 0.0
          END
      `);

      // Community IDs are intentionally omitted until guild-partitioned detection is available.
      await memgraph.run(`
        MATCH (:User)-[active:ACTIVE_IN_GUILD]->(:Guild)
        REMOVE active.guild_community_id
      `);

      logger.info('Guild-scoped influence metrics computed on :ACTIVE_IN_GUILD');
    } catch (error) {
      logger.warn({ error }, 'Guild-scoped influence computation failed');
    }

    // Guild-scoped Dunbar layer assignment.
    try {
      await memgraph.run(`
        MATCH (g:Guild)
        MATCH (u:User)-[r:INTERACTED]->(other:User)
        WHERE r.guild_id = g.id
        WITH g, u, other, count(r) AS interaction_count
        ORDER BY g.id, u.id, interaction_count DESC
        WITH g, u, collect({other: other, cnt: interaction_count}) AS ranked_connections
        WHERE size(ranked_connections) > 0
        UNWIND range(0, size(ranked_connections) - 1) AS idx
        WITH g, u,
             ranked_connections[idx].other AS other,
             ranked_connections[idx].cnt AS interaction_count,
             idx + 1 AS rank
        MERGE (u)-[k:KNOWS {guild_id: g.id}]->(other)
        SET k.interaction_rank = rank,
            k.interaction_count = interaction_count,
            k.dunbar_layer = CASE
              WHEN rank <= 5 THEN 1
              WHEN rank <= 15 THEN 2
              WHEN rank <= 50 THEN 3
              WHEN rank <= 150 THEN 4
              ELSE 5
            END
      `);
      logger.info('Guild-scoped Dunbar layers computed on :KNOWS edges');
    } catch (error) {
      logger.warn({ error }, 'Guild-scoped Dunbar layer assignment failed');
    }

    // Guild-scoped reciprocity on KNOWS edges.
    try {
      await memgraph.run(`
        MATCH (g:Guild)
        MATCH (a:User)-[r1:INTERACTED]->(b:User)
        WHERE r1.guild_id = g.id
        WITH g, a, b, count(r1) AS count_ab
        OPTIONAL MATCH (b)-[r2:INTERACTED]->(a)
        WHERE r2.guild_id = g.id
        WITH g, a, b, count_ab, count(r2) AS count_ba
        WHERE count_ab > 0
        WITH g, a, b, count_ab, count_ba,
             CASE WHEN count_ab > count_ba THEN count_ab ELSE count_ba END AS max_count,
             CASE WHEN count_ab < count_ba THEN count_ab ELSE count_ba END AS min_count
        MERGE (a)-[k:KNOWS {guild_id: g.id}]->(b)
        SET k.reciprocity = CASE WHEN max_count > 0 THEN toFloat(min_count) / max_count ELSE 0.0 END,
            k.outgoing_count = count_ab,
            k.incoming_count = count_ba
      `);
      logger.info('Guild-scoped reciprocity computed on :KNOWS edges');
    } catch (error) {
      logger.warn({ error }, 'Guild-scoped reciprocity computation failed');
    }

    const elapsedMs = Date.now() - startMs;
    logger.info({ elapsedMs, guildCount }, 'Social graph analytics pulse completed');
  } catch (error) {
    logger.error({ error }, 'Social graph analytics pulse failed');
  } finally {
    await memgraph.close();
  }
}

export function getDunbarLabel(layer: number): string {
  const found = DUNBAR_LAYERS.find((d) => d.layer === layer);
  return found?.label ?? 'distant';
}

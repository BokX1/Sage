# 🛠️ Social Graph Setup

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Social%20Graph%20Setup-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Social Graph Setup" />
</p>

Operational guide for deploying and managing the Memgraph + Redpanda social graph infrastructure.

---

## 🧭 Quick navigation

- [Start infrastructure](#1-start-infrastructure)
- [Configure environment](#2-configure-environment)
- [Create topics and streams](#3-create-topics-and-streams)
- [Verify](#4-verify)
- [Run GNN modules](#5-run-gnn-modules)
- [Historical migration](#6-historical-migration)
- [Troubleshooting](#7-troubleshooting)

---

## 1. Start infrastructure

```powershell
docker compose -f docker-compose.social-graph.yml up -d
Start-Sleep -Seconds 5
```

| Service | URL | Purpose |
| :--- | :--- | :--- |
| Memgraph Lab | `http://localhost:7444` | Graph visualization and Cypher console |
| Redpanda Console | `http://localhost:8080` | Kafka topic monitoring |

---

## 2. Configure environment

Add to `.env`:

```env
MEMGRAPH_HOST=localhost
MEMGRAPH_PORT=7687
MEMGRAPH_USER=
MEMGRAPH_PASSWORD=
MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS=redpanda:9092

KAFKA_BROKERS=localhost:19092
KAFKA_INTERACTIONS_TOPIC=sage.social.interactions
KAFKA_VOICE_TOPIC=sage.social.voice-sessions
```

> [!TIP]
> Set `KAFKA_BROKERS=` (empty) to disable social graph export entirely.

---

## 3. Create topics and streams

```powershell
npm run social-graph:setup
```

This idempotently creates:

- Kafka topics (`sage.social.interactions`, `sage.social.voice-sessions`)
- Memgraph indexes (`:User(id)`, `:Channel(id)`)
- Memgraph Kafka streams and starts them

---

## 4. Verify

Run the bot (`npm run dev`), then verify in Memgraph Lab:

```cypher
SHOW STREAMS;
MATCH (:User)-[r:INTERACTED]->(:User) RETURN r.type, count(*) ORDER BY count(*) DESC;
MATCH (:User)-[r:VOICE_SESSION]->(:User) RETURN count(r);
```

Verify MAGE modules are loaded:

```cypher
CALL mg.procedures() YIELD name WHERE name STARTS WITH 'tgn_memory' OR name STARTS WITH 'hyperbolic' RETURN name;
```

---

## 5. Run GNN modules

The analytics pulse runs automatically on schedule via `graphAnalyticsPulse.ts`. To trigger GNN modules manually:

```cypher
CALL tgn_memory.batch_update_memories(100) YIELD updated_count, elapsed_ms;
CALL hyperbolic.batch_embed(100) YIELD updated_count, elapsed_ms;
CALL het_attention.batch_compute(100) YIELD updated_count, elapsed_ms;
CALL graph_transformer.compute_global_attention(100) YIELD updated_count, elapsed_ms;
CALL cold_start.compute_archetypes(50) YIELD archetype_count, elapsed_ms;
```

### Per-user queries

```cypher
CALL hyperbolic.compute_distance('user-a', 'user-b')
YIELD distance, a_origin_dist, b_origin_dist;

CALL graph_transformer.get_cross_clique_influence('user-a', 'user-b')
YIELD influence_score, shared_attention_heads;

CALL cold_start.bootstrap_user('new-user-id',
  365.0, 7.0, false, true, false, 3, 2.0, 12)
YIELD representation, confidence, matched_archetype, is_cold_start;
```

---

## 6. Historical migration

To warm the graph with pre-existing PostgreSQL relationship data:

```powershell
npx ts-node -P config/tooling/tsconfig.app.json src/social-graph/migratePostgresToMemgraph.ts
```

This reads all `RelationshipEdge` rows from PostgreSQL and publishes synthetic interaction events through the normal Kafka pipeline.

---

## 7. Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Streams stuck at 0 messages | Check `MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS` points to the Docker-internal broker (`redpanda:9092`) |
| `kafkajs` import fails | Run `npm install kafkajs` — it's an optional peer dependency |
| MAGE modules not found | Verify Docker volume mounts in `docker-compose.social-graph.yml` |
| PyTorch errors in MAGE | Ensure you're using `memgraph/memgraph-mage` (not plain `memgraph/memgraph`) |
| Bot publishes but graph empty | Check `KAFKA_BROKERS` uses the host-facing port (`localhost:19092`) |

---

## 🔗 Related Documentation

- [🕸️ Social Graph Architecture](../architecture/SOCIAL_GRAPH.md) — How the GNN pipeline works
- [🚀 Deployment Guide](DEPLOYMENT.md) — General production deployment
- [🧰 Self-Hosted Tool Stack](TOOL_STACK.md) — SearXNG, Crawl4AI, Tika

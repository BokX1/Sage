# 🛠️ Social Graph Setup

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Social%20Graph%20Setup-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Social Graph Setup" />
</p>

Operational guide for deploying and managing the optional Memgraph + Redpanda social-graph stack.

---

## 🧭 Quick navigation

- [Start infrastructure](#1-start-infrastructure)
- [Configure environment](#2-configure-environment)
- [Create topics and streams](#3-create-topics-and-streams)
- [Verify](#4-verify)
- [Run analytics and GNN modules](#5-run-analytics-and-gnn-modules)
- [Historical migration](#6-historical-migration)
- [Troubleshooting](#7-troubleshooting)

---

## 1. Start infrastructure

```powershell
docker compose -f config/services/self-host/docker-compose.social-graph.yml up -d
Start-Sleep -Seconds 5
```

| Service | URL | Purpose |
| :--- | :--- | :--- |
| Memgraph Lab | `http://localhost:7444` | Graph visualization and Cypher console |
| Redpanda Console | `http://localhost:8080` | Kafka topic monitoring |

---

## 2. Configure environment

Add or confirm these values in `.env`:

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
> Set `KAFKA_BROKERS=` (empty) to disable social-graph export entirely.

---

## 3. Create topics and streams

```powershell
npm run social-graph:setup
```

This idempotently creates:

- Kafka topics (`sage.social.interactions`, `sage.social.voice-sessions`)
- Memgraph indexes (`:User(id)`, `:Channel(id)`)
- Memgraph Kafka streams and starts them

`npm run social-graph:setup` expects `KAFKA_BROKERS` to be configured. The repo already includes `kafkajs` as a normal runtime dependency; no extra package install is required.

---

## 4. Verify

Run Sage (`npm run dev` or `npm start`), then verify in Memgraph Lab:

```cypher
SHOW STREAMS;
MATCH (:User)-[r:INTERACTED]->(:User) RETURN r.type, count(*) ORDER BY count(*) DESC;
MATCH (:User)-[r:VOICE_SESSION]->(:User) RETURN count(r);
```

Verify MAGE modules are available:

```cypher
CALL mg.procedures() YIELD name
WHERE name STARTS WITH 'tgn_memory'
   OR name STARTS WITH 'hyperbolic'
   OR name STARTS WITH 'het_attention'
   OR name STARTS WITH 'graph_transformer'
   OR name STARTS WITH 'cold_start'
RETURN name;
```

---

## 5. Run analytics and GNN modules

The repo ships `src/cli/social-graph/graphAnalyticsPulse.ts`, but Sage does **not** schedule it automatically.

What that means in practice:

- `npm run social-graph:setup` only provisions topics, streams, and indexes
- the main Sage runtime exports events and can query Memgraph immediately
- PageRank, Dunbar, and reciprocity refreshes require you to run or schedule the analytics pulse yourself

Manual Memgraph procedure examples:

```cypher
CALL tgn_memory.batch_update_memories(100) YIELD updated_count, elapsed_ms;
CALL hyperbolic.batch_embed(100) YIELD updated_count, elapsed_ms;
CALL het_attention.batch_compute(100) YIELD updated_count, elapsed_ms;
CALL graph_transformer.compute_global_attention(100) YIELD updated_count, elapsed_ms;
CALL cold_start.compute_archetypes(50) YIELD archetype_count, elapsed_ms;
```

If you want periodic analytics, wrap `runGraphAnalyticsPulse()` in your own scheduler or task runner. There is no tracked npm script that starts it for you today.

---

## 6. Historical migration

To warm the graph with pre-existing PostgreSQL relationship data:

```powershell
npx ts-node -P config/tooling/tsconfig.app.json src/cli/social-graph/migratePostgresToMemgraph.ts
```

This reads `RelationshipEdge` rows from PostgreSQL and publishes synthetic interaction events through the same Kafka pipeline used by the live runtime.

---

## 7. Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Streams stuck at 0 messages | Check `MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS` points to the Docker-internal broker (`redpanda:9092`) |
| Sage logs say Kafka producer unavailable | Verify `KAFKA_BROKERS` points at the host-facing broker (`localhost:19092`) and Redpanda is reachable |
| MAGE modules not found | Verify the image and volume mounts in `config/services/self-host/docker-compose.social-graph.yml` |
| PyTorch errors in MAGE | Use the Memgraph image bundled for MAGE support, not a plain Memgraph image |
| Bot publishes but graph stays empty | Re-run `npm run social-graph:setup` and inspect `SHOW STREAMS;` in Memgraph Lab |

---

## 🔗 Related Documentation

- [🕸️ Social Graph Architecture](../architecture/SOCIAL_GRAPH.md) — Runtime design and analytics behavior
- [🚀 Deployment Guide](DEPLOYMENT.md) — General production deployment
- [🧰 Self-Hosted Tool Stack](TOOL_STACK.md) — SearXNG, Crawl4AI, and Tika

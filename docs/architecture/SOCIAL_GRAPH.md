# 🕸️ Social Graph

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Social%20Graph-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Social Graph" />
</p>

How Sage builds and queries a real-time relationship graph from Discord interactions.

---

## 🧭 Quick navigation

- [Overview](#-overview)
- [Architecture](#️-architecture)
- [GNN Pipeline](#-gnn-pipeline)
- [Key Components](#-key-components)
- [Data Flow](#-data-flow)
- [Configuration](#️-configuration)
- [Related Documentation](#-related-documentation)

---

## 🌐 Overview

Sage streams every mention, reply, reaction, and voice session into a **Memgraph** graph database via **Redpanda** (Kafka-compatible). A 9-pillar GNN pipeline runs inside Memgraph (via MAGE modules) to produce per-user representations that capture trust, influence, hierarchy, and emotional tone — all queryable in real-time from any Sage tool call.

| Capability | What it tells Sage |
| :--- | :--- |
| **PageRank** | Who is influential in this server |
| **Community Detection** | Which cliques/sub-groups exist |
| **Dunbar Layers** | How close two users really are (intimate → distant) |
| **Reciprocity Index** | Is this relationship mutual or one-sided |
| **Temporal Memory** | How interaction patterns evolve over time |
| **Hyperbolic Embeddings** | Hierarchical proximity on a Poincaré disk |
| **Heterogeneous Attention** | Which interaction type matters most per user |
| **Cross-Clique Influence** | Structural influence between users who never interact directly |
| **Cold-Start Bootstrap** | Meaningful representation for brand-new users |

---

## 🏗️ Architecture

```mermaid
flowchart TD
    classDef discord fill:#5865f2,stroke:#333,color:white
    classDef kafka fill:#e8453c,stroke:#333,color:white
    classDef network fill:#e8f5e9,stroke:#333,color:black
    classDef gnn fill:#fff3cd,stroke:#333,color:black
    classDef output fill:#e3f2fd,stroke:#333,color:black

    M[Message Events]:::discord --> KP[Kafka Producer]:::kafka
    R[Reaction Events]:::discord --> KP
    V[Voice Sessions]:::discord --> KP

    KP --> RP[Redpanda]:::kafka

    RP --> |social_interactions| MG[Memgraph]:::network
    RP --> |voice_sessions| MG

    MG --> MAGE["MAGE GNN Modules"]:::gnn

    MAGE --> TGN["Temporal Memory (GRU)"]:::gnn
    MAGE --> HYP["Hyperbolic Embeddings"]:::gnn
    MAGE --> HET["Het. Attention"]:::gnn
    MAGE --> GT["Graph Transformer"]:::gnn
    MAGE --> CS["Cold-Start Bootstrap"]:::gnn

    MG --> AP["Analytics Pulse"]:::output
    AP --> PR["PageRank + Communities"]:::output
    AP --> DL["Dunbar Layers"]:::output
    AP --> RI["Reciprocity Index"]:::output

    MG --> SQ["Social Graph Query"]:::output
    SQ --> LLM["Sage LLM Context"]:::output
```

---

## 🧠 GNN Pipeline

Nine pillars produce a rich, learnable representation for every user in the graph.

### MAGE Modules (Python / PyTorch)

| # | Module | Cypher Namespace | What it does |
| :--- | :--- | :--- | :--- |
| 1 | `tgn_memory.py` | `tgn_memory.*` | GRU-based temporal memory — learns optimal decay from interaction sequences |
| 2 | `hyperbolic.py` | `hyperbolic.*` | Poincaré disk embeddings — leaders cluster at center, lurkers orbit boundary |
| 3 | `het_attention.py` | `het_attention.*` | Per-type attention heads (mention vs reply vs react vs voice) |
| 4 | `graph_transformer.py` | `graph_transformer.*` | Global self-attention — detects cross-clique influence |
| 8 | `cold_start.py` | `cold_start.*` | Metadata + neighbor induction for users with < 3 interactions |

### TypeScript Analytics (Node.js)

| # | Pillar | Implemented in | What it does |
| :--- | :--- | :--- | :--- |
| 5 | Emotional Contagion | `emojiSentiment.ts` | Emoji → valence scoring for signed edges |
| 6 | Dunbar Layers | `graphAnalyticsPulse.ts` | Rank-based tier assignment (5 → 15 → 50 → 150) |
| 7 | Reciprocity Index | `graphAnalyticsPulse.ts` | min(A→B, B→A) / max(A→B, B→A) per edge pair |
| 9 | Signed Networks | `emojiSentiment.ts` | Positive / negative / neutral edge classification |

---

## 📦 Key Components

| Component | File | Purpose |
| :--- | :--- | :--- |
| Kafka Producer | `kafkaProducer.ts` | Publishes interaction and voice events to Redpanda |
| Stream Transforms | `custom.py` | MAGE module that ingests Kafka messages into graph nodes/edges |
| Analytics Pulse | `graphAnalyticsPulse.ts` | Scheduled job: PageRank, community detection, Dunbar, reciprocity |
| Social Graph Query | `socialGraphQuery.ts` | Memgraph-backed reader used by `lookupSocialGraph` tool |
| Emoji Sentiment | `emojiSentiment.ts` | Valence lookup for reaction scoring |
| Setup Script | `setupSocialGraph.ts` | Creates Kafka topics, Memgraph indexes, and streams |
| Migration | `migratePostgresToMemgraph.ts` | One-time bootstrap from historical PostgreSQL data |
| Memgraph Client | `memgraphClient.ts` | Thin Bolt driver wrapper |

---

## 🔀 Data Flow

### Interaction Lifecycle

```mermaid
sequenceDiagram
    participant D as Discord
    participant B as Sage Bot
    participant K as Redpanda (Kafka)
    participant M as Memgraph
    participant G as MAGE GNN

    D->>B: User mentions @someone
    B->>K: publishInteraction({type: MENTION, ...})
    K->>M: Stream transform → MERGE :User, CREATE :INTERACTED
    Note over M: Graph updated in real-time

    rect rgb(255, 243, 205)
        Note over M,G: Scheduled Analytics Pulse (every ~6h)
        M->>M: PageRank + Louvain communities
        M->>M: Dunbar layer assignment
        M->>M: Reciprocity index
        M->>G: batch TGN + hyperbolic + attention + transformer
    end

    B->>M: lookupSocialGraph(userId)
    M->>B: edges + pagerank + dunbar + sentiment + reciprocity
    B->>D: Context-aware response
```

---

## ⚙️ Configuration

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MEMGRAPH_HOST` | Memgraph hostname | `localhost` |
| `MEMGRAPH_PORT` | Bolt protocol port | `7687` |
| `MEMGRAPH_USER` | Auth username (empty = no auth) | *(empty)* |
| `MEMGRAPH_PASSWORD` | Auth password | *(empty)* |
| `MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS` | Kafka brokers as seen by Memgraph (Docker internal) | `redpanda:9092` |
| `KAFKA_BROKERS` | Kafka brokers as seen by the bot process (host) | `localhost:19092` |
| `KAFKA_INTERACTIONS_TOPIC` | Topic for mentions, replies, reactions | `sage.social.interactions` |
| `KAFKA_VOICE_TOPIC` | Topic for voice session events | `sage.social.voice-sessions` |

> [!TIP]
> Set `KAFKA_BROKERS=` (empty) to completely disable social graph export without removing any code.

---

## 🔗 Related Documentation

- [🛠️ Social Graph Setup](../operations/SOCIAL_GRAPH_SETUP.md) — Docker, topics, streams, verification, migration
- [🧠 Memory System](MEMORY.md) — How social graph context enters the LLM prompt
- [🎤 Voice System](VOICE.md) — Voice presence tracking that feeds into the social graph
- [📋 Operations Runbook](../operations/RUNBOOK.md) — Production monitoring and maintenance

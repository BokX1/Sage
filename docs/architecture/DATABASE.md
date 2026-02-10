# 💾 Sage Database Architecture

Sage uses **PostgreSQL** (via Prisma) to persist memory, social state, voice activity, and runtime traces.

> [!NOTE]
> The ERD below is a simplified orientation map. `prisma/schema.prisma` is the authoritative schema.

---

## 🧭 Quick navigation

- [Entity Relationship Diagram (ERD)](#entity-relationship-diagram-erd)
- [Core tables](#core-tables)

---

<a id="entity-relationship-diagram-erd"></a>

## Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    %% Simplified logical ERD based on prisma/schema.prisma
    GuildSettings {
        string guildId PK
        string pollinationsApiKey
        datetime createdAt
        datetime updatedAt
    }

    UserProfile {
        string userId PK
        string summary
        string pollinationsApiKey
        datetime createdAt
        datetime updatedAt
    }

    ChannelMessage {
        string messageId PK
        string guildId
        string channelId
        string authorId
        datetime timestamp
        string content
    }

    ChannelSummary {
        string id PK
        string guildId
        string channelId
        string kind
        datetime windowStart
        datetime windowEnd
        string summaryText
        datetime updatedAt
    }

    RelationshipEdge {
        string id PK
        string guildId
        string userA
        string userB
        float weight
        float confidence
    }

    VoiceSession {
        string id PK
        string guildId
        string channelId
        string userId
        datetime startedAt
        datetime endedAt
    }

    AdminAudit {
        string id PK
        string guildId
        string adminId
        string command
        string paramsHash
        datetime createdAt
    }

    AgentTrace {
        string id PK
        string guildId
        string channelId
        string userId
        string routeKind
        json routerJson
        json expertsJson
        json agentGraphJson
        json agentEventsJson
        json budgetJson
        datetime createdAt
    }

    AgentRun {
        string id PK
        string traceId
        string nodeId
        string agent
        string status
        int attempts
        datetime startedAt
        datetime finishedAt
    }

    AgentTrace ||--o{ AgentRun : "traceId"
    UserProfile ||--o{ VoiceSession : "userId (logical)"
    UserProfile ||--o{ ChannelMessage : "authorId (logical)"
    UserProfile ||--o{ RelationshipEdge : "userA/userB (logical)"
```

---

<a id="core-tables"></a>

## Core tables

| Table | Purpose |
| :--- | :--- |
| `GuildSettings` | Per-guild configuration and encrypted BYOP key references. |
| `UserProfile` | Long-term user summary memory and optional user-scoped key. |
| `ChannelMessage` | Stored message transcript rows (when DB storage is enabled). |
| `ChannelSummary` | Rolling and profile summary snapshots per channel. |
| `RelationshipEdge` | Weighted social links derived from interactions. |
| `VoiceSession` | Voice join/leave duration history. |
| `AdminAudit` | Audit trail for privileged command usage. |
| `AgentTrace` | Per-turn runtime trace payload (route, context metadata, events, quality, budget). |
| `AgentRun` | Per-node execution telemetry tied to an `AgentTrace`. |

Notes:

- `AgentTrace.expertsJson` is a legacy field name retained for compatibility; it stores context packet/action metadata in the current architecture.
- Most "relationships" in the ERD are logical (by matching ids), not strict Prisma FK constraints.

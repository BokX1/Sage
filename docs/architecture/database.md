# 💾 Sage Database Architecture

Sage uses **PostgreSQL** (via Prisma) to persist long-term memory, social relationships, and processing traces.

> [!NOTE]
> The ERD below is a simplified overview intended for orientation. The schema in `prisma/schema.prisma` is the authoritative reference.

---

## 🧭 Quick navigation

- [Entity Relationship Diagram (ERD)](#entity-relationship-diagram-erd)
- [Core tables](#core-tables)

---

## Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    %% Simplified ERD (see prisma/schema.prisma for the authoritative schema)
    GuildSettings {
        string guildId PK
        json settings
    }

    UserProfile {
        string id PK
        json facts
        string persona
    }

    RelationshipEdge {
        string sourceId FK
        string targetId FK
        float weight
    }

    ChannelMessage {
        string messageId PK
        string authorId
        string content
    }

    ChannelSummary {
        string id PK
        string channelId
        json summary
    }

    VoiceSession {
        string id PK
        datetime joinedAt
        datetime leftAt
    }

    AgentTrace {
        string id PK
        json routerJson
        json toolJson
    }

    GuildSettings ||--o{ UserProfile : "scopes"
    GuildSettings ||--o{ ChannelSummary : "contains"

    UserProfile ||--o{ VoiceSession : "participates"
    UserProfile ||--o{ ChannelMessage : "sends (logical)"

    RelationshipEdge }o--|| UserProfile : "source"
    RelationshipEdge }o--|| UserProfile : "target"
```

---

## Core tables

| Table | Purpose |
| :--- | :--- |
| `UserProfile` | Stores agentic personalities and user preferences. |
| `RelationshipEdge` | Stores social interaction weights and tiers. |
| `AgentTrace` | Stores LLM reasoning and routing decisions for audit. |
| `ChannelSummary` | Stores long-term and rolling conversation recaps. |
| `VoiceSession` | Stores presence history for voice awareness. |
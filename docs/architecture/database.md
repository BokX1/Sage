# Sage Database Architecture

Sage uses **PostgreSQL** (via Prisma) to persist its long-term memory, social relationships, and processing traces.

## Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    %% Entities
    UserProfile {
        string id PK
        json facts
        string persona
    }
    
    VoiceSession {
        string id PK
        datetime joinedAt
        datetime leftAt
    }
    
    RelationshipEdge {
        string sourceId FK
        string targetId FK
        float weight
    }

    UserProfile ||--o{ VoiceSession : "Participates"
    UserProfile ||--o{ Message : "Sends"
    
    GuildSettings ||--o{ UserProfile : "Scoped to"
    GuildSettings ||--o{ ChannelSummary : "Contains"
    
    RelationshipEdge }o--|| UserProfile : "Source"
    RelationshipEdge }o--|| UserProfile : "Target"
    
    AgentTrace ||--o{ ToolCall : "Executes"
```

## Core Tables

| Table | Purpose |
| :--- | :--- |
| `UserProfile` | Stores agentic personalities and user preferences. |
| `RelationshipEdge` | Stores social interaction weights and tiers. |
| `AgentTrace` | Stores LLM reasoning and routing decisions for audit. |
| `ChannelSummary` | Stores long-term and rolling conversation recaps. |
| `VoiceSession` | Stores presence history for voice awareness. |

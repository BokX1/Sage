# Sage Database Architecture

Sage uses **PostgreSQL** (via Prisma) to persist its long-term memory, social relationships, and processing traces.

## Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    UserProfile ||--o{ RelationshipEdge : "User A or B"
    UserProfile ||--o{ VoiceSession : "Participates"
    UserProfile ||--o{ AgentTrace : "Initiator"
    
    GuildSettings ||--o{ ChannelMessage : "Contains"
    GuildSettings ||--o{ ChannelSummary : "Contains"
    GuildSettings ||--o{ RelationshipEdge : "Scoping"
    GuildSettings ||--o{ VoiceSession : "Scoping"
    
    ChannelMessage ||--o{ ChannelSummary : "Summarized into"
    
    UserProfile {
        string userId PK
        string summary
        string pollinationsApiKey
        datetime updatedAt
    }

    GuildSettings {
        string guildId PK
        string pollinationsApiKey
        datetime updatedAt
    }

    ChannelMessage {
        string messageId PK
        string channelId
        string authorId
        string content
        datetime timestamp
    }

    ChannelSummary {
        string id PK
        string channelId
        string kind
        string summaryText
        json topics
    }

    RelationshipEdge {
        string id PK
        string userA
        string userB
        float weight
        float confidence
    }

    AgentTrace {
        string id PK
        string routeKind
        string reasoningText
        string replyText
        datetime createdAt
    }
```

## Core Tables

| Table | Purpose |
| :--- | :--- |
| `UserProfile` | Stores agentic personalities and user preferences. |
| `RelationshipEdge` | Stores social interaction weights and tiers. |
| `AgentTrace` | Stores LLM reasoning and routing decisions for audit. |
| `ChannelSummary` | Stores long-term and rolling conversation recaps. |
| `VoiceSession` | Stores presence history for voice awareness. |

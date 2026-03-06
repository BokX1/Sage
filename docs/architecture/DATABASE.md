# 💾 Database Schema

Sage uses PostgreSQL with Prisma ORM. The current Prisma schema defines 17 models; this document covers the active tables, relationships, and common query patterns.

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Database-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Database" />
  <img src="https://img.shields.io/badge/ORM-Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/DB-PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
</p>

---

## 🧭 Quick Navigation

- [Entity Relationship Diagram](#entity-relationship-diagram)
- [Core Tables](#core-tables)
- [Memory & Context Tables](#memory--context-tables)
- [Embeddings & Search Tables](#embeddings--search-tables)
- [Telemetry Tables](#telemetry-tables)
- [Admin & Operations Tables](#admin--operations-tables)
- [Common Operations](#common-operations)
- [Related Documentation](#related-documentation)

---

<a id="entity-relationship-diagram"></a>

## 📊 Entity Relationship Diagram

> [!NOTE]
> The ERD below is abbreviated to the core entities most readers need first. The later sections cover the full 17-model schema.

```mermaid
erDiagram
    UserProfile ||--o{ UserProfileArchive : "archives"
    ChannelMessage ||--o| ChannelMessageEmbedding : "embedding"
    IngestedAttachment ||--o{ AttachmentChunk : "chunks"

    UserProfile {
        string userId PK
        string summary
        string pollinationsApiKey
        datetime updatedAt
        datetime createdAt
    }

    UserProfileArchive {
        string id PK
        string userId FK
        text summary
        datetime createdAt
    }

    GuildSettings {
        string guildId PK
        string pollinationsApiKey
        datetime updatedAt
    }

    GuildMemory {
        string guildId PK
        text memoryText
        int version
        string updatedByAdminId
    }

    GuildMemoryArchive {
        string id PK
        string guildId
        int version
        text memoryText
    }

    ChannelMessage {
        string messageId PK
        string guildId
        string channelId
        string authorId
        string content
        datetime timestamp
    }

    ChannelSummary {
        string id PK
        string guildId
        string channelId
        string kind
        text summaryText
    }

    VoiceSession {
        string id PK
        string guildId
        string channelId
        string userId
        datetime startedAt
        datetime endedAt
    }

    VoiceConversationSummary {
        string id PK
        string guildId
        string voiceChannelId
        string initiatedByUserId
        datetime startedAt
        datetime endedAt
        text summaryText
    }

    RelationshipEdge {
        string id PK
        string guildId
        string userA
        string userB
        float weight
        float confidence
    }

    AgentTrace {
        string id PK
        string guildId
        string channelId
        string userId
        string routeKind
        text replyText
    }
```

---

<a id="core-tables"></a>

## 🗂️ Core Tables

### `UserProfile`

Long-term personalization summary per user.

| Column | Type | Notes |
|:---|:---|:---|
| `userId` | `String` (PK) | Discord user ID |
| `summary` | `String` | LLM-generated profile narrative |
| `pollinationsApiKey` | `String?` | User-level BYOP key (optional) |
| `updatedAt` / `createdAt` | `DateTime` | Auto-managed timestamps |

### `UserProfileArchive`

Versioned snapshots of user profiles before compaction overwrites.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `userId` | `String` (FK → `UserProfile`) | Cascade delete |
| `summary` | `Text` | Archived profile text |
| `createdAt` | `DateTime` | Snapshot timestamp |

### `GuildSettings`

Per-guild configuration including server-wide BYOP key.

| Column | Type | Notes |
|:---|:---|:---|
| `guildId` | `String` (PK) | Discord guild ID |
| `pollinationsApiKey` | `String?` | Guild BYOP key (set via `/sage key set`) |

### `GuildMemory`

Admin-authored server memory text available to the bot.

| Column | Type | Notes |
|:---|:---|:---|
| `guildId` | `String` (PK) | One memory per guild |
| `memoryText` | `Text` | Operator-defined persona/rules |
| `version` | `Int` | Monotonically increasing |
| `updatedByAdminId` | `String?` | Discord ID of last admin editor |

### `GuildMemoryArchive`

Historical snapshots of server memory before updates.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `guildId` / `version` | `String` / `Int` | Indexed by `[guildId, createdAt]` |
| `memoryText` | `Text` | Archived memory text |

---

<a id="memory--context-tables"></a>

## 🧠 Memory & Context Tables

### `ChannelMessage`

Raw Discord message storage for transcript context.

| Column | Type | Notes |
|:---|:---|:---|
| `messageId` | `String` (PK) | Discord message ID |
| `guildId` / `channelId` | `String` | Channel location |
| `authorId` / `authorDisplayName` | `String` | Message author |
| `authorIsBot` | `Boolean` | Bot message flag |
| `content` | `Text` | Message body |
| `timestamp` | `DateTime` | Message timestamp |
| `replyToMessageId` | `String?` | Thread/reply reference |
| `mentionsUserIds` | `Json` | Array of mentioned user IDs |
| `mentionsBot` | `Boolean` | Whether bot was mentioned |

Indexed: `[guildId, channelId, timestamp]`, `[guildId, channelId, authorIsBot, timestamp]`

### `IngestedAttachment`

Cached text extraction from non-image Discord file attachments.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `messageId` / `attachmentIndex` | Unique constraint | One entry per attachment |
| `filename` / `sourceUrl` | `String` | Original file metadata |
| `extractor` | `String?` | `tika`, `native`, etc. |
| `status` | `String` | `ok`, `error`, `skipped` |
| `extractedText` | `Text?` | Cached content |
| `extractedTextChars` | `Int` | Character count |

### `ChannelSummary`

Rolling and profile channel summaries with structured metadata.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `guildId` / `channelId` | `String` | Channel scope |
| `kind` | `String` | `rolling` or `profile` |
| `windowStart` / `windowEnd` | `DateTime` | Summary time range |
| `summaryText` | `String` | LLM-generated summary |
| `topicsJson` / `threadsJson` / `unresolvedJson` | `Json?` | Structured metadata |
| `decisionsJson` / `actionItemsJson` | `Json?` | Extracted decisions/actions |
| `sentiment` / `glossaryJson` | `String?` / `Json?` | Sentiment + glossary |

Unique constraint: `[guildId, channelId, kind]`

### `VoiceSession`

Discord voice channel presence tracking.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `guildId` / `channelId` / `userId` | `String` | Session scope |
| `displayName` | `String?` | User display name at session time |
| `startedAt` / `endedAt` | `DateTime` | Session duration |

### `VoiceConversationSummary`

Summary-only memory for a transcribed voice session (optional feature).

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `guildId` / `voiceChannelId` | `String` | Guild + voice channel scope |
| `voiceChannelName` | `String?` | Channel display name at session time |
| `initiatedByUserId` | `String` | User who invoked `/join` |
| `startedAt` / `endedAt` | `DateTime` | Session window |
| `speakerStatsJson` | `Json` | Per-speaker utterance counts (summary metadata) |
| `summaryText` | `String` | LLM-generated narrative summary |
| `topicsJson` / `threadsJson` / `unresolvedJson` | `Json?` | Structured metadata |
| `decisionsJson` / `actionItemsJson` | `Json?` | Extracted decisions/actions |
| `sentiment` / `glossaryJson` | `String?` / `Json?` | Sentiment + glossary |

### `RelationshipEdge`

Probabilistic user relationships from interaction signals.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `guildId` | `String` | Guild scope |
| `userA` / `userB` | `String` | Lexicographically ordered pair |
| `weight` | `Float` | 0.0–1.0 relationship strength |
| `confidence` | `Float` | 0.0–1.0 evidence strength |
| `featuresJson` | `Json` | `{ mentions, replies, voice, meta }` |
| `manualOverride` | `Float?` | Admin-set override (0.0–1.0) |

Unique constraint: `[guildId, userA, userB]`

---

<a id="embeddings--search-tables"></a>

## 🔍 Embeddings & Search Tables

### `AttachmentChunk`

Vector-embedded chunks of ingested attachment text for semantic search.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `attachmentId` | `String` | Reference to `IngestedAttachment` |
| `chunkIndex` | `Int` | Ordered chunk position |
| `content` | `Text` | Chunk text |
| `tokenCount` | `Int` | Token count for budgeting |
| `embedding` | `vector(256)` | pgvector embedding |

### `ChannelMessageEmbedding`

Vector embeddings of channel messages for hybrid semantic/lexical search.

| Column | Type | Notes |
|:---|:---|:---|
| `messageId` | `String` (PK, FK → `ChannelMessage`) | Cascade delete |
| `guildId` / `channelId` | `String` | Indexed for scoped queries |
| `embedding` | `vector(256)` | pgvector embedding |

> [!NOTE]
> Embeddings use the `nomic-ai/nomic-embed-text-v1.5` model (configurable via `EMBEDDING_MODEL`) with 256 dimensions (fixed in schema).

---

<a id="telemetry-tables"></a>

## 📡 Telemetry Tables

### `AgentTrace`

Per-turn telemetry for debugging and observability.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | Trace ID |
| `routeKind` | `String` | Canonical value: `single` |
| `agentEventsJson` | `Json?` | Tool call events with timing |
| `budgetJson` | `Json?` | Token budget allocation per block |
| `toolJson` | `Json?` | Tool names, args, results |
| `tokenJson` | `Json?` | Provider token usage |
| `qualityJson` | `Json?` | Quality metrics |
| `reasoningText` | `Text?` | Agent reasoning/selector text |
| `replyText` | `Text` | Final reply |

### `ModelHealthState`

Rolling health scores per model for degraded-mode signaling.

| Column | Type | Notes |
|:---|:---|:---|
| `modelId` | `String` (PK) | Model identifier |
| `score` | `Float` | Rolling health score |
| `samples` | `Int` | Sample count |

---

<a id="admin--operations-tables"></a>

## 🛡️ Admin & Operations Tables

### `PendingAdminAction`

Queued admin actions awaiting approval via Discord buttons.

| Column | Type | Notes |
|:---|:---|:---|
| `id` | `String` (PK) | CUID |
| `guildId` / `channelId` | `String` | Action scope |
| `approvalMessageId` | `String?` | Discord message id for the admin approval card (auto-deleted after resolution; persisted for restart-safe cleanup) |
| `requestMessageId` | `String?` | Discord message id for Sage's requester-facing status message (edited on resolution) |
| `kind` | `String` | Action type (e.g., `server_memory_update`, `moderation`) |
| `payloadJson` | `Json` | Action parameters |
| `status` | `String` | `pending` / `approved` / `rejected` / `executed` / `failed` / `expired` |
| `expiresAt` | `DateTime` | Auto-expiry deadline |
| `decidedBy` / `decidedAt` | `String?` / `DateTime?` | Admin decision metadata |

### `AdminAudit`

Records admin command usage with hashed parameters.

| Column | Type | Notes |
|:---|:---|:---|
| `guildId` / `adminId` | `String` | Audit scope |
| `command` | `String` | Command name |
| `paramsHash` | `String` | SHA256 of normalized params JSON |

---

<a id="common-operations"></a>

## 🔧 Common Operations

```bash
# Apply tracked migrations
npx prisma migrate deploy

# Open visual database browser
npm run db:studio

# Create a new migration (development only)
npx prisma migrate dev --name <migration_name>

# Reset database (⚠️ deletes all data)
npx prisma migrate reset --force --skip-generate
```

> [!WARNING]
> Always back up your database before running migrations in production. Use `npx prisma migrate deploy` (not `dev`) for production environments.

---

<a id="related-documentation"></a>

## 🔗 Related Documentation

- [🧠 Memory System](MEMORY.md) — How Sage stores, summarizes, and injects memory
- [🕸️ Social Graph](SOCIAL_GRAPH.md) — GNN pipeline and Memgraph integration
- [🔒 Security & Privacy](../security/SECURITY_PRIVACY.md) — Data handling and retention
- [⚙️ Configuration](../reference/CONFIGURATION.md) — All database-related env vars
- [🚀 Deployment Guide](../operations/DEPLOYMENT.md) — Database setup for production

<p align="right"><a href="#top">⬆️ Back to top</a></p>

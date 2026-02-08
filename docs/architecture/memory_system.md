# 🧠 Sage Memory System Architecture

This document describes how Sage stores, summarizes, and injects memory into LLM requests. It reflects the current runtime behavior in `src/core`.

---

## 🧭 Quick navigation

- [1) Memory sources and storage](#1-memory-sources-and-storage)
- [2) Data retention (transcripts)](#2-data-retention-transcripts)
- [3) Context assembly flow](#3-context-assembly-flow)
- [4) Working memory (context builder)](#4-working-memory-context-builder)
- [5) Short-term memory: rolling channel summary](#5-short-term-memory-rolling-channel-summary)
- [6) Long-term memory: channel profile](#6-long-term-memory-channel-profile)
- [7) Throttled user profile updates](#7-throttled-user-profile-updates)
- [8) Relationship graph & social tiers](#8-relationship-graph-social-tiers)
- [9) Voice awareness in memory](#9-voice-awareness-in-memory)
- [🔗 Related documentation](#related-documentation)

---

<a id="1-memory-sources-and-storage"></a>

## 1) Memory sources and storage

| Memory type | Purpose | Storage | Key files |
| :--- | :--- | :--- | :--- |
| **User profile** | Long-term personalization facts for a user. | `UserProfile` table. | `src/core/memory/profileUpdater.ts`, `src/core/memory/userProfileRepo.ts` |
| **Channel summaries** | Rolling + long-term summaries for a channel. | `ChannelSummary` table. | `src/core/summary/*` |
| **Raw transcript** | Recent messages for short-term context. | In-memory ring buffer; optional DB storage. | `src/core/awareness/*`, `src/core/ingest/ingestEvent.ts` |
| **Relationship graph** | Probabilistic user connections from messages + voice overlap. | `RelationshipEdge` table. | `src/core/relationships/*` |
| **Voice sessions** | Presence history and time-in-voice analytics. | `VoiceSession` table. | `src/core/voice/*` |

---

<a id="2-data-retention-transcripts"></a>

## 2) Data retention (transcripts)

- **In-memory ring buffer** uses:
  - `RAW_MESSAGE_TTL_DAYS` (default: 3 days)
  - `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` (default: 200)
- **DB transcript storage** (`ChannelMessage` table) is trimmed per channel to:
  - `CONTEXT_TRANSCRIPT_MAX_MESSAGES` (default: 15)

The DB store is **size-bounded**, not time-based. If you want longer retention, increase `CONTEXT_TRANSCRIPT_MAX_MESSAGES`.

---

<a id="3-context-assembly-flow"></a>

## 3) Context assembly flow

```mermaid
flowchart LR
    %% How persistent + short-term context is assembled into an LLM prompt.
    classDef storage fill:#cfd8dc,stroke:#455a64,color:black
    classDef expert fill:#d1c4e9,stroke:#512da8,color:black
    classDef builder fill:#bbdefb,stroke:#1976d2,color:black
    classDef llm fill:#c8e6c9,stroke:#388e3c,color:black

    subgraph Storage
        DB[(PostgreSQL)]:::storage
        RB[Ring Buffer]:::storage
    end

    subgraph Experts
        SE[👥 Social]:::expert
        VE[🎤 Voice]:::expert
        ME[🧠 Memory]:::expert
    end

    subgraph Context_Builder["Context Builder"]
        MB[Context Assembler]:::builder
        Budget[Token Budgeter]:::builder
    end

    DB --> SE
    DB --> VE
    DB --> ME

    RB --> MB
    SE --> MB
    VE --> MB
    ME --> MB

    MB --> Budget --> LLM[LLM Brain]:::llm
```

---

<a id="4-working-memory-context-builder"></a>

## 4) Working memory (context builder)

**File:** `src/core/agentRuntime/contextBuilder.ts`

When a message is processed, `buildContextMessages` assembles the prompt by prioritizing structured context blocks. Key inputs include:

- Base system prompt (includes user profile + style hints via `composeSystemPrompt`)
- Channel profile summary (long-term)
- Relationship hints (social graph edges with emoji tiers)
- Rolling channel summary (short-term)
- Narrative expert packets (planner-selected lookups)
- Recent transcript (raw message log)
- Intent hint / reply context
- User message

Context is budgeted by `contextBudgeter` using the following defaults (configurable in `.env`):

| Budget | Default | Env var |
| :--- | :--- | :--- |
| Max input tokens | 65,536 | `CONTEXT_MAX_INPUT_TOKENS` |
| Reserved output tokens | 8,192 | `CONTEXT_RESERVED_OUTPUT_TOKENS` |
| System prompt max | 6,000 | `SYSTEM_PROMPT_MAX_TOKENS` |
| Transcript block max | 8,000 | `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` |
| Rolling summary max | 4,800 | `CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY` |
| Profile summary max | 4,800 | `CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY` |
| Reply context max | 3,200 | `CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT` |
| Expert packets max | 4,800 | `CONTEXT_BLOCK_MAX_TOKENS_EXPERTS` |
| Relationship hints max | 2,400 | `CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS` |
| User message max | 24,000 | `CONTEXT_USER_MAX_TOKENS` |

---

<a id="5-short-term-memory-rolling-channel-summary"></a>

## 5) Short-term memory: rolling channel summary

**Files:**

- `src/core/summary/channelSummaryScheduler.ts`
- `src/core/summary/summarizeChannelWindow.ts`

**Trigger:** The scheduler runs every `SUMMARY_SCHED_TICK_SEC` (default: 60s) and only processes channels with new messages.

**Conditions:**

- At least `SUMMARY_ROLLING_MIN_MESSAGES` new messages (default: 20)
- At least `SUMMARY_ROLLING_MIN_INTERVAL_SEC` since last summary (default: 300s)

**Window:**

- Rolling window length: `SUMMARY_ROLLING_WINDOW_MIN` (default: 60 minutes)
- Fetches up to 800 recent messages, bounded to 80,000 characters

**Output:** a `StructuredSummary` JSON object containing:

- `summaryText`, `topics`, `threads`, `decisions`, `actionItems`, `sentiment`, `unresolved`, `glossary`

**Storage:** `ChannelSummary` with `kind = 'rolling'`.

---

<a id="6-long-term-memory-channel-profile"></a>

## 6) Long-term memory: channel profile

**File:** `src/core/summary/summarizeChannelWindow.ts`

After a rolling summary, Sage optionally updates the long-term profile if:

- `SUMMARY_PROFILE_MIN_INTERVAL_SEC` has elapsed (default: 6 hours), or
- the summary is forced via the admin command.

The profile merges the previous long-term summary with the latest rolling summary, and stores the result in `ChannelSummary` with `kind = 'profile'`.

---

<a id="7-throttled-user-profile-updates"></a>

## 7) Throttled user profile updates

**File:** `src/core/chat/chatEngine.ts` & `src/core/memory/profileUpdater.ts`

Sage updates user profiles asynchronously. To reduce cost and duplicate work, updates are **throttled**:

- **Update interval:** `PROFILE_UPDATE_INTERVAL` (default: 5 messages)
- **Process:**
  1. **Analyst pass** (`PROFILE_CHAT_MODEL`, default: `deepseek`) produces updated profile text.
  2. **Formatter pass** (`FORMATTER_MODEL`, default: `qwen-coder`) wraps the text into JSON for validation.

The result is stored in `UserProfile.summary`. If the formatter fails, the previous summary is preserved.

---

<a id="8-relationship-graph-social-tiers"></a>

## 8) Relationship graph & social tiers

**Files:**

- `src/core/relationships/relationshipGraph.ts`
- `src/core/orchestration/experts/socialGraphExpert.ts`

Relationship edges are updated from **mentions** and **voice overlap**. The Social Graph Expert translates interaction metrics into human-readable tiers:

- **Best Friend** 🌟 (Highest interaction weight)
- **Close Friend** ✨
- **Friend** 👋
- **Acquaintance** 👤

```mermaid
flowchart LR
    %% Relationship tiers are derived from interaction signals.
    classDef tier fill:#fff9c4,stroke:#fbc02d,color:black
    classDef input fill:#e1f5fe,stroke:#0277bd,color:black
    classDef logic fill:#e0f2f1,stroke:#00695c,color:black

    subgraph Tier_Scale["Relationship tier scale"]
        direction LR
        A[Stranger 🧊]:::tier --> B[Acquaintance 👤]:::tier --> C[Friend 👋]:::tier --> D[Close Friend ✨]:::tier --> E[Best Friend 🌟]:::tier
    end

    subgraph Signals
        direction TB
        F[Mentions]:::input
        G[Replies]:::input
        H[Voice overlap]:::input
    end

    F --> W[Weight / score]:::logic
    G --> W
    H --> W
    W --> T[Tier selection]:::logic
```

These tiers are injected into the LLM context to adjust tone and familiarity.

---

<a id="9-voice-awareness-in-memory"></a>

## 9) Voice awareness in memory

Voice events are ingested and stored as `VoiceSession` entries. The **Voice Analytics Expert** translates sessions into natural language insights (e.g., “Active in voice for 45 minutes today”) which are then used by the LLM to answer presence-related questions.

---

<a id="related-documentation"></a>

## 🔗 Related documentation

- [🔀 Runtime pipeline](pipeline.md)
- [💾 Database architecture](database.md)
- [🔒 Security & privacy](../security_privacy.md)

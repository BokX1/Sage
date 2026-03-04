# 🧠 Sage Memory System Architecture

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Memory-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Memory" />
</p>

This document describes how Sage stores, summarizes, and injects memory into runtime prompts. It reflects current behavior in `src/core`.

---

## 🧭 Quick navigation

- [1) Memory sources and storage](#1-memory-sources-and-storage)
- [2) Data retention (transcripts)](#2-data-retention-transcripts)
- [3) Context assembly flow](#3-context-assembly-flow)
- [4) Working memory (context builder)](#4-working-memory-context-builder)
- [5) Short-term memory: rolling channel summary](#5-short-term-memory-rolling-channel-summary)
- [6) Long-term memory: channel profile](#6-long-term-memory-channel-profile)
- [7) Throttled user profile updates](#7-throttled-user-profile-updates)
- [8) Relationship graph and social tiers](#8-relationship-graph-and-social-tiers)
- [9) Voice awareness in memory](#9-voice-awareness-in-memory)
- [🔗 Related documentation](#related-documentation)

---

<a id="1-memory-sources-and-storage"></a>

## 1) Memory sources and storage

| Memory type | Purpose | Storage | Key files |
| :--- | :--- | :--- | :--- |
| **User profile** | Long-term personalization summary per user. | `UserProfile` table. | `src/core/memory/profileUpdater.ts`, `src/core/memory/userProfileRepo.ts` |
| **Channel summaries** | Rolling + long-term channel context. | `ChannelSummary` table. | `src/core/summary/*` |
| **Raw transcript** | Recent messages for short-term context. | Ring buffer + optional `ChannelMessage` table storage. | `src/core/awareness/*`, `src/core/ingest/ingestEvent.ts` |
| **Attachment cache** | Persisted non-image file extraction (text + metadata) for on-demand retrieval. | `IngestedAttachment` table. | `src/core/attachments/ingestedAttachmentRepo.ts`, `src/bot/handlers/messageCreate.ts` |
| **Relationship graph** | Probabilistic user connections from mentions/replies/voice overlap. | `RelationshipEdge` table. | `src/core/relationships/*`, `src/core/agentRuntime/toolIntegrations.ts` |
| **Voice sessions** | Presence history and voice-duration analytics. | `VoiceSession` table. | `src/core/voice/*`, `src/core/agentRuntime/toolIntegrations.ts` |

---

<a id="2-data-retention-transcripts"></a>

## 2) Data retention (transcripts)

- **In-memory ring buffer** uses:
  - `RAW_MESSAGE_TTL_DAYS` (default in `.env.example`: `3`)
  - `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` (default in `.env.example`: `200`)
- **DB transcript window** used for prompt context is bounded by:
  - `CONTEXT_TRANSCRIPT_MAX_MESSAGES` (default in `.env.example`: `15`)
  - `CONTEXT_TRANSCRIPT_MAX_CHARS` (default in `.env.example`: `24000`)

Transcript usage is size/window bounded. For longer context, increase transcript limits carefully.

Attachment behavior:

- Transcript rows store attachment-cache notes, not full historical file bodies.
- Full file content is loaded on demand through the runtime tool loop (`discord` action `files.list_channel` for same-channel lookups, or `files.list_server` for server-wide lookups with permission filtering).

---

<a id="3-context-assembly-flow"></a>

## 3) Context assembly flow

```mermaid
flowchart LR
    classDef storage fill:#cfd8dc,stroke:#455a64,color:black
    classDef tools fill:#d1c4e9,stroke:#512da8,color:black
    classDef builder fill:#bbdefb,stroke:#1976d2,color:black
    classDef llm fill:#c8e6c9,stroke:#388e3c,color:black

    subgraph Storage
        DB[(PostgreSQL)]:::storage
        RB[Ring Buffer]:::storage
    end

    subgraph Tools
        MP[discord: memory.get_user]:::tools
        SP[discord: analytics.get_social_graph]:::tools
        VP[discord: analytics.get_voice_analytics]:::tools
        SU[discord: memory.get_channel]:::tools
    end

    subgraph Context_Builder["Context Builder"]
        MB[buildContextMessages]:::builder
        Budget[contextBudgeter]:::builder
    end

    RB --> MB
    MB --> Budget --> LLM[LLM Request + Tool Loop]:::llm
    DB --> MP
    DB --> SP
    DB --> VP
    DB --> SU
    LLM --> MP
    LLM --> SP
    LLM --> VP
    LLM --> SU
```

Runtime notes:

- Memory is not pre-fetched through a graph executor.
- The model calls memory tools on demand when additional context is needed.
- Tool results are injected back through the runtime tool loop.

---

<a id="4-working-memory-context-builder"></a>

## 4) Working memory (context builder)

**File:** `src/core/agentRuntime/contextBuilder.ts`

`buildContextMessages` composes turn context in prioritized blocks:

- Base system prompt (`composeSystemPrompt`)
- Runtime instruction block (single-agent capabilities, optional agentic state, tool protocol)
- Channel profile summary
- Rolling channel summary
- Tool-driven context fetched on demand (not pre-injected as provider packets)
- Recent transcript
- Intent hint + reply context/reference
- Current user message/content

Attachment note: historical file content is not replayed from transcript by default; file text is retrieved from cache on demand when requested (channel-scoped or server-wide, depending on the tool used).

All system blocks are merged into one system message before provider calls.

Context is budgeted by `contextBudgeter` using these key limits:

| Budget | Env var |
| :--- | :--- |
| Max input tokens | `CONTEXT_MAX_INPUT_TOKENS` |
| Reserved output tokens | `CONTEXT_RESERVED_OUTPUT_TOKENS` |
| Transcript block max | `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` |
| Rolling summary max | `CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY` |
| Profile summary max | `CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY` |
| Memory block max | `CONTEXT_BLOCK_MAX_TOKENS_MEMORY` |
| Reply context max | `CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT` |
| Provider/action packets max | `CONTEXT_BLOCK_MAX_TOKENS_PROVIDERS` |
| User message max | `CONTEXT_USER_MAX_TOKENS` |

---

<a id="5-short-term-memory-rolling-channel-summary"></a>

## 5) Short-term memory: rolling channel summary

**Files:**

- `src/core/summary/channelSummaryScheduler.ts`
- `src/core/summary/summarizeChannelWindow.ts`

Scheduler behavior:

- Tick interval: `SUMMARY_SCHED_TICK_SEC` (default `60`)
- Requires at least `SUMMARY_ROLLING_MIN_MESSAGES` new messages (default `20`)
- Requires at least `SUMMARY_ROLLING_MIN_INTERVAL_SEC` since last summary (default `300`)
- Uses rolling window `SUMMARY_ROLLING_WINDOW_MIN` (default `60`)

Output is stored as `ChannelSummary` with `kind = 'rolling'`.

---

<a id="6-long-term-memory-channel-profile"></a>

## 6) Long-term memory: channel profile

**File:** `src/core/summary/summarizeChannelWindow.ts`

Long-term profile summary updates when:

- `SUMMARY_PROFILE_MIN_INTERVAL_SEC` has elapsed (default `21600` in `.env.example`), or
- an admin manually triggers summarize command.

Output is stored as `ChannelSummary` with `kind = 'profile'`.

---

<a id="7-throttled-user-profile-updates"></a>

## 7) Throttled user profile updates

**Files:** `src/core/chat-engine.ts`, `src/core/memory/profileUpdater.ts`

Sage updates user profiles asynchronously with throttling:

- Update interval: `PROFILE_UPDATE_INTERVAL` (default `5`)
- Two-step pipeline:
  1. Analyst pass (`PROFILE_CHAT_MODEL`) updates profile narrative.
  2. Local JSON repair (`jsonrepair`) wraps output into strict JSON.
- Per-user sequential guard prevents concurrent profile races.

Result is persisted to `UserProfile.summary`; failed formatter output keeps prior summary.

---

<a id="8-relationship-graph-and-social-tiers"></a>

## 8) Relationship graph and social tiers

**Files:** `src/core/relationships/relationshipGraph.ts`, `src/core/agentRuntime/toolIntegrations.ts`

Relationship edges are updated from mentions/replies/voice overlap and rendered as narrative tiers:

- Best Friend
- Close Friend
- Friend
- Acquaintance
- New Connection

These social signals are returned through `discord` action `analytics.get_social_graph` when the model requests them.

---

<a id="9-voice-awareness-in-memory"></a>

## 9) Voice awareness in memory

Voice presence events are stored in `VoiceSession` (join/leave + duration only).

`discord` action `analytics.get_voice_analytics` summarizes:

- who is currently in voice,
- how long the user has been active today,
- lightweight activity signals for response context.

Optional voice session summary memory:

- If voice transcription is enabled, Sage can transcribe in-channel audio while connected.
- Utterance transcripts are kept **in-memory only** and are discarded when the session ends.
- On leave/disconnect, Sage can persist a **summary-only** record to `VoiceConversationSummary` (topics/decisions/action items).
- These summaries are retrievable via `discord` action `analytics.voice_summaries`.

---

<a id="related-documentation"></a>

## 🔗 Related documentation

- [🔀 Runtime pipeline](PIPELINE.md)
- [💾 Database architecture](DATABASE.md)
- [🔒 Security and privacy](../security/SECURITY_PRIVACY.md)

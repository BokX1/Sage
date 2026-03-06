# 🧠 Sage Memory System Architecture

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Memory-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Memory" />
</p>

This document describes how Sage stores memory and makes it available to the runtime. It reflects the current behavior under `src/core`.

---

## 🧭 Quick navigation

- [1) Memory sources and storage](#1-memory-sources-and-storage)
- [2) Data retention (transcripts)](#2-data-retention-transcripts)
- [3) Context assembly flow](#3-context-assembly-flow)
- [4) Working memory (context builder)](#4-working-memory-context-builder)
- [5) Short-term memory: rolling channel summary](#5-short-term-memory-rolling-channel-summary)
- [6) Long-term memory: channel profile](#6-long-term-memory-channel-profile)
- [7) Throttled user profile updates](#7-throttled-user-profile-updates)
- [8) Relationship graph and social layers](#8-relationship-graph-and-social-layers)
- [9) Voice awareness in memory](#9-voice-awareness-in-memory)
- [🔗 Related documentation](#related-documentation)

---

<a id="1-memory-sources-and-storage"></a>

## 1) Memory sources and storage

| Memory type | Purpose | Storage | Key files |
| :--- | :--- | :--- | :--- |
| **User profile** | Long-term personalization summary per user, with archive history. | `UserProfile`, `UserProfileArchive` | `src/features/memory/profileUpdater.ts`, `src/features/memory/userProfileRepo.ts` |
| **Guild memory** | Admin-authored server memory and archive history. | `GuildMemory`, `GuildMemoryArchive` | `src/features/admin/*`, `src/features/agent-runtime/discordTool.ts` |
| **Channel summaries** | Rolling and profile summaries for channels. | `ChannelSummary` | `src/features/summary/*` |
| **Raw transcript** | Recent message history for prompt context and retrieval. | Ring buffer plus optional `ChannelMessage` persistence | `src/features/awareness/*`, `src/features/ingest/ingestEvent.ts` |
| **Attachment cache** | Persisted non-image file extraction for on-demand retrieval. | `IngestedAttachment`, `AttachmentChunk` | `src/features/attachments/*`, `src/app/discord/handlers/messageCreate.ts` |
| **Relationship graph** | Relationship weights derived from mentions, replies, reactions, and voice overlap. | `RelationshipEdge`, optional Memgraph export | `src/features/relationships/*`, `src/features/social-graph/*` |
| **Voice sessions** | Voice join/leave history and optional summary-only session memory. | `VoiceSession`, `VoiceConversationSummary` | `src/features/voice/*` |

---

<a id="2-data-retention-transcripts"></a>

## 2) Data retention (transcripts)

- **In-memory transcript ring buffer**
  - `RAW_MESSAGE_TTL_DAYS` starter value: `3`
  - `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` starter value: `200`
- **Database transcript retention**
  - `MESSAGE_DB_STORAGE_ENABLED=true` persists messages into `ChannelMessage`
  - `MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL` starter value: `500` caps retained rows per channel
- **Prompt transcript window**
  - `CONTEXT_TRANSCRIPT_MAX_MESSAGES` starter value: `15`
  - `CONTEXT_TRANSCRIPT_MAX_CHARS` starter value: `24000`

Transcript storage and prompt budgeting are separate controls. A channel can retain more history in the database than any single prompt includes.

Attachment behavior:

- Transcript rows store cache references and message metadata, not full historical file bodies.
- Full file text is loaded on demand through `discord` tool actions such as `files.list_channel`, `files.list_server`, and `files.read_attachment`.

Voice transcript behavior:

- Live STT utterances are kept **in-memory only** during a voice session.
- When voice session summaries are enabled, Sage stores only the structured summary row in `VoiceConversationSummary`, not the raw utterance transcript.

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
        VS[Live Voice Session Store]:::storage
    end

    subgraph Tools
        U[discord: memory.get_user]:::tools
        C[discord: memory.get_channel]:::tools
        A[discord: memory.channel_archives]:::tools
        G[discord: analytics.get_social_graph]:::tools
        F[discord: files.read_attachment]:::tools
    end

    subgraph Builder["Context Builder"]
        MB[buildContextMessages]:::builder
        Budget[contextBudgeter]:::builder
    end

    RB --> MB
    VS --> MB
    MB --> Budget --> LLM[LLM Request + Tool Loop]:::llm
    DB --> U
    DB --> C
    DB --> A
    DB --> G
    DB --> F
    LLM --> U
    LLM --> C
    LLM --> A
    LLM --> G
    LLM --> F
```

Runtime notes:

- Memory is not pre-fetched through a separate graph executor.
- User profile summary is the only long-term memory block always embedded up front, and it is embedded inside the system prompt.
- Channel summaries, archives, social-graph data, file cache data, and wider message history are fetched only if the model chooses the corresponding tool action.

---

<a id="4-working-memory-context-builder"></a>

## 4) Working memory (context builder)

**File:** `src/features/agent-runtime/contextBuilder.ts`

`buildContextMessages` composes turn context in these prioritized blocks:

- Base system prompt from `composeSystemPrompt`
- Runtime instruction block
- Optional guild memory
- Optional live voice context
- Recent transcript
- Prior Sage reply context
- Reply reference content
- Current user message/content

The user profile summary is embedded inside `<user_context>` in the system prompt produced by `composeSystemPrompt`.

What is **not** preloaded:

- channel summaries
- archived summaries
- social-graph results
- attachment cache text
- historical message search results

These are returned only when the tool loop calls for them.

Context is budgeted by `contextBudgeter` using these key limits:

| Budget | Env var |
| :--- | :--- |
| Max input tokens | `CONTEXT_MAX_INPUT_TOKENS` |
| Reserved output tokens | `CONTEXT_RESERVED_OUTPUT_TOKENS` |
| Transcript block max | `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` |
| Rolling summary block max | `CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY` |
| Profile summary block max | `CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY` |
| Memory block max | `CONTEXT_BLOCK_MAX_TOKENS_MEMORY` |
| Reply context max | `CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT` |
| Provider packet max | `CONTEXT_BLOCK_MAX_TOKENS_PROVIDERS` |
| User message max | `CONTEXT_USER_MAX_TOKENS` |

---

<a id="5-short-term-memory-rolling-channel-summary"></a>

## 5) Short-term memory: rolling channel summary

**Files:**

- `src/features/summary/channelSummaryScheduler.ts`
- `src/features/summary/summarizeChannelWindow.ts`

Scheduler behavior:

- Tick interval: `SUMMARY_SCHED_TICK_SEC` starter value `60`
- Minimum messages before update: `SUMMARY_ROLLING_MIN_MESSAGES` starter value `20`
- Minimum interval between updates: `SUMMARY_ROLLING_MIN_INTERVAL_SEC` starter value `300`
- Rolling window size: `SUMMARY_ROLLING_WINDOW_MIN` starter value `60`

Output is stored in `ChannelSummary` with `kind = 'rolling'`.

---

<a id="6-long-term-memory-channel-profile"></a>

## 6) Long-term memory: channel profile

**File:** `src/features/summary/summarizeChannelWindow.ts`

Long-term channel profile summaries are scheduler-driven:

- `SUMMARY_PROFILE_MIN_INTERVAL_SEC` starter value `21600` gates profile updates
- output is stored in `ChannelSummary` with `kind = 'profile'`
- the runtime reads these summaries through `discord` tool actions when needed

There is no dedicated summarize slash command in the current command set.

---

<a id="7-throttled-user-profile-updates"></a>

## 7) Throttled user profile updates

**Files:** `src/features/chat/chat-engine.ts`, `src/features/memory/profileUpdater.ts`

Sage updates user profiles asynchronously with throttling:

- Update interval: `PROFILE_UPDATE_INTERVAL` starter value `5`
- Analysis model: `PROFILE_CHAT_MODEL` starter value `deepseek`
- Formatter/repair step: `jsonrepair` is used to recover strict JSON output
- Concurrency guard: per-user sequential protection prevents overlapping profile updates

The latest profile is stored in `UserProfile.summary`, and prior versions can be archived in `UserProfileArchive`.

---

<a id="8-relationship-graph-and-social-layers"></a>

## 8) Relationship graph and social layers

**Files:** `src/features/relationships/*`, `src/features/social-graph/socialGraphQuery.ts`

Relationship edges are updated from mentions, replies, reactions, and voice overlap. At query time, Sage maps ranked relationships into Dunbar-style labels:

- `intimate`
- `close`
- `active`
- `acquaintance`
- `distant`

These signals are returned through `discord` tool actions such as `analytics.get_social_graph` and `analytics.top_relationships`.

If the optional Memgraph/Redpanda stack is enabled, Sage can also export interaction events and query richer graph analytics from Memgraph.

---

<a id="9-voice-awareness-in-memory"></a>

## 9) Voice awareness in memory

Voice presence events are stored in `VoiceSession` as join/leave windows and durations.

`discord` action `analytics.get_voice_analytics` summarizes:

- who is currently in voice
- how long a user has been active today
- lightweight voice-activity signals for response context

Optional voice session summary memory:

- If `VOICE_STT_ENABLED=true`, Sage can transcribe in-channel audio while connected.
- Utterance transcripts stay **in-memory only** in the live session store.
- On leave/disconnect, Sage can persist a **summary-only** record to `VoiceConversationSummary`.
- These summaries are retrievable via `discord` action `analytics.voice_summaries`.

---

<a id="related-documentation"></a>

## 🔗 Related documentation

- [🔀 Runtime pipeline](PIPELINE.md)
- [💾 Database architecture](DATABASE.md)
- [🔒 Security and privacy](../security/SECURITY_PRIVACY.md)

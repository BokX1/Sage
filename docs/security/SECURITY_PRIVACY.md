# 🔒 Security & Privacy

What Sage stores, how to control retention, and what goes to the LLM provider.

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Security-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Security" />
</p>

This document describes what Sage stores and how to control retention. Implementation references include `prisma/schema.prisma` and the ingestion pipeline under `src/core`.

> [!IMPORTANT]
> If you run Sage, you are responsible for the data it stores in your database. Review the defaults below and adjust `.env` to match your server’s privacy expectations.

---

## 🧭 Quick navigation

- [✅ What Sage stores (default)](#what-sage-stores-default)
- [⚙️ Message ingestion controls](#message-ingestion-controls)
- [🧾 Retention behavior](#retention-behavior)
- [📤 What is sent to the LLM provider](#what-is-sent-to-the-llm-provider)
- [🧹 Deletion / reset](#deletion-reset)
- [🩹 Redaction](#redaction)

---

<a id="what-sage-stores-default"></a>

## ✅ What Sage stores (default)

| Data | Table | Notes |
| --- | --- | --- |
| User profile summaries | `UserProfile` | LLM-generated long-term summary of a user. |
| User profile archives | `UserProfileArchive` | Historical snapshots of user profiles. |
| Guild settings | `GuildSettings` | Stores server-scoped BYOP key configuration. |
| Server instructions | `GuildMemory` | Admin-authored server instructions available to the runtime. |
| Server instruction archives | `GuildMemoryArchive` | Historical snapshots of server instruction updates. |
| Channel messages | `ChannelMessage` | Stored only if `MESSAGE_DB_STORAGE_ENABLED=true`. |
| Ingested attachments | `IngestedAttachment` | Non-image attachment extraction cache (text + metadata) for on-demand retrieval. |
| Channel summaries | `ChannelSummary` | Rolling + profile summaries, plus metadata (topics, decisions, etc.). |
| Relationship edges | `RelationshipEdge` | Probabilistic relationship weights from mentions/replies/voice overlap. |
| Voice sessions | `VoiceSession` | Join/leave session history per user/channel. |
| Voice session summaries | `VoiceConversationSummary` | Summary-only memory of transcribed voice sessions (optional; no raw transcript stored in DB). |
| Pending admin actions | `PendingAdminAction` | Approval-gated admin action queue and status metadata. |
| Admin audits | `AdminAudit` | Records admin command usage with hashed params. |
| Agent traces | `AgentTrace` | Agent trace payload, context budget metadata, and final reply text (if tracing is enabled). |
| Model health state | `ModelHealthState` | Rolling model health scores used for diagnostics. |

---

<a id="message-ingestion-controls"></a>

## ⚙️ Message ingestion controls

These settings control what Sage ingests and logs:

- `INGESTION_ENABLED=false` disables message/voice ingestion entirely.
- `INGESTION_MODE=allowlist` limits ingestion to channels listed in `INGESTION_ALLOWLIST_CHANNEL_IDS_CSV`.
- `INGESTION_BLOCKLIST_CHANNEL_IDS_CSV` excludes specific channels.
- Voice transcription (STT) also requires `VOICE_STT_ENABLED=true` and only runs in channels where logging is enabled by the ingestion policy.

---

<a id="retention-behavior"></a>

## 🧾 Retention behavior

- **In-memory transcripts** honor:
  - `RAW_MESSAGE_TTL_DAYS`
  - `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL`
- **DB transcripts** are trimmed per channel to `MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL`.
- **Prompt transcript windows** are separately bounded by `CONTEXT_TRANSCRIPT_MAX_MESSAGES` and `CONTEXT_TRANSCRIPT_MAX_CHARS`.
- **Voice transcription utterances** are kept in-memory only and discarded when the voice session ends; only summary rows persist (when enabled).
- **Attachment cache** persists extracted non-image file text/metadata (including optional voice-message transcripts) in `IngestedAttachment` until deleted manually.
- **Summaries and profiles** persist until deleted manually.
- **Agent traces** are stored only when `TRACE_ENABLED=true`.

> [!TIP]
> Want less retained context? Reduce `CONTEXT_TRANSCRIPT_MAX_MESSAGES`, disable DB storage, and/or disable tracing.

---

<a id="what-is-sent-to-the-llm-provider"></a>

## 📤 What is sent to the LLM provider

When generating replies, Sage sends:

- The user’s message content
- Reply references (if the user replied to another message)
- Recent transcript and optional live voice context when Sage is active in voice
- User profile summary embedded inside the runtime system prompt
- Server instructions when guild-specific behavior has been configured
- Tool-fetched summaries, archives, social-graph data, or attachment cache results only when the tool loop requests them
- Stored message-history retrieval results when tool loop calls `discord` actions `messages.search_history` / `messages.get_context` (permission-gated; optional `channelId` can target other channels)
- Attachment text blocks for the current turn when inline analysis is needed
- Attachment-cache retrieval results when tool loop calls `discord` actions `files.list_channel` or `files.list_server` (server-wide results are permission-filtered)
- When an admin authorizes `discord` action `discord.api` calls that include multipart `files` sourced from a URL, Sage will fetch those files from public HTTP(S) URLs to upload them to Discord (private/local hosts are blocked).
- Image URLs for vision-capable requests
- When voice session summary is enabled, Sage may send an utterance-level transcript (text) to the LLM provider to generate a summary. Voice audio is sent only to the local voice service (STT), not to the LLM provider.

Sage does **not** log API keys or tokens. Keep `.env` out of version control.

---

<a id="deletion-reset"></a>

## 🧹 Deletion / reset

There is no built-in purge command. To delete data:

1. Stop the bot.
2. Delete rows from the relevant tables (or drop the schema) using Postgres tools.
3. Restart the bot.

If you want to prevent future storage, disable logging and/or tracing in `.env`.

---

<a id="redaction"></a>

## 🩹 Redaction

Profile prompts instruct the LLM not to store secrets or PII, but Sage does not apply automatic redaction beyond that prompt. Treat stored summaries and messages as sensitive data.

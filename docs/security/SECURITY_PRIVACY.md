# 🔒 Security & Privacy

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
| Channel messages | `ChannelMessage` | Stored only if `MESSAGE_DB_STORAGE_ENABLED=true`. |
| Ingested attachments | `IngestedAttachment` | Non-image attachment extraction cache (text + metadata) for on-demand retrieval. |
| Channel summaries | `ChannelSummary` | Rolling + profile summaries, plus metadata (topics, decisions, etc.). |
| Relationship edges | `RelationshipEdge` | Probabilistic relationship weights from mentions/replies/voice overlap. |
| Voice sessions | `VoiceSession` | Join/leave session history per user/channel. |
| Admin audits | `AdminAudit` | Records admin command usage with hashed params. |
| Agent traces | `AgentTrace` | Agent selector payload, context packet metadata, and final reply text (if tracing is enabled). |

---

<a id="message-ingestion-controls"></a>

## ⚙️ Message ingestion controls

These settings control what Sage ingests and logs:

- `INGESTION_ENABLED=false` disables message/voice ingestion entirely.
- `INGESTION_MODE=allowlist` limits ingestion to channels listed in `INGESTION_ALLOWLIST_CHANNEL_IDS_CSV`.
- `INGESTION_BLOCKLIST_CHANNEL_IDS_CSV` excludes specific channels.

---

<a id="retention-behavior"></a>

## 🧾 Retention behavior

- **In-memory transcripts** honor:
  - `RAW_MESSAGE_TTL_DAYS`
  - `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL`
- **DB transcripts** are trimmed per channel to `CONTEXT_TRANSCRIPT_MAX_MESSAGES`.
- **Attachment cache** persists extracted non-image file text/metadata in `IngestedAttachment` until deleted manually.
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
- Recent transcript + summaries (if logging is enabled)
- Attachment text blocks for the current turn when inline analysis is needed
- Attachment-cache retrieval results when tool loop calls `channel_file_lookup`
- Image URLs for vision-capable requests

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

# 🔒 Security & Privacy

What Sage stores, how to control retention, and what goes to the upstream AI provider.

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Security-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Security" />
</p>

This document describes what Sage stores and how to control retention. Implementation references include `prisma/schema.prisma` and the ingestion/runtime pipeline under `src/features` and `src/platform`.

> [!IMPORTANT]
> If you run Sage, you are responsible for the data it stores in your database. Review the defaults below and adjust `.env` to match your server’s privacy expectations.

---

## 🧭 Quick navigation

- [✅ What Sage stores (default)](#what-sage-stores-default)
- [⚙️ Message ingestion controls](#message-ingestion-controls)
- [🧾 Retention behavior](#retention-behavior)
- [📤 What is sent to the AI provider](#what-is-sent-to-the-ai-provider)
- [🧹 Deletion / reset](#deletion-reset)
- [🩹 Redaction](#redaction)

---

<a id="what-sage-stores-default"></a>

## ✅ What Sage stores (default)

| Data | Table | Notes |
| --- | --- | --- |
| User profile summaries | `UserProfile` | LLM-generated long-term summary of a user. |
| User profile archives | `UserProfileArchive` | Historical snapshots of user profiles. |
| Guild settings | `GuildSettings` | Stores server-scoped key configuration and governance review routing. |
| Sage Persona | `ServerInstructions` | Admin-authored guild Sage Persona configuration available to the runtime. |
| Sage Persona archives | `ServerInstructionsArchive` | Historical snapshots of Sage Persona updates. |
| Channel messages | `ChannelMessage` | Stored only if `MESSAGE_DB_STORAGE_ENABLED=true`. |
| Ingested attachments | `IngestedAttachment` | Non-image attachment extraction cache (text + metadata) for on-demand retrieval. |
| Channel summaries | `ChannelSummary` | Rolling + profile summaries, plus metadata (topics, decisions, etc.). |
| Approval review requests | `ApprovalReviewRequest` | Approval-gated graph interrupt, reviewer/requester message ids, and status metadata for governed writes. |
| Interaction sessions | `DiscordInteractionSession` | Button/modal session state for Sage-authored interactive controls. |
| Durable task runs | `AgentTaskRun` | Background task-run state, response-session state, wait state, and compaction metadata for long-running work. |
| Admin audits | `AdminAudit` | Records admin action usage with hashed params. |
| Agent traces | `AgentTrace` | Compact runtime ledger with LangSmith references, context budget metadata, and final reply text (when DB trace persistence is enabled). |

---

<a id="message-ingestion-controls"></a>

## ⚙️ Message ingestion controls

These settings control what Sage ingests and logs:

- `INGESTION_ENABLED=false` disables message ingestion entirely.
- `INGESTION_MODE=allowlist` limits ingestion to channels listed in `INGESTION_ALLOWLIST_CHANNEL_IDS_CSV`.
- `INGESTION_BLOCKLIST_CHANNEL_IDS_CSV` excludes specific channels.

---

<a id="retention-behavior"></a>

## 🧾 Retention behavior

- **In-memory transcripts** honor:
  - `RAW_MESSAGE_TTL_DAYS`
  - `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL`
- **DB transcripts** are trimmed per channel to `MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL`.
- **Prompt transcript windows** are selected by message count via `CONTEXT_TRANSCRIPT_MAX_MESSAGES`; Sage no longer applies a second prompt-character truncation pass.
- **Attachment cache** persists extracted non-image file text/metadata in `IngestedAttachment` until deleted manually.
- **Summaries and profiles** persist until deleted manually.
- **Agent traces** are stored only when `SAGE_TRACE_DB_ENABLED=true`.

> [!TIP]
> Want less retained context? Reduce `CONTEXT_TRANSCRIPT_MAX_MESSAGES`, disable DB storage, and/or disable tracing.

---

<a id="what-is-sent-to-the-ai-provider"></a>

## 📤 What is sent to the AI provider

When generating replies, Sage sends:

- The user’s message content
- Reply references (if the user replied to another message)
- Recent transcript and relevant reply context
- User profile summary embedded inside the runtime system prompt
- Guild Sage Persona when guild-specific behavior has been configured
- Bridge-fetched summaries, history windows, or artifact content only when Code Mode requests them through `context.*`, `history.*`, `discord.*`, or `artifacts.*`
- Stored message-history retrieval results when the runtime executes calls such as `history.search(...)`, `history.recent(...)`, or `discord.messages.get(...)`
- Guild-resource metadata when the runtime executes bridge reads such as `discord.channels.get(...)`, `discord.channels.list(...)`, or admin-scoped member/role reads
- Attachment text blocks for the current turn when inline analysis is needed
- Attachment and artifact retrieval results when the runtime executes `artifacts.get(...)` or related bridge reads
- When an approved write requires public HTTP(S) content, Sage fetches that content through `http.fetch(...)` with local/private hosts blocked.
- Image URLs for vision-capable requests

Sage does **not** log API keys or tokens. Keep `.env` out of version control.

---

<a id="deletion-reset"></a>

## 🧹 Deletion / reset

There is no built-in purge UI. To delete data:

1. Stop the bot.
2. Delete rows from the relevant tables (or drop the schema) using Postgres tools.
3. Restart the bot.

If you want to prevent future storage, disable logging and/or tracing in `.env`.

---

<a id="redaction"></a>

## 🩹 Redaction

Profile prompts instruct the LLM not to store secrets or PII, but Sage does not apply automatic redaction beyond that prompt. Treat stored summaries and messages as sensitive data.

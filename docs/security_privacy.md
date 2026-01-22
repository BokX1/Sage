# Security & Privacy

This document describes what Sage stores and how to control retention. The source of truth is `prisma/schema.prisma` and the ingestion pipeline in `src/core`.

## Data stored (by default)

| Data | Table | Notes |
| --- | --- | --- |
| User profile summaries | `UserProfile` | LLM-generated long-term summary of a user. |
| Channel messages | `ChannelMessage` | Stored only if `MESSAGE_DB_STORAGE_ENABLED=true`. |
| Channel summaries | `ChannelSummary` | Rolling + profile summaries, plus metadata (topics, decisions, etc.). |
| Relationship edges | `RelationshipEdge` | Probabilistic relationship weights from mentions/replies/voice overlap. |
| Voice sessions | `VoiceSession` | Join/leave session history per user/channel. |
| Admin audits | `AdminAudit` | Records admin command usage with hashed params. |
| Agent traces | `AgentTrace` | Router/expert data and the final reply text (if tracing is enabled). |

## Message ingestion controls

- `LOGGING_ENABLED=false` disables message/voice ingestion entirely.
- `LOGGING_MODE=allowlist` limits ingestion to channels listed in `LOGGING_ALLOWLIST_CHANNEL_IDS`.
- `LOGGING_BLOCKLIST_CHANNEL_IDS` excludes specific channels.

## Retention behavior

- **In-memory transcripts** honor `RAW_MESSAGE_TTL_DAYS` and `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL`.
- **DB transcripts** are trimmed per channel to `CONTEXT_TRANSCRIPT_MAX_MESSAGES`.
- **Summaries and profiles** persist until deleted manually.
- **Agent traces** are stored only when `TRACE_ENABLED=true`.

## What is sent to the LLM provider

When generating replies, Sage sends:
- The user’s message content.
- Reply references (if the user replied to another message).
- Recent transcript + summaries (if logging is enabled).
- Attachment text blocks for supported text/code files.
- Image URLs for vision-capable requests.

Sage does **not** log API keys or tokens. Keep `.env` out of version control.

## Deletion / reset

There is no built-in purge command. To delete data:
1. Stop the bot.
2. Delete rows from the relevant tables (or drop the schema) using Postgres tools.
3. Restart the bot.

If you need to prevent future storage, disable logging and/or tracing via `.env`.

## Redaction

Profile prompts instruct the LLM not to store secrets or PII, but Sage does not apply automatic redaction beyond that prompt. Treat stored summaries and messages as sensitive data.

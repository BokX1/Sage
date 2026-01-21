# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Added
- _No unreleased changes._

## [2026-01] - 2026-01-18..2026-01-22
### Added
- Discord slash commands for ping, LLM health checks, relationship insights, and admin tools (stats, traces, manual summaries).
- Event ingestion that logs messages/voice activity, updates relationship data, and feeds rolling/channel summaries for context-aware replies.
- Persistent memory primitives backed by Postgres: user profiles, channel summaries, voice sessions, relationship edges, admin audits, and agent traces.
- Router + expert orchestration with trace storage to classify requests and enrich responses with memory, social, voice, and summary context.
- Voice presence/session tracking with analytics helpers for “who is in voice” and “how long today” queries.
- Context budgeting and truncation controls to fit transcripts, summaries, and memory into LLM input limits.

### Changed
- Standardized the LLM integration on Pollinations with configurable per-task model overrides.
- Split LLM timeouts for chat vs. background memory updates to keep responses responsive while allowing longer summarization runs.

### Fixed
- Added Pollinations request safeguards for tool + JSON mode conflicts and retry-on-validation to prevent upstream request failures.

### Upgrade Notes
- Run database migrations to create the initial persistence tables (profiles, summaries, messages, voice sessions, relationship edges, traces, admin audit).
- Ensure required environment variables are set (`DISCORD_TOKEN`, `DISCORD_APP_ID`, `DATABASE_URL`) and configure admin IDs for privileged commands.

# 🧾 Sage Changelog

<p align="center">
  <img src="https://img.shields.io/badge/Format-Keep%20a%20Changelog-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Keep a Changelog" />
  <img src="https://img.shields.io/badge/Versioning-SemVer-green?style=for-the-badge" alt="SemVer" />
</p>

<p align="center">
  <strong>All notable user-facing changes to Sage are tracked here.</strong>
</p>

> [!NOTE]
> This changelog format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 🧭 Quick Navigation

- [Unreleased](#unreleased)
- [1.0.0 (2026-02-28)](#v1-0-0)
- [Release Links](#release-links)

---

## [Unreleased]

### Added

- Unified `discord` tool that consolidates Discord memory, retrieval, analytics, safe interactions, and admin approval workflows behind one action-based interface (including an admin-only REST passthrough for complete Discord API coverage).
- Added multipart file upload support for the admin-only `discord` action `rest`, enabling attachments/files to be uploaded to Discord REST endpoints (for example, posting message attachments).
- Added optional `files` support to `discord` action `messages.send` so Sage can send attachments in normal (non-admin) turns when appropriate (still blocked in autopilot turns).
- Added typed, approval-gated `discord` admin actions for common Discord REST writes (message edit/delete/pin, channel create/edit, role create/edit/delete, member role add/remove).
- Added `discord` action `oauth2.get_bot_invite_url` to generate a bot invite URL using the configured `DISCORD_APP_ID`.
- Added `AGENTIC_TOOL_LOOP_TIMEOUT_MS` to bound total tool-loop wall-clock time per turn (default `120000` ms), reducing long-running orchestration stalls.

### Changed

- Renamed 16 agentic tools and components across the codebase, ensuring explicit purpose (e.g. `web_get_page_text` ➡️ `web_read`, `system_internal_reflection` ➡️ `system_plan`, `'rest'` ➡️ `'discord.api'`). Added rigorous `.describe()` docstrings mapping directly to the underlying schemas for absolute LLM clarity.

- Expanded website `ToolGrid` showcase to explicitly document the full catalog of 34 native Discord capabilities under a unified category, replacing the single placeholder "Discord" item.
- Refactored the onboarding welcome message (`src/bot/handlers/welcomeMessage.ts` and `src/bot/handlers/guildCreate.ts`) to use rich Discord Embeds.
- Replaced individual `discord_*` runtime tools with a single `discord` tool; Discord tool calls must now use `discord` with an `action` field instead of separate tool names.
- Increased default tool-loop throughput by raising `AGENTIC_TOOL_MAX_CALLS_PER_ROUND` (from `3` to `5`) and `AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY` (from `3` to `4`).
- Enabled per-call read-only classification for action-based tools (including `discord`) so safe reads can be deduplicated and parallelized within a round.
- Increased the maximum tool-argument payload size guardrail (from `10KB` to `256KB`) to support multipart uploads and other larger tool payloads.
- Added an explicit `discord` action index (read/write/admin) to the runtime prompt and the `discord` tool description/`help` output so models can reliably discover all supported Discord capabilities.
- Consolidated runtime capability/tool protocol prompting with explicit tool-selection guidance and reasoning protocol instructions, improving first-pass tool routing and reducing malformed tool outputs.
- Hardened tool-result synthesis instructions so model turns treat tool outputs as untrusted external data and ignore embedded instructions.
- Added in-memory observability metrics for tool execution, latency, and cache hit/miss behavior to improve operator visibility into agentic loop performance.

### Fixed

- Updated BYOP key status messaging so servers without a configured key now show setup guidance (`/sage key login` then `/sage key set <your_key>`) instead of claiming shared quota fallback.
- Removed legacy no-key runtime fallback in chat turns: when neither a server key nor `LLM_API_KEY` is configured, Sage now returns explicit setup guidance instead of attempting anonymous provider calls.
- Retried read-only tool calls once on timeout/rate-limit failures to reduce flaky tool-loop errors.
- Automatically retry Discord REST passthrough requests once on HTTP `429` responses, respecting Discord-provided `retry_after` delays (capped).
- Improved tool-call envelope parsing to recover valid `tool_calls` JSON from mixed prose + JSON model outputs, reducing false plain-text fallbacks.
- Preserved model reasoning text alongside native provider tool calls in the serialized tool envelope for better trace/debug context.
- Added TTL expiry to per-turn tool result caching so stale cached reads are naturally evicted during long-running loops.

### Removed

- Removed four unreferenced legacy modules (`src/core/agentRuntime/agent-events.ts`, `src/core/agentRuntime/patterns.ts`, `src/core/config/doctor.ts`, `src/core/voice/index.ts`) to reduce dead maintenance surface and stale internal APIs.

### Security

- Guild-scoped the admin-only `discord rest` passthrough and queued REST writes to prevent cross-guild bot control; blocked bot-wide endpoints (for example, `/users/@me`), blocked dot-segment path traversal, and redacted sensitive fields (for example, webhook tokens) in REST outputs.
- Hardened URL-sourced multipart uploads for `discord rest` by blocking additional non-public IP ranges, validating DNS resolution, and rejecting redirects to private/local hosts.
- Redacted sensitive Discord REST approval/result previews (queries, bodies, signed URLs, tokens) to reduce accidental leakage in channel-visible admin approval messages.

---

<a id="v1-0-0"></a>

## [1.0.0] - 2026-02-28

### Added

- Initial public release of Sage.
- Discord bot foundation with slash commands, interaction handlers, moderation and admin workflows, and operational scripts.
- Agent runtime with tool-call loop, context budgeting, prompt composition, evaluation scoring, telemetry, and replay harness support.
- Message awareness and memory stack, including transcript building, channel summaries, long-term compaction, and profile updates.
- Retrieval and embeddings capabilities for channel messages and file attachments.
- Voice pipeline support, including session tracking, transcription orchestration, overlap tracking, and dedicated voice service scaffolding.
- Social graph modules and integrations for ingestion, analytics, and query workflows.
- Comprehensive test suite (unit and integration) with CI workflows for lint, typecheck, tests, and supply-chain security controls.
- Project documentation across architecture, operations, configuration, security, and release process.

---

<a id="release-links"></a>

## 🔗 Release Links

[Unreleased]: https://github.com/BokX1/Sage/compare/ae988c1...HEAD
[1.0.0]: https://github.com/BokX1/Sage/commit/ae988c1

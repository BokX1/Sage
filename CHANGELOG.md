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

### Changed

- Reorganized tracked config and CI automation around `config/tooling/`, `config/services/`, reusable GitHub Actions gates, pinned Pages actions, and repo-owned Husky/docs scripts, reducing workflow drift and making local and CI validation use the same commands.
- Upgraded agent reasoning protocol from a 3-step (INTENT → PLAN → TOOL CHOICE) loop to a structured 4-step cognitive loop (Pause and Restate → Ground Constraints → Select Tool Path → Verify Before Executing) with a fast-exit clause for trivial queries and an explicit halt gate on failed constraint checks, improving tool-selection accuracy and reducing hallucination.

### Fixed

- Fixed Discord vision inputs: Sage now preserves `image_url` multimodal parts when assembling Pollinations chat requests, so image attachments and replied-to images can be analyzed instead of being silently treated as plain text.
- Fixed direct image URL detection in Discord messages when links are followed by sentence punctuation, so Sage still picks up the image for vision requests.

### Removed

- Removed the "Trust & Quality" section from the website homepage and deleted the `TrustBadges.jsx` component.

### Added

- Added broader Discord vision image detection (stickers, embed images, and direct image URLs) and a default prompt for image-only invocations (mention/wakeword with no text).

- Added explicit exact UTC date and time injection (`current_time_utc`) permanently into the `<agent_state>` XML payload. The agent runtime is now strictly temporally aware at boot, eliminating training-cutoff date hallucination issues without requiring a tool call.

- Unified `discord` tool that consolidates Discord memory, retrieval, analytics, safe interactions, and admin approval workflows behind one action-based interface (including an admin-only REST passthrough for complete Discord API coverage).
- Added multipart file upload support for the admin-only `discord` action `rest`, enabling attachments/files to be uploaded to Discord REST endpoints (for example, posting message attachments).
- Added optional `files` support to `discord` action `messages.send` so Sage can send attachments in normal (non-admin) turns when appropriate (still blocked in autopilot turns).
- Added typed, approval-gated `discord` admin actions for common Discord REST writes (message edit/delete/pin, channel create/edit, role create/edit/delete, member role add/remove).
- Added `discord` action `oauth2.get_bot_invite_url` to generate a bot invite URL using the configured `DISCORD_APP_ID`.
- Added `AGENTIC_TOOL_LOOP_TIMEOUT_MS` to bound total tool-loop wall-clock time per turn (default `120000` ms), reducing long-running orchestration stalls.
- Added unified `web` tool (action-based): `search`, `read`, `extract`, `research` (includes search-result age enrichment and one-shot `research`).
- Added `web` action `read.page` for paged URL reads with continuation tokens, preventing large web pages from becoming all-or-nothing tool results.
- Added unified `github` tool (action-based): repo metadata, code search (with match previews), paged/bulk file reads, issue/PR search, and recent commit listing.
- Added in-memory-only cross-turn tool memoization (`AGENTIC_TOOL_MEMO_*`) with bounded TTL/size and per-call metadata (`latencyMs`, `cacheHit`) to reduce repetitive dereferencing hops.
- Added `system_tool_stats` tool to inspect in-process tool telemetry (latency averages, cache/memo hit rates, failures). Stats are process-local and reset on restart (no Redis/DB).
- Added `workflow` tool (starting with `npm.github_code_search`) to chain npm lookup → GitHub code search in a single tool call, reducing multi-hop latency.
- Added `help` actions to `web`, `github`, and `workflow` tools so the agent can self-discover action schemas and example payloads when validation fails.
- Added Discord retrieval ergonomics: transcript anchors (`msg:<id>`), `messages.search_with_context`, `messages.search_guild`, `messages.user_timeline`, `files.read_attachment` paging, `analytics.top_relationships`, and `sinceHours`/`sinceDays` convenience filters.
- Added runtime tool-result compression: when a tool payload is too large, the runtime injects a compact summary block alongside the truncated raw result to reduce context window pressure.
- Added optional bounded link-following to `web` action `research` (`followLinks` + `followQueue`) for guided research with fewer manual hops.
- Added stable attachment cache references (`attachment:<id>`) in transcript notes so cached file content can be retrieved directly via `discord` action `files.read_attachment`.

### Changed

- Simplified agent-runtime invocation plumbing by removing legacy per-turn `intent`/style-classifier wiring and deriving autopilot/voice behavior directly from invocation mode plus runtime flags, reducing conflicting prompt directives and keeping handler/runtime/script contracts aligned.
- Updated runtime prompt assembly to include `<agent_state>` through the capability prompt block and switched transcript continuity references to `<recent_transcript>`, improving instruction consistency for quote-aware replies.
- Refined Discord capability guidance from static action indexes to a decision-tree selection guide with explicit read/write/admin routing notes, reducing prompt noise while preserving action discoverability.
- Reduced Discord admin-approval clutter: Sage posts a requester-facing status message per queued admin action, edits it with the final outcome (approved/rejected/executed/failed/expired), and auto-deletes the resolved approval card after ~60 seconds (including after restarts).
- Improved tool validation error ergonomics by surfacing schema hints (for tools that support `action=help`) and including retryability metadata in tool-loop error blocks.
- Made tool-call `think` fields optional across the runtime toolset to reduce validation friction and token overhead (still accepted when provided for debugging).
- Refined agent-runtime prompt/context assembly to reduce duplicated Discord guardrails and deprecated context blocks, while clarifying tool-selection guidance (especially timezone/system-time usage), improving first-pass tool routing and lowering prompt noise for operators.

- Cleaned legacy autogenerated comment scaffolding across `src/**` and `tests/**` and replaced temporary inline notes in critical runtime paths with concise intent-focused comments, reducing maintenance noise without changing behavior.

- Hardened ingest retention controls: message ingestion and startup history backfill now sanitize non-finite DB retention limits and fall back to safe transcript defaults, preventing invalid prune limits from degrading transcript persistence.

- Hardened attachment-ingestion repository query guards: attachment indexes and lookup/list limits now sanitize non-finite inputs to safe bounded integers, preventing invalid Prisma `take`/index values from surfacing at runtime.

- Hardened embeddings pipeline guards: attachment search now ignores blank queries and normalizes non-finite `topK` limits to safe defaults, and text chunking now sanitizes invalid chunk size/overlap values to avoid pathological split loops.

- Hardened channel-message RAG limit normalization: lexical/regex/semantic search limits, context window bounds, and history retention caps now sanitize non-finite inputs to safe integers before query execution.

- Hardened chat/runtime scheduling internals: profile update throttling now sanitizes non-finite interval config to a safe minimum, and Kafka publish-drain timeout handles now use non-blocking timers to avoid keeping shutdown open.

- Hardened message-ingest attachment guards: attachment parsing and ingest now sanitize non-finite size/timeout/budget config values to safe integer bounds, and long-lived typing intervals now use non-blocking timers so they cannot prolong process shutdown.

- Hardened social-graph query normalization: invalid/non-finite Memgraph numeric fields are now coerced to safe defaults (`0`/`null`) before response shaping, avoiding unstable graph summaries when upstream metrics are malformed.

- Hardened BYOP key verification timeout handling: Pollinations profile-check abort timers now use non-blocking timer handles so pending key checks do not keep process shutdown open.

- Hardened Postgres→Memgraph migration lifecycle: migration runs now always attempt Kafka producer shutdown in `finally`, preventing lingering producer resources after successful or failed replay runs.

- Hardened voice and Discord REST timer behavior: voice-service request timeouts, voice transcription hard-stop timers, and Discord REST 429 retry backoff waits now use non-blocking timer handles so pending retries/timeouts do not keep process shutdown open.

- Hardened live voice transcript context formatting: non-finite voice context config values now fall back to safe defaults instead of propagating `NaN` into lookback/window calculations.

- Hardened wakeword invocation throttling: cooldown and per-minute limiter settings now sanitize non-finite values to safe defaults, avoiding silent limiter bypass or unstable behavior under malformed runtime config.

- Hardened guild API key persistence in settings: guild key upserts now encrypt once and reuse the same ciphertext for both create/update paths, reducing redundant crypto work per write while preserving secret-at-rest behavior.

- Hardened memory profile update deduplication: trailing history messages are now removed only when author identity matches the expected speaker (bot for assistant reply, current user for user message), preventing accidental context loss when different speakers send identical text.

- Hardened awareness message retention internals: in-memory channel buffers now use linear-time front pruning and guard against invalid negative/non-finite limits, and Prisma-backed recent-message fetches now correctly honor `sinceMs=0`, normalize invalid limits, and coerce nullable `mentionsBot` fields safely.

- Hardened agent-runtime execution internals: tool execution, retry-backoff, and integration fetch timeout timers now use non-blocking handles; tool-call cache constructors now sanitize non-finite limits/TTLs; and tool-call envelope validation now rejects blank tool names earlier for cleaner tool routing.

- Hardened LLM client reliability: circuit-breaker configuration now sanitizes invalid thresholds/timeouts, Pollinations request and retry timers now use non-blocking timer behavior, runtime model-catalog fetch timeout no longer keeps process shutdown open, and schema-call repair retries now preserve system schema instructions for stronger JSON recovery.

- Hardened core utility infrastructure: concurrency queues now avoid `Array.shift` hot-path overhead, timeout normalization now clamps to JavaScript timer-safe bounds, attachment fetch/Tika extraction now use non-blocking timeout timers with clearer timeout diagnostics and early response-body cancellation, and DNS lookups now have bounded timeout protection.

- Hardened shared foundation utilities: timeout/retry helpers now use non-blocking timer behavior, `AppError` construction now preserves proper prototype/stack semantics, secret encryption key parsing is cached per process, and production logging now defaults to structured JSON while keeping pretty logs for interactive development.

- Removed seven unused environment variables from runtime config parsing (`SYSTEM_PROMPT_MAX_TOKENS`, `TOKEN_ESTIMATOR`, `CODING_MAX_OUTPUT_TOKENS`, `SEARCH_MAX_OUTPUT_TOKENS`, `TIMEOUT_SEARCH_MS`, `TIMEOUT_SEARCH_SCRAPER_MS`, `SEARCH_MAX_ATTEMPTS`) and updated docs/templates accordingly, reducing operator confusion from no-op settings.

- Reorganized `.env.example` and local `.env` layout to a single canonical section order, while preserving local-only legacy keys under an explicit retained section for safer upgrades without losing existing operator values.

- Standardized environment-comment structure across config source (`envSchema` group headings), `.env.example`, and local `.env` template sync so operators get consistent units/format guidance without changing runtime behavior.

- Standardized TypeScript documentation coverage across the codebase by adding module headers and exported-symbol JSDoc comments to all `src/**` and `tests/**` TypeScript files, improving maintainability and operator auditability without changing runtime behavior.

- Unified and modernized the agentic tool surface to reduce multi-hop workflows: consolidated legacy web/GitHub tools into the action-based `web` and `github` tools, with smart defaults for paging, bulk ranges, and match previews.

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
- Expanded `npm_info` results with normalized repo hints (`repositoryUrlNormalized`, `githubRepo`) so agents can jump from npm metadata to `github` actions without manual parsing.
- Expanded `stack_overflow_search` with optional accepted-answer body retrieval (`includeAcceptedAnswer`) to reduce follow-up `web.read` hops for common coding fixes.

### Fixed

- Consolidated `PendingAdminAction` message-id columns into the baseline Prisma `init` migration so new environments bootstrap from a single migration file with the current admin-approval schema.
- Fixed `src/scripts/simulate-agentic.ts` to remove stale `intent` payload fields after runtime contract cleanup, restoring `npm run build` compatibility for simulation runs.
- Hardened web content text extraction in agent runtime HTML stripping: script/style block removal now also handles closing tags with trailing whitespace (for example `</script >`, `</style   >`), preventing embedded script/style payload text from leaking into scraped summaries.
- Fixed `npm_info` GitHub repo extraction for packages that use `github:` shorthand repository URLs, improving npm → GitHub tool handoffs and workflows.
- Fixed `github` repo normalization to accept `github:` specifiers and common `owner/repo#...` shorthands for fewer validation failures.
- Hardened agent-runtime HTML entity decoding to single-pass semantics so doubly encoded payloads (for example `&amp;lt;code&amp;gt;`) remain text (`&lt;code&gt;`) instead of being unescaped into synthetic tag-like tokens.
- Simplified profile updater JSON-object extraction logic by removing an unreachable quote-toggle guard, reducing parser complexity without changing extraction behavior.
- Simplified social-graph numeric normalization guards by removing an unreachable null comparison in the `toNumber`-capable object branch, reducing dead-condition noise without changing runtime output.
- Simplified non-public IPv4 classification guards by removing an unreachable limited-broadcast check already covered by the broader `224.0.0.0/4`+ range rule, reducing dead-condition warnings without changing host filtering behavior.
- Updated BYOP key status messaging so servers without a configured key now show setup guidance (`/sage key login` then `/sage key set <your_key>`) instead of claiming shared quota fallback.
- Removed legacy no-key runtime fallback in chat turns: when neither a server key nor `LLM_API_KEY` is configured, Sage now returns explicit setup guidance instead of attempting anonymous provider calls.
- Retried read-only tool calls once on timeout/rate-limit failures to reduce flaky tool-loop errors.
- Improved tool failure transparency by attaching structured error details (HTTP status, provider/host, retry-after where available) to tool results so the runtime can make better recovery decisions.
- Preserved tool-call execution ordering when mixing side-effect and read-only calls so post-write reads cannot race ahead of their writes when parallel read-only execution is enabled.
- Fixed read-only tool deduplication/cache reuse to respect side-effect barriers: identical reads on both sides of a write no longer reuse stale pre-write results, and read-cache reuse is disabled after writes for the remainder of the same turn.
- Fixed tool-result truncation budgeting so summary+raw untrusted-data payload blocks stay within configured per-tool output limits, improving context-window predictability for operators.
- Automatically retry Discord REST passthrough requests once on HTTP `429` responses, respecting Discord-provided `retry_after` delays (capped).
- Improved tool-call envelope parsing to recover valid `tool_calls` JSON from mixed prose + JSON model outputs, reducing false plain-text fallbacks.
- Preserved model reasoning text alongside native provider tool calls in the serialized tool envelope for better trace/debug context.
- Added TTL expiry to per-turn tool result caching so stale cached reads are naturally evicted during long-running loops.

### Removed

- Removed legacy replay/evaluation tooling end-to-end: deleted npm commands (`agentic:seed-replay-data`, `eval:run`, `eval:gate`, `release:agentic-check`), removed associated scripts/runtime modules/tests/env surfaces, and folded `AgentEvaluation` removal into the baseline migration so fresh environments migrate with a single file. Operators should remove any automation or runbooks that still invoke these commands.
- Removed legacy agentic simulation/tuning tooling end-to-end: deleted `src/scripts/simulate-agentic.ts` and `src/scripts/tune-agentic.ts`, removed npm commands (`agentic:simulate`, `agentic:tune`), and dropped all `SIM_*` / `TUNE_*` environment template-schema references from active operator docs.
- Removed four unreferenced legacy modules (`src/core/agentRuntime/agent-events.ts`, `src/core/agentRuntime/patterns.ts`, `src/core/config/doctor.ts`, `src/core/voice/index.ts`) to reduce dead maintenance surface and stale internal APIs.
- Removed legacy agentic tool names `web_search`, `web_read`, `web_scrape`, `github_repo`, `github_get_file`, `github_search_code` in favor of unified `web` and `github` action-based tools.

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

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

- Added a premium Discord-native governance surface for approval-gated actions: compact requester status cards now stay in the source channel, detailed reviewer cards can route to a dedicated governance review channel, rejections collect a short modal reason, and admin-only details move into an explicit `Details` view instead of the default message body.
- Added persistent governance review routing metadata, including a new guild-level `approvalReviewChannelId` setting plus separate source/review channel tracking on pending admin actions, so approval cards, requester updates, coalescing, and restart-safe cleanup can operate across hybrid review surfaces.
- Added a commandless interactive Discord UX layer: Sage can now emit stateful Components V2 buttons, launch modal-backed follow-up flows, persist interaction sessions, and continue chat turns from Sage-authored component clicks instead of relying on slash-command entrypoints.
- Added a non-model bootstrap path for hosted Pollinations BYOP recovery, including admin-only setup-card buttons and a secure modal flow to set, check, or clear the current guild server key even when Sage has no usable provider key yet.
- Added a dedicated `discord_voice` routed tool for live voice presence control so Sage can report voice status, join the invoker's current voice channel, and leave the active guild voice channel through normal chat turns.

### Changed

- Aligned prompt-side reserved output budgeting with Sage's real chat response cap, so context assembly no longer over-reserves output tokens beyond what Discord chat turns can actually generate.
- Tightened Sage's base prompt for busy shared channels so it now prioritizes the current speaker over adjacent unrelated users, treats `<recent_transcript>` as ambient room context instead of default task state, and reads `<reply_reference>` as evidence to inspect rather than permission to assume the whole prior thread.
- Tightened Sage's Discord admin prompt surface so server-instruction updates are now consistently taught as governance/config changes to Sage's behavior while moderation is taught as separate enforcement on users, messages, reactions, or content; reply-targeted "delete this" cleanup now points Sage toward `discord_admin.submit_moderation`, while direct `discord_admin.delete_message` is framed as non-moderation maintenance.
- Hard-cut the development schema and governance persistence model: Prisma now uses a single clean baseline with required `sourceChannelId` and `reviewChannelId` fields on pending admin actions, and the server-instructions storage surface is now named `ServerInstructions` / `ServerInstructionsArchive` with `instructionsText` end to end.
- Reworked approval-gated Discord governance end to end around shared Components V2 cards, hybrid requester/reviewer routing, and dedicated `discord_admin` review-channel management actions, while preserving the existing `pending_approval` runtime contract and same-turn retry suppression.
- Hardened the single-agent runtime around silent native tool use: Sage no longer exposes reasoning-facing tool surfaces like `system_plan`/`think`, no longer persists provider reasoning text into new traces, and now scrubs tool/approval protocol chatter out of visible Discord replies before sending.
- Tightened approval-gated admin workflows so equivalent unresolved server-instruction updates, moderation requests, and Discord REST writes now coalesce onto one pending approval/action ID instead of spawning duplicate cards, while the tool loop stops retrying the same approval-gated write again after `pending_approval`.
- Made Sage fully chat-first in Discord: primary invocation is now wake word, mention, reply, and Sage-authored interactive follow-ups, while onboarding, welcome messaging, and hosted BYOP setup now direct operators to the in-chat setup card flow instead of slash commands.
- Reworked Discord Components V2 delivery so action-row buttons can carry Sage-managed interactive actions, with session-backed custom IDs created at send time and routed back into the runtime on button click or modal submit.
- Removed `applications.commands` from the default invite scope and deleted the unused `DEV_GUILD_ID` config surface, aligning invite generation and runtime configuration with the now-commandless Discord app surface.
- Updated runtime docs, onboarding guides, deployment/runbook copy, website onboarding, and native tool metadata to reflect commandless setup, `discord_voice`, interactive Components V2, and the hosted setup-card BYOP flow.
- Added a fifth routed Discord domain tool, `discord_server`, so Sage can now inspect guild channels, roles, threads, scheduled events, AutoMod rules, and permission snapshots through typed actions instead of falling back to raw admin REST reads for common server workflows.
- Reassigned canonical thread ownership to `discord_server` and expanded the immediate Discord interaction path with typed thread lifecycle actions (`create_thread`, `update_thread`, `join_thread`, `leave_thread`, `add_thread_member`, `remove_thread_member`), completing the thread-surface migration away from `discord_messages`.
- Reworked the agent runtime around native structured tool calls end-to-end: LLM responses now carry `text`, `toolCalls`, `reasoningText`, and usage separately, the runtime no longer teaches or parses JSON tool-call envelopes, and trace payloads now record tool rounds, rebudgeting, finalization behavior, and cancellation outcomes for better operator debugging.
- Tightened the Phase 1/2 release candidate around the new runtime/tool surface: Pollinations retries now stop immediately on cancellation and now fail malformed provider tool-call argument JSON explicitly instead of degrading to empty args, top-level `AgentTrace.reasoningText` now reflects the real provider/tool-loop reasoning captured during the turn, `discord_server.list_threads` now rejects archived-thread requests that omit `parentChannelId`, the public agent-runtime export surface now includes the shipped `discord_server` and `discord_voice` tools, and the remaining runtime/docs wording now consistently describes native provider tool calls instead of the retired JSON-envelope protocol.
- Added explicit per-round context rebudgeting before follow-up model calls and propagated cancellation signals through the main web, GitHub, workflow, npm, and Pollinations-backed long-running integrations, reducing stuck tool chains and making runtime timeouts stop upstream work instead of only timing out locally.
- Rebuilt the deep trust gate around mutation-tested critical guardrails instead of broad unscoped files: `check:mutation` now targets logging policy and invocation/chat rate-limiters with deterministic boundary-focused tests, so passing `check:trust:deep` reflects behavior-level protection against trivial test workarounds.
- Expanded the mutation-scored trust gate to include shared timeout/retry and typed-error utilities (`timeout`, `resilience`, `AppError`) with strict deterministic tests, increasing guardrail depth for runtime failure handling while keeping the gate enforceable in CI.
- Hardened the critical trust suite with boundary and timer-behavior assertions across logging/rate-limit/invocation/resilience/timeout error paths, raising the critical mutation score from 81.97% to 90.98% so trust-gate passes now reflect stronger behavior-level guarantees instead of permissive happy-path checks.
- Completed a second trust-hardening pass that drives the critical mutation score to 96.72% and tightens Stryker enforcement thresholds to `break: 95` (`low: 95`, `high: 97`), so regressions in guardrail behavior now fail the mutation gate much earlier.
- Finalized critical trust hardening with semantic cleanups in rate limiting, invocation cooldown math, timer unref handling, and timeout normalization so the scoped mutation suite now reaches and enforces `100%` (`high/low/break` all `100`) under `check:mutation`.
- Hardened trust-gate testing quality checks: `test:audit` now understands parameterized `it.each`/`test.each` cases, reports matcher-strength metrics, and fails tests that rely only on weak assertions by default; the previously weak boolean-only tests were upgraded to stronger behavioral assertions so green builds better reflect real runtime confidence.
- Re-architected the `web` tool usage prompt to explicitly forbid sequential reading ping-pong. The capability and anti-pattern prompts now strongly enforce batching parallel `action=read` calls within a single JSON payload and prioritize `action=research` for broad open-ended questions, drastically reducing excessive conversational turn consumption.
- Clarified Sage's provider story across onboarding and operations copy: README/docs/website now describe self-hosting as OpenAI-compatible and provider-flexible, while Discord command/help/welcome/startup messaging explicitly scopes Pollinations to the current built-in BYOP, hosted/default, and image-generation paths so operators no longer get conflicting setup guidance.
- Re-licensed Sage under the MIT License and removed the prior PolyForm Strict/commercial-license messaging from the root license file, package metadata, contributor guidance, docs, and website content/structured metadata so the repository now presents one consistent open-source license contract end to end.
- Removed the last two prompt-model contradictions from Sage’s Discord tooling contract: the static system prompt now stays capability-agnostic when Discord tools are absent, and `discord_admin.api` is now taught and enforced as a fully admin-only fallback instead of a mixed non-admin/admin surface.
- Renamed the split Discord routed-tool actions to short local names, so Sage now sees and learns `discord_context.get_channel_summary`, `discord_messages.send`, `discord_files.read_attachment`, and `discord_admin.api` instead of redundant repeated namespaces like `messages.send` or `files.read_attachment`, reducing tool-selection ambiguity across prompt guidance, help payloads, tests, and website demos.
- Finished the Discord presentation-model cleanup so Sage now teaches and validates only `plain` and `components_v2` `messages.send` payloads, attachment cache system notes now point the model at `discord_files` action syntax instead of the removed monolithic `discord files.*` wording, and the shared send-message schema contract now lives in a neutral Discord module rather than being owned by the admin action service.
- Completed the Discord tool-surface cleanup behind Sage’s routed tool model: the split `discord_context`, `discord_messages`, `discord_files`, and `discord_admin` tools now execute through a shared internal Discord core instead of forwarding into a hidden legacy `discord` wrapper; routed-tool help payloads now use a fully standardized snake_case contract shape; prompt routing for Discord domains is generated from the same tool-doc metadata as help; and the website/demo traces now show the split Discord tool names and actions that operators actually expose to the model.
- Reworked Sage’s model-facing tool mental model around routed tool domains and generated help contracts: the provider-exposed `discord` monolith has been replaced with `discord_context`, `discord_messages`, `discord_files`, and `discord_admin`; routed tools now return structured action contracts with purpose/defaults/restrictions/examples/common mistakes; and the runtime prompt now distinguishes schema-first direct tools from routed tools with `help`, improving first-pass tool selection and reducing malformed Discord calls.
- Clarified the routed Discord tool mental model end to end so Sage now sees stronger distinctions between instruction reads vs instruction writes, summary context vs exact message windows, file discovery vs guild-resource inspection, voice analytics vs live voice control, admin-only reads vs public reads, and typed admin actions vs raw `discord_admin.api` fallback.
- Renamed Sage’s prompt-facing memory labels into explicit profile and instruction surfaces: the system prompt now injects `<user_profile>` and `<server_instructions>`, Discord tool actions now use `profile.*`, `summary.*`, and `instructions.*` naming, and admin-facing server-persona configuration is described as server instructions instead of generic memory.
- Tightened Sage’s prompt contract so the base persona, execution rules, and Discord admin payloads now use the same vocabulary: prompt guidance now spells out precedence between current input, server instructions, user profile, and transcript continuity, treats `<recent_transcript>` as continuity rather than message-history evidence, and renames server-instruction tool payload fields away from legacy `memory*` labels.
- Finished the prompt-semantics cleanup across prompt text, tool help, tests, and contributor docs: `server_instructions` now explicitly yield to hard rules and runtime guardrails, `summary.get_channel` is described as rolling channel summary context rather than a profile/evidence surface, and docs now map quote-level verification to `messages.search_history`, `messages.search_with_context`, and `messages.get_context` while documenting the legacy `GuildMemory` storage names kept for migration safety.
- Aligned the long-term user-profile contract with Sage’s current mental model: stored profiles now normalize to `<preferences>`, `<active_focus>`, and `<background>`, prompt injection now describes the profile as soft/stale best-effort preference context, profile updates can incorporate replied/reference text, and malformed profile summaries are rejected instead of being persisted.
- Finished the user-profile mental-model wording pass: the profile updater now talks about stable interaction preferences instead of user rules, explicitly treats stored profiles as best-effort/stale personalization, and the profile tool/docs now describe active focus as useful but fallible rather than authoritative.
- Closed the last prompt-boundary ambiguities in Sage’s runtime context model: current turns are now always wrapped as `<user_input>` even for multimodal payloads, reply/reference carry-forward is explicitly tagged as `<assistant_context>` and `<reply_reference>`, server instructions now explicitly govern Sage behavior rather than factual truth, and channel/profile tool wording now consistently describes best-effort personalization and summary context rather than authority or evidence.
- Refined Sage’s runtime prompt contract so `<agent_state>` is now a compact turn-state block (time, tools, invocation, voice/autopilot mode, and tool-loop limits) while behavior guidance stays in `<execution_rules>` and `<tool_selection_guide>`, reducing duplicated prompt state and making runtime facts easier for operators to reason about.
- Recast Sage’s in-product runtime identity around a guild-native “strategist-host” role, sharpening its Discord channel etiquette, server-context awareness, and richer Discord-native presentation guidance so operators get responses that better fit live server workflows instead of generic assistant behavior.
- Expanded Sage’s Discord operating contract so the prompt and `discord` tool now explicitly teach when to use `messages.send` presentation modes versus raw Discord REST, while opening safe guild-scoped `discord.api` GET reads to non-admin turns and keeping mutating REST calls admin-gated.
- Condensed Sage’s runtime prompt stack so the base persona and tool-guidance layers carry fewer duplicated rules, preserve the stable `<execution_rules>`/`<agent_state>` contract, clarify that tool `think` fields are optional, and align reply-length guidance with the existing automatic Discord message splitting behavior.
- Reorganized the codebase into a feature-first layout under `src/app`, `src/features`, `src/platform`, `src/shared`, and `src/cli`, mirrored the new ownership model across `tests/**`, and moved the self-hosted social-graph stack to `config/services/self-host/` plus `services/social-graph/` so operators and contributors can navigate runtime, tooling, and service assets with one consistent structure while keeping existing npm entrypoints stable.
- Realigned the tracked documentation with the current single-agent runtime, tool catalog, invite flow, config surface, and compose stacks, removing stale hosted-bot, Ollama, and legacy social-graph automation guidance so operators can follow the checked-in docs without code drift.
- Reorganized tracked config and CI automation around `config/tooling/`, `config/services/`, reusable GitHub Actions gates, pinned Pages actions, and repo-owned Husky/docs scripts, reducing workflow drift and making local and CI validation use the same commands.
- Upgraded agent reasoning protocol from a 3-step (INTENT → PLAN → TOOL CHOICE) loop to a structured 4-step cognitive loop (Pause and Restate → Ground Constraints → Select Tool Path → Verify Before Executing) with a fast-exit clause for trivial queries and an explicit halt gate on failed constraint checks, improving tool-selection accuracy and reducing hallucination.

### Fixed

- Fixed a runtime leak where Sage could narrate internal tool usage, parrot recovery coaching, or echo approval payloads/action commands into chat replies instead of keeping approval acknowledgements short and operator-friendly.
- Fixed flaky docs-link CI runs caused by intermittent aborts when validating the external contributor image at `contrib.rocks`; the tracked docs gate now skips that decorative image URL instead of failing otherwise healthy pushes.
- Fixed a rare Discord runtime leak where array-wrapped `tool_calls` payloads, including server-instruction update requests, could be sent to chat as raw JSON instead of being executed and finalized into a normal reply.
- Fixed Discord vision inputs: Sage now preserves `image_url` multimodal parts when assembling Pollinations chat requests, so image attachments and replied-to images can be analyzed instead of being silently treated as plain text.
- Fixed direct image URL detection in Discord messages when links are followed by sentence punctuation, so Sage still picks up the image for vision requests.
- Fixed attachment-memory parity for uploaded Discord images: logged-channel image attachments are now cached like other attachments, indexed from local Florence recall/OCR text, and can be resent later with `discord` action `files.send_attachment` while returning the same stored grounding text to the model.
- Fixed the Florence image-recall loader wiring: Sage now uses the Transformers.js Florence-compatible auto-model class, so both Hugging Face repo IDs and local filesystem snapshots can be loaded for image attachment recall.
- Fixed attachment recall resilience and resend targeting: timed-out Florence cold starts no longer poison later retries, historical mixed-attachment rows no longer refresh to the wrong live file when resending, and uncached image uploads no longer consume per-message file-ingest slots in channels without persistent attachment caching.
- Fixed Discord message citations from history/context lookups: channel-scoped raw-message results now expose `guildId` alongside `channelId`/`messageId`, and DM jump-link placeholders now use Discord’s `@me` token so generated message URLs resolve reliably.
- Fixed the tracked docs gate for Pollinations auth setup docs: link validation now skips the interactive `enter.pollinations.ai/authorize` OAuth URL so `npm run check:docs` no longer fails on a login-only endpoint.
- Fixed flaky trust-gate coverage around social-graph fallback and message-create ingest tests by resetting handler/module state explicitly instead of relying on slow or order-sensitive module reloads, making repeated/shuffled validation runs more reliable.

### Removed

- Removed the last development-only governance compatibility shims and storage aliases, including legacy `PendingAdminAction.channelId`, `GuildMemory` / `GuildMemoryArchive`, `memoryText`, and the governance plain-text downgrade path.
- Removed the user-facing slash-command surface (`/ping`, `/join`, `/leave`, `/sage key ...`, `/sage admin stats`) along with command registration and the old command-handler paths, so Discord interaction routing is now focused on chat, buttons, and modals.
- Removed the final `discord_messages.create_thread` compatibility alias from the routed-tool contract so `discord_server.create_thread` is the only canonical thread-creation path end to end.
- Removed the last legacy interactive Discord message path (`legacy_components`) from Sage’s model-facing tool surface and runtime execution contract, so operators no longer have a stale third presentation mode that conflicts with the split-tool mental model.
- Removed the last internal legacy `discord` tool module and old monolith-named test surfaces, so the checked-in runtime, tests, and website no longer describe a singular provider-facing Discord tool shape.
- Removed the dead `sage-command-handlers` helper/test path and the unused local `cert` CLI entrypoint, trimming leftover development-era surfaces from the commandless Discord build so the repository only carries supported runtime and operator flows.
- Removed the "Trust & Quality" section from the website homepage and deleted the `TrustBadges.jsx` component.

### Added

- Added validated `messages.send` presentation modes for plain text, legacy interactive replies, and constrained Discord Components V2 layouts, including runtime rendering, attachment-aware schema checks, and safe fallback back to plain text when a Components V2 send cannot be delivered.
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
- Refactored the onboarding welcome message (`src/app/discord/handlers/welcomeMessage.ts` and `src/app/discord/handlers/guildCreate.ts`) to use rich Discord Embeds.
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
- Fixed `src/cli/simulate-agentic.ts` to remove stale `intent` payload fields after runtime contract cleanup, restoring `npm run build` compatibility for simulation runs.
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
- Removed legacy agentic simulation/tuning tooling end-to-end: deleted `src/cli/simulate-agentic.ts` and `src/cli/tune-agentic.ts`, removed npm commands (`agentic:simulate`, `agentic:tune`), and dropped all `SIM_*` / `TUNE_*` environment template-schema references from active operator docs.
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

[Unreleased]: https://github.com/BokX1/Sage/compare/ae988c1...master
[1.0.0]: https://github.com/BokX1/Sage/commit/ae988c1

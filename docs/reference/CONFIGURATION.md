# ⚙️ Configuration Reference

All runtime settings are configured in `.env` and validated by `src/shared/config/env.ts`.

<p align="center">
  <img src="https://img.shields.io/badge/Variables-80+-blue?style=flat-square" alt="Variables" />
  <img src="https://img.shields.io/badge/Validated-Zod-orange?style=flat-square" alt="Validated" />
  <img src="https://img.shields.io/badge/Source-.env-green?style=flat-square" alt="Source" />
</p>

> [!TIP]
> After changing `.env`, restart Sage so configuration is reloaded.

---

## Quick Navigation

- [How to Use This Page](#how-to-use-this-page)
- [Essential (Required)](#essential-required)
- [Runtime and Model Configuration](#runtime-and-model-configuration)
- [Behavior and Triggering](#behavior-and-triggering)
- [Agentic Runtime Governance](#agentic-runtime-governance)
- [Replay Gate Controls](#replay-gate-controls)
- [Message Ingestion and Retention](#message-ingestion-and-retention)
- [Channel Summaries](#channel-summaries)
- [Context Budgeting](#context-budgeting)
- [Rate Limits and Timeouts](#rate-limits-and-timeouts)
- [Admin Access and Observability](#admin-access-and-observability)
- [Example `.env` Snippet](#example-env-snippet)

---

<a id="how-to-use-this-page"></a>

## ✅ How to Use This Page

- Keep required values valid first.
- Start with `.env.example` defaults, then tune only what your server needs.
- For route/tool/critic behavior, adjust Agentic Runtime Governance settings.

### 🎯 Priority Configuration (Most Impactful)

| Priority | Variable | Why It Matters |
| :--- | :--- | :--- |
| 🔴 Required | `DISCORD_TOKEN`, `DATABASE_URL` | Bot won't start without these |
| 🟠 High | `CHAT_MODEL`, `AUTOPILOT_MODE` | Core behavior and model selection |
| 🟡 Medium | `ADMIN_USER_IDS_CSV`, `TRACE_ENABLED` | Observability and admin access |
| 🟢 Optional | Context budgets, canary settings | Fine-tuning for advanced users |

---

<a id="essential-required"></a>

## 🔴 Essential (Required)

| Variable | Description | Example |
| :--- | :--- | :--- |
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal | `MTIz...abc` |
| `DISCORD_APP_ID` | Discord application ID | `1234567890123456789` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/sage?schema=public` |
| `SECRET_ENCRYPTION_KEY` | 64-hex key for encrypting stored API keys | `0123...abcd` |

---

<a id="runtime-and-model-configuration"></a>

## 🤖 Runtime and Model Configuration

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `NODE_ENV` | Runtime mode (`development`, `production`, `test`) | `production` |
| `LLM_PROVIDER` | Provider id (currently `pollinations`) | `pollinations` |
| `LLM_BASE_URL` | Chat API base URL | `https://gen.pollinations.ai/v1` |
| `LLM_IMAGE_BASE_URL` | Image API base URL | `https://gen.pollinations.ai` |
| `CHAT_MODEL` | Base chat model (route resolver may select alternates) | `openai-large` |
| `LLM_API_KEY` | Optional global fallback key | *(empty)* |
| `LLM_MODEL_LIMITS_JSON` | Optional model limit map (JSON string) | `""` |
| `PROFILE_PROVIDER` | Optional profile-provider override | *(empty)* |
| `PROFILE_CHAT_MODEL` | Profile analysis model | `deepseek` |
| `SUMMARY_MODEL` | Channel summary model | `openai-large` |
| `FORMATTER_MODEL` | JSON formatter model | `qwen-coder` |

### Routing Temperature Policy (Built In)

These values are currently code-level policy (not `.env` knobs):

- Router model runs at `0.1` temperature for stable classification.
- Chat responses use router-provided temperature, clamped to `1.0` - `1.4`.
- Chat default/fallback temperature is `1.2`.
- If router omits non-chat temperatures, defaults are `coding=0.2`, `search=0.3`, `creative=1.0`.
- Critic evaluation uses fixed `0.1` temperature.

---

<a id="behavior-and-triggering"></a>

## 💬 Behavior and Triggering

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `WAKE_WORDS_CSV` | Trigger words at start of message | `sage` |
| `WAKE_WORD_PREFIXES_CSV` | Optional prefixes before wake word | *(empty)* |
| `AUTOPILOT_MODE` | `manual`, `reserved`, or `talkative` | `manual` |
| `PROFILE_UPDATE_INTERVAL` | Messages between background profile updates | `5` |
| `WAKEWORD_COOLDOWN_SEC` | Per-user cooldown between responses | `10` |
| `WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL` | Per-channel response cap per minute | `6` |
| `PROACTIVE_POSTING_ENABLED` | Enables autonomous posting behavior | `true` |

Autopilot modes:

| Mode | Behavior |
| :--- | :--- |
| `manual` | Replies only on wake word, mention, or reply |
| `reserved` | Selectively joins when likely useful |
| `talkative` | More proactive participation |

---

<a id="agentic-runtime-governance"></a>

## Agentic Runtime Governance

These settings control graph execution, tool policy, critic behavior, canary rollout, and per-tenant overrides.

Search execution mode (`simple` vs `complex`) is selected turn-by-turn by the router and is not currently exposed as an environment variable. If router output is invalid or missing, runtime applies a deterministic heuristic fallback (direct lookups bias to `simple`, multi-step/comparison prompts bias to `complex`).

### Graph + Tool + Critic + Tenant Policy

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `AGENTIC_GRAPH_PARALLEL_ENABLED` | Allow parallel context-provider execution | `true` |
| `AGENTIC_GRAPH_MAX_PARALLEL` | Max concurrent graph nodes | `2` |
| `AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE` | Allow external side-effect tools | `false` |
| `AGENTIC_TOOL_ALLOW_HIGH_RISK` | Allow high-risk tools | `false` |
| `AGENTIC_TOOL_BLOCKLIST_CSV` | Comma-separated blocked tools | `join_voice_channel,leave_voice_channel` |
| `AGENTIC_TOOL_POLICY_JSON` | Optional global policy object (`allowNetworkRead`, `allowDataExfiltrationRisk`, `blockedTools`, `riskOverrides`) merged with legacy flags and tenant overrides | *(empty)* |
| `AGENTIC_TOOL_LOOP_ENABLED` | Enable iterative tool-call loop for chat/coding routes when tools are registered | `true` |
| `AGENTIC_TOOL_HARD_GATE_ENABLED` | Enforce tool-backed evidence on freshness/source-sensitive turns | `true` |
| `AGENTIC_TOOL_HARD_GATE_MIN_SUCCESSFUL_CALLS` | Minimum successful tool calls required when hard gate triggers | `1` |
| `AGENTIC_TOOL_MAX_ROUNDS` | Max tool-call rounds per turn | `2` |
| `AGENTIC_TOOL_MAX_CALLS_PER_ROUND` | Max tool calls in one round | `3` |
| `AGENTIC_TOOL_TIMEOUT_MS` | Per-tool execution timeout | `45000` |
| `AGENTIC_TOOL_MAX_OUTPUT_TOKENS` | Max model output tokens during tool-loop turns | `1200` |
| `AGENTIC_TOOL_RESULT_MAX_CHARS` | Max serialized chars per tool result block fed back to the model | `4000` |
| `AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED` | Execute multiple read-only tool calls in parallel | `true` |
| `AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY` | Max concurrent read-only tool executions | `3` |
| `AGENTIC_CRITIC_ENABLED` | Enable bounded critic loops | `true` |
| `AGENTIC_CRITIC_MIN_SCORE` | Critic threshold before revision | `0.82` |
| `AGENTIC_CRITIC_MAX_LOOPS` | Max critic revisions | `2` |
| `AGENTIC_VALIDATORS_ENABLED` | Enable deterministic response validators before trace finalization | `true` |
| `AGENTIC_VALIDATION_POLICY_JSON` | Optional route-level validator policy overrides (`strictness`, `checkUnsupportedCertainty`, `checkSearchSourceUrls`, etc.) | *(empty)* |
| `AGENTIC_VALIDATION_AUTO_REPAIR_ENABLED` | Attempt one bounded corrective repair pass on blocking validation failures | `true` |
| `AGENTIC_VALIDATION_AUTO_REPAIR_MAX_ATTEMPTS` | Max validation repair attempts per turn (0-1) | `1` |
| `AGENTIC_MANAGER_WORKER_ENABLED` | Enable manager-worker decomposition for complex coding/search turns | `false` |
| `AGENTIC_MANAGER_WORKER_MAX_WORKERS` | Max worker tasks run per manager-worker pass | `3` |
| `AGENTIC_MANAGER_WORKER_MAX_PLANNER_LOOPS` | Max planner loops per turn | `1` |
| `AGENTIC_MANAGER_WORKER_MAX_TOKENS` | Max output tokens per worker response | `900` |
| `AGENTIC_MANAGER_WORKER_MAX_INPUT_CHARS` | Max total input chars budgeted into each worker prompt | `32000` |
| `AGENTIC_MANAGER_WORKER_TIMEOUT_MS` | Timeout per worker response | `60000` |
| `AGENTIC_MANAGER_WORKER_MIN_COMPLEXITY_SCORE` | Minimum complexity score (0-1) required to trigger manager-worker on coding route | `0.55` |
| `AGENTIC_TENANT_POLICY_JSON` | JSON registry for `default` and per-guild overrides (graph, critic, tool-policy flags/blocklist/riskOverrides, model allowlist) | `{}` |

Hard-gate behavior summary:

- `search`: runs tool-first and requires tool evidence; if unmet, Sage refuses to return unverified claims.
- `chat`/`coding`: hard gate triggers on freshness/source/version-sensitive prompts, can force a second tool-backed pass, and refuses unverified output if still unmet.

### Canary + Rollback

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `AGENTIC_CANARY_ENABLED` | Enable rollout/error-budget guardrails | `true` |
| `AGENTIC_CANARY_PERCENT` | % of eligible turns using graph path | `100` |
| `AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV` | Routes eligible for agentic graph | `chat,coding,search,creative` |
| `AGENTIC_CANARY_MAX_FAILURE_RATE` | Failure rate threshold for cooldown | `0.20` |
| `AGENTIC_CANARY_MIN_SAMPLES` | Min samples before budget evaluation | `50` |
| `AGENTIC_CANARY_COOLDOWN_SEC` | Cooldown duration after breach | `300` |
| `AGENTIC_CANARY_WINDOW_SIZE` | Rolling sample window | `250` |
| `AGENTIC_PERSIST_STATE_ENABLED` | Persist canary/model-health state in DB; auto-fallback to memory if DB unavailable | `true` |

---

<a id="replay-gate-controls"></a>

## Replay Gate Controls

Used by `npm run agentic:replay-gate` and release checks.

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `REPLAY_GATE_LIMIT` | Number of recent traces evaluated | `200` |
| `REPLAY_GATE_MIN_AVG_SCORE` | Minimum average score (0-1) | `0.65` |
| `REPLAY_GATE_MIN_SUCCESS_RATE` | Minimum success ratio (0-1) | `0.75` |
| `REPLAY_GATE_MIN_TOOL_EXECUTION_RATE` | Minimum ratio of traces with tools executed (0-1) | `0.00` |
| `REPLAY_GATE_MAX_HARD_GATE_FAILURE_RATE` | Maximum ratio of unmet hard-gated traces (0-1) | `1.00` |
| `REPLAY_GATE_REQUIRE_DATA` | Fail when no traces exist (`1`/`0`) | `1` |
| `REPLAY_GATE_MIN_TOTAL` | Minimum trace count before pass allowed | `10` |
| `REPLAY_GATE_REQUIRED_ROUTES_CSV` | Routes that must have coverage | `chat,coding,search,creative` |
| `REPLAY_GATE_MIN_ROUTE_SAMPLES` | Minimum samples per required route | `1` |
| `REPLAY_GATE_ROUTE_THRESHOLDS_JSON` | Optional per-route threshold overrides (`minAvgScore`, `minSuccessRate`, `minToolExecutionRate`, `maxHardGateFailureRate`, `minSamples`) | *(empty)* |
| `REPLAY_GATE_GUILD_ID` | Optional guild scope | *(empty)* |
| `REPLAY_GATE_CHANNEL_ID` | Optional channel scope | *(empty)* |

Evaluation run / gate knobs:

| Variable | Description | Typical |
| :--- | :--- | :--- |
| `EVAL_RUN_LIMIT` | Number of traces to evaluate in one `eval:run` pass | `40` |
| `EVAL_RUN_CONCURRENCY` | Concurrent judge pipelines for `eval:run` | `2` |
| `EVAL_RUN_REQUIRE_DATA` | Fail `eval:run` if no eligible traces (`1`/`0`) | `1` |
| `EVAL_RUN_CLEANUP_EXISTING` | Delete prior rows for same trace/rubric before insert (`1`/`0`) | `1` |
| `EVAL_RUN_FAIL_ON_ERROR` | Fail script when any trace evaluation errors (`1`/`0`) | `1` |
| `EVAL_RUN_RUBRIC_VERSION` | Rubric id recorded with each evaluation row | `v1` |
| `EVAL_RUN_TIMEOUT_MS` | Judge model timeout per pass | `120000` |
| `EVAL_RUN_MAX_TOKENS` | Judge model max output tokens | `1200` |
| `EVAL_RUN_GUILD_ID` | Optional guild scope | *(empty)* |
| `EVAL_RUN_CHANNEL_ID` | Optional channel scope | *(empty)* |
| `EVAL_RUN_ROUTES_CSV` | Optional route filter (`chat,coding,search,creative`) | *(empty)* |
| `EVAL_RUN_OUTPUT_JSON` | Optional output artifact path | *(empty)* |
| `EVAL_RUN_API_KEY` | Optional override API key for judge calls | *(empty)* |
| `EVAL_RUN_PRIMARY_MODEL` | Optional primary judge model override | *(empty)* |
| `EVAL_RUN_SECONDARY_MODEL` | Optional secondary judge model override | *(empty)* |
| `EVAL_RUN_ADJUDICATOR_MODEL` | Optional adjudicator judge model override | *(empty)* |
| `EVAL_GATE_LIMIT` | Number of recent evaluation rows to gate | `60` |
| `EVAL_GATE_REQUIRE_DATA` | Fail `eval:gate` when no rows (`1`/`0`) | `1` |
| `EVAL_GATE_MIN_TOTAL` | Minimum evaluation rows required | `1` |
| `EVAL_GATE_RUBRIC_VERSION` | Rubric version filter for gate query | `v1` |
| `EVAL_GATE_MIN_AVG_SCORE` | Minimum average judge score | `0.75` |
| `EVAL_GATE_MIN_PASS_RATE` | Minimum `pass` verdict rate | `0.70` |
| `EVAL_GATE_MAX_DISAGREEMENT_RATE` | Maximum primary/secondary disagreement rate | `0.40` |
| `EVAL_GATE_MIN_CONFIDENCE` | Minimum average judge confidence | `0.50` |
| `EVAL_GATE_GUILD_ID` | Optional guild scope | *(empty)* |
| `EVAL_GATE_CHANNEL_ID` | Optional channel scope | *(empty)* |
| `EVAL_GATE_ROUTE_KIND` | Optional route scope | *(empty)* |
| `EVAL_GATE_LATEST_PER_TRACE` | Deduplicate to latest row per trace before gating (`1`/`0`) | `1` |
| `EVAL_GATE_REQUIRED_ROUTES_CSV` | Routes that must meet route-level thresholds | *(empty)* |
| `EVAL_GATE_MIN_ROUTE_SAMPLES` | Minimum rows per required route | `1` |
| `EVAL_GATE_ROUTE_THRESHOLDS_JSON` | Optional per-route overrides (`minAvgScore`, `minPassRate`, `maxDisagreementRate`, `minConfidence`, `minSamples`) | *(empty)* |

Simulation/tuning self-judge knobs:

| Variable | Description | Typical |
| :--- | :--- | :--- |
| `SIM_JUDGE_ENABLED` | Enable model-as-judge scoring during `agentic:simulate` | `1` |
| `SIM_JUDGE_WEIGHT` | Blend weight for judge score vs heuristic score (0-1) | `0.55` |
| `SIM_REQUIRE_JUDGE_RESULTS` | Fail simulation if judge produced no scored rows | `1` |
| `SIM_MIN_JUDGE_AVG_SCORE` | Optional minimum average judge score | `0.68` |
| `SIM_MAX_JUDGE_REVISE_RATE` | Optional maximum judge revise-rate | `0.45` |
| `TUNE_JUDGE_ENABLED` | Enable judge path in `agentic:tune` variant sweeps | `1` |
| `TUNE_JUDGE_WEIGHT` | Passed to simulation judge weight for tuning runs | `0.55` |

---

<a id="message-ingestion-and-retention"></a>

## 📥 Message Ingestion and Retention

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `INGESTION_ENABLED` | Enable message/voice ingestion | `true` |
| `INGESTION_MODE` | `all` or `allowlist` | `all` |
| `INGESTION_ALLOWLIST_CHANNEL_IDS_CSV` | Channels to include in allowlist mode | *(empty)* |
| `INGESTION_BLOCKLIST_CHANNEL_IDS_CSV` | Channels to exclude | *(empty)* |
| `MESSAGE_DB_STORAGE_ENABLED` | Persist messages to `ChannelMessage` table | `true` |
| `MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL` | Per-channel DB retention cap (separate from prompt transcript cap) | `500` |
| `RAW_MESSAGE_TTL_DAYS` | In-memory transcript retention days | `3` |
| `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` | In-memory transcript size cap | `200` |
| `CONTEXT_TRANSCRIPT_MAX_MESSAGES` | Transcript message cap per prompt | `15` |
| `CONTEXT_TRANSCRIPT_MAX_CHARS` | Transcript char cap per prompt | `24000` |
| `FILE_INGEST_TIKA_BASE_URL` | Apache Tika server base URL used for document extraction | `http://127.0.0.1:9998` |
| `FILE_INGEST_TIMEOUT_MS` | Timeout for file fetch + extraction operations | `45000` |
| `FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE` | Maximum non-image attachments processed from one Discord message | `4` |
| `FILE_INGEST_MAX_BYTES_PER_FILE` | Hard byte cap per attachment before extraction | `10485760` |
| `FILE_INGEST_MAX_TOTAL_BYTES_PER_MESSAGE` | Combined byte cap across processed attachments per message | `20971520` |
| `FILE_INGEST_OCR_ENABLED` | Enable OCR in Tika extraction flow (`true`/`false`) | `false` |

Attachment ingestion behavior:

- Non-image files are extracted and cached in `IngestedAttachment` rows (per channel/message).
- Transcript/message history stores cache notes, not full file bodies, to avoid prompt replay bloat.
- Runtime retrieves cached file content on demand via `channel_file_lookup` during tool loops.

For attachment ingestion, start Tika with:

```bash
docker compose -f config/ci/docker-compose.yml up -d tika
```

---

<a id="channel-summaries"></a>

## 📊 Channel Summaries

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `SUMMARY_ROLLING_WINDOW_MIN` | Rolling summary window (minutes) | `60` |
| `SUMMARY_ROLLING_MIN_MESSAGES` | Min new messages before summary | `20` |
| `SUMMARY_ROLLING_MIN_INTERVAL_SEC` | Min seconds between rolling summaries | `300` |
| `SUMMARY_PROFILE_MIN_INTERVAL_SEC` | Min seconds between profile summaries | `21600` |
| `SUMMARY_MAX_CHARS` | Max chars in summary output | `1800` |
| `SUMMARY_SCHED_TICK_SEC` | Scheduler tick interval | `60` |

---

<a id="context-budgeting"></a>

## 🧠 Context Budgeting

### Global

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `CONTEXT_MAX_INPUT_TOKENS` | Max input token budget | `120000` |
| `CONTEXT_RESERVED_OUTPUT_TOKENS` | Reserved output tokens | `12000` |
| `SYSTEM_PROMPT_MAX_TOKENS` | System prompt budget | `12000` |
| `CONTEXT_USER_MAX_TOKENS` | User block budget | `60000` |
| `CHAT_MAX_OUTPUT_TOKENS` | Max reply tokens for chat turns | `1800` |
| `CODING_MAX_OUTPUT_TOKENS` | Max reply tokens for coding turns | `4200` |
| `SEARCH_MAX_OUTPUT_TOKENS` | Max reply tokens for search turns | `2000` |
| `CRITIC_MAX_OUTPUT_TOKENS` | Max output tokens for critic assessments | `1800` |

### Block Budgets

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` | Transcript budget | `20000` |
| `CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY` | Rolling summary budget | `12000` |
| `CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY` | Profile summary budget | `12000` |
| `CONTEXT_BLOCK_MAX_TOKENS_MEMORY` | Memory block budget | `12000` |
| `CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT` | Reply/intention context budget | `8000` |
| `CONTEXT_BLOCK_MAX_TOKENS_PROVIDERS` | Context packets budget | `12000` |

### Estimation

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `TOKEN_ESTIMATOR` | Token estimation mode | `heuristic` |
| `TOKEN_HEURISTIC_CHARS_PER_TOKEN` | Chars-per-token estimate | `4` |
| `CONTEXT_TRUNCATION_NOTICE` | Emit truncation hints in context | `true` |

---

<a id="rate-limits-and-timeouts"></a>

## 🔒 Rate Limits and Timeouts

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `RATE_LIMIT_MAX` | Max responses per window | `5` |
| `RATE_LIMIT_WINDOW_SEC` | Rate-limit window seconds | `10` |
| `TIMEOUT_CHAT_MS` | Chat/model request timeout | `180000` |
| `TIMEOUT_SEARCH_MS` | Search-pass timeout baseline (normal search models) | `90000` |
| `TIMEOUT_SEARCH_SCRAPER_MS` | Search-pass timeout for scraper model (`nomnom`) | `150000` |
| `TIMEOUT_MEMORY_MS` | User/channel memory provider timeout (`UserMemory`, `ChannelMemory`) | `300000` |
| `SEARCH_MAX_ATTEMPTS_SIMPLE` | Max guarded search model attempts when router picks simple search mode | `2` |
| `SEARCH_MAX_ATTEMPTS_COMPLEX` | Max guarded search model attempts when router picks complex search mode | `4` |
| `TOOL_WEB_SEARCH_TIMEOUT_MS` | External web-search tool timeout | `45000` |
| `TOOL_WEB_SEARCH_MAX_RESULTS` | Max returned results from `web_search` retrieval providers | `6` |
| `TOOL_WEB_SCRAPE_TIMEOUT_MS` | External web-scrape tool timeout | `45000` |
| `TOOL_WEB_SCRAPE_PROVIDER_ORDER` | Ordered provider chain for `web_scrape` (`firecrawl,crawl4ai,jina,raw_fetch`) | `firecrawl,crawl4ai,jina,raw_fetch` |
| `TOOL_WEB_SCRAPE_MAX_CHARS` | Max extracted chars returned by web-scrape tool | `12000` |

---

<a id="external-tool-providers"></a>

## External Tool Providers

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `TOOL_WEB_SEARCH_PROVIDER_ORDER` | Ordered provider chain for `web_search` tool (`tavily,exa,searxng,pollinations`) | `tavily,exa,searxng,pollinations` |
| `TAVILY_API_KEY` | Tavily API key for high-quality web retrieval | *(empty)* |
| `EXA_API_KEY` | Exa API key for semantic web retrieval | *(empty)* |
| `SEARXNG_BASE_URL` | Optional SearXNG base URL (self-hosted search aggregation) | *(empty)* |
| `SEARXNG_SEARCH_PATH` | SearXNG search path (usually `/search`) | `/search` |
| `SEARXNG_CATEGORIES` | SearXNG categories parameter | `general` |
| `SEARXNG_LANGUAGE` | SearXNG language parameter | `en-US` |
| `FIRECRAWL_API_KEY` | Firecrawl API key for robust page extraction | *(empty)* |
| `FIRECRAWL_BASE_URL` | Firecrawl API base URL | `https://api.firecrawl.dev/v1` |
| `CRAWL4AI_BASE_URL` | Optional Crawl4AI base URL (self-hosted scraping fallback) | *(empty)* |
| `CRAWL4AI_BEARER_TOKEN` | Optional bearer token for Crawl4AI endpoint | *(empty)* |
| `JINA_READER_BASE_URL` | Jina reader base URL used by scrape fallback | `https://r.jina.ai/http://` |
| `GITHUB_TOKEN` | Optional GitHub token for higher API limits | *(empty)* |
| `OLLAMA_BASE_URL` | Local Ollama base URL for private/offline infer tools | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Default local Ollama model for `local_llm_infer` | `llama3.1:8b` |

Self-host-first profile (with hosted fallback):

```env
TOOL_WEB_SEARCH_PROVIDER_ORDER=searxng,tavily,exa,pollinations
TOOL_WEB_SCRAPE_PROVIDER_ORDER=crawl4ai,firecrawl,jina,raw_fetch
SEARXNG_BASE_URL=http://127.0.0.1:8080
CRAWL4AI_BASE_URL=http://127.0.0.1:11235
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Run local services with:

```bash
docker compose -f config/self-host/docker-compose.tools.yml up -d
```

Validate with:

```bash
npm run tools:smoke
```

---

<a id="admin-access-and-observability"></a>

## 👑 Admin Access and Observability

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `ADMIN_ROLE_IDS_CSV` | Roles with admin access | *(empty)* |
| `ADMIN_USER_IDS_CSV` | Users with admin access | *(empty)* |
| `TRACE_ENABLED` | Persist runtime traces | `true` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `DEV_GUILD_ID` | Dev guild for instant command registration | *(empty)* |
| `LLM_DOCTOR_PING` | Enable LLM ping during `npm run doctor` (`1`/`0`) | `0` |

---

<a id="example-env-snippet"></a>

## 📝 Example `.env` Snippet

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_app_id_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/sage?schema=public
SECRET_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

LLM_PROVIDER=pollinations
LLM_BASE_URL=https://gen.pollinations.ai/v1
LLM_IMAGE_BASE_URL=https://gen.pollinations.ai
CHAT_MODEL=openai-large
LLM_API_KEY=

AUTOPILOT_MODE=manual
WAKE_WORDS_CSV=sage
TRACE_ENABLED=true

CONTEXT_MAX_INPUT_TOKENS=120000
CONTEXT_RESERVED_OUTPUT_TOKENS=12000
SYSTEM_PROMPT_MAX_TOKENS=12000
CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT=20000
CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY=12000
CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY=12000
CONTEXT_BLOCK_MAX_TOKENS_MEMORY=12000
CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT=8000
CONTEXT_BLOCK_MAX_TOKENS_PROVIDERS=12000
CONTEXT_USER_MAX_TOKENS=60000
CHAT_MAX_OUTPUT_TOKENS=1800
CODING_MAX_OUTPUT_TOKENS=4200
SEARCH_MAX_OUTPUT_TOKENS=2000
CRITIC_MAX_OUTPUT_TOKENS=1800

FILE_INGEST_TIKA_BASE_URL=http://127.0.0.1:9998
FILE_INGEST_TIMEOUT_MS=45000
FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE=4
FILE_INGEST_MAX_BYTES_PER_FILE=10485760
FILE_INGEST_MAX_TOTAL_BYTES_PER_MESSAGE=20971520
FILE_INGEST_OCR_ENABLED=false

AGENTIC_GRAPH_PARALLEL_ENABLED=true
AGENTIC_GRAPH_MAX_PARALLEL=2
AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE=false
AGENTIC_TOOL_ALLOW_HIGH_RISK=false
AGENTIC_TOOL_BLOCKLIST_CSV=join_voice_channel,leave_voice_channel
AGENTIC_TOOL_POLICY_JSON=
AGENTIC_TOOL_LOOP_ENABLED=true
AGENTIC_TOOL_HARD_GATE_ENABLED=true
AGENTIC_TOOL_HARD_GATE_MIN_SUCCESSFUL_CALLS=1
AGENTIC_TOOL_MAX_ROUNDS=2
AGENTIC_TOOL_MAX_CALLS_PER_ROUND=3
AGENTIC_TOOL_TIMEOUT_MS=45000
AGENTIC_TOOL_MAX_OUTPUT_TOKENS=1200
AGENTIC_TOOL_RESULT_MAX_CHARS=4000
AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED=true
AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY=3
AGENTIC_CRITIC_ENABLED=true
AGENTIC_CRITIC_MIN_SCORE=0.82
AGENTIC_CRITIC_MAX_LOOPS=2
AGENTIC_VALIDATORS_ENABLED=true
AGENTIC_VALIDATION_POLICY_JSON=
AGENTIC_VALIDATION_AUTO_REPAIR_ENABLED=true
AGENTIC_VALIDATION_AUTO_REPAIR_MAX_ATTEMPTS=1
AGENTIC_MANAGER_WORKER_ENABLED=false
AGENTIC_MANAGER_WORKER_MAX_WORKERS=3
AGENTIC_MANAGER_WORKER_MAX_PLANNER_LOOPS=1
AGENTIC_MANAGER_WORKER_MAX_TOKENS=900
AGENTIC_MANAGER_WORKER_MAX_INPUT_CHARS=32000
AGENTIC_MANAGER_WORKER_TIMEOUT_MS=60000
AGENTIC_MANAGER_WORKER_MIN_COMPLEXITY_SCORE=0.55
AGENTIC_CANARY_ENABLED=true
AGENTIC_CANARY_PERCENT=100
AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV=chat,coding,search,creative
AGENTIC_PERSIST_STATE_ENABLED=true
AGENTIC_TENANT_POLICY_JSON={}

TIMEOUT_CHAT_MS=180000
TIMEOUT_SEARCH_MS=90000
TIMEOUT_SEARCH_SCRAPER_MS=150000
TIMEOUT_MEMORY_MS=300000
SEARCH_MAX_ATTEMPTS_SIMPLE=2
SEARCH_MAX_ATTEMPTS_COMPLEX=4
TOOL_WEB_SEARCH_PROVIDER_ORDER=tavily,exa,searxng,pollinations
TOOL_WEB_SEARCH_TIMEOUT_MS=45000
TOOL_WEB_SEARCH_MAX_RESULTS=6
TOOL_WEB_SCRAPE_PROVIDER_ORDER=firecrawl,crawl4ai,jina,raw_fetch
TOOL_WEB_SCRAPE_TIMEOUT_MS=45000
TOOL_WEB_SCRAPE_MAX_CHARS=12000
TAVILY_API_KEY=
EXA_API_KEY=
SEARXNG_BASE_URL=
SEARXNG_SEARCH_PATH=/search
SEARXNG_CATEGORIES=general
SEARXNG_LANGUAGE=en-US
FIRECRAWL_API_KEY=
FIRECRAWL_BASE_URL=https://api.firecrawl.dev/v1
CRAWL4AI_BASE_URL=
CRAWL4AI_BEARER_TOKEN=
JINA_READER_BASE_URL=https://r.jina.ai/http://
GITHUB_TOKEN=
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b

REPLAY_GATE_LIMIT=200
REPLAY_GATE_MIN_AVG_SCORE=0.65
REPLAY_GATE_MIN_SUCCESS_RATE=0.75
REPLAY_GATE_MIN_TOOL_EXECUTION_RATE=0.00
REPLAY_GATE_MAX_HARD_GATE_FAILURE_RATE=1.00
REPLAY_GATE_REQUIRE_DATA=1
REPLAY_GATE_MIN_TOTAL=10
REPLAY_GATE_REQUIRED_ROUTES_CSV=chat,coding,search,creative
REPLAY_GATE_MIN_ROUTE_SAMPLES=1
```

---

## 🔄 Common Migration Examples

When upgrading or changing your setup, use these as a diff reference:

<details>
<summary><strong>Switch from development to production</strong></summary>

```diff
-NODE_ENV=development
+NODE_ENV=production
-LOG_LEVEL=debug
+LOG_LEVEL=info
-DEV_GUILD_ID=123456789
+DEV_GUILD_ID=
```

</details>

<details>
<summary><strong>Enable canary rollouts</strong></summary>

```diff
-AGENTIC_CANARY_ENABLED=false
+AGENTIC_CANARY_ENABLED=true
+AGENTIC_CANARY_PERCENT=25
+AGENTIC_CANARY_MAX_FAILURE_RATE=0.30
```

</details>

<details>
<summary><strong>Enable full observability</strong></summary>

```diff
-TRACE_ENABLED=false
+TRACE_ENABLED=true
+LOG_LEVEL=info
+ADMIN_USER_IDS_CSV=YOUR_DISCORD_ID
```

</details>

---

## 🔗 Related Documentation

- [Getting Started](../guides/GETTING_STARTED.md)
- [Model Reference](MODELS.md)
- [Pollinations Integration](POLLINATIONS.md)
- [Memory System](../architecture/MEMORY.md)
- [Operations Runbook](../operations/RUNBOOK.md)

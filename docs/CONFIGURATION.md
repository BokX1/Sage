# ⚙️ Configuration Reference

All runtime settings are configured in `.env` and validated by `src/shared/config/env.ts`.

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

Search execution mode (`simple` vs `complex`) is selected turn-by-turn by the router and is not currently exposed as an environment variable. If router output is invalid or missing for search mode, runtime falls back to `complex`.

### Graph + Tool + Critic + Tenant Policy

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `AGENTIC_GRAPH_PARALLEL_ENABLED` | Allow parallel context-provider execution | `true` |
| `AGENTIC_GRAPH_MAX_PARALLEL` | Max concurrent graph nodes | `2` |
| `AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE` | Allow external side-effect tools | `false` |
| `AGENTIC_TOOL_ALLOW_HIGH_RISK` | Allow high-risk tools | `false` |
| `AGENTIC_TOOL_BLOCKLIST_CSV` | Comma-separated blocked tools | `join_voice_channel,leave_voice_channel` |
| `AGENTIC_CRITIC_ENABLED` | Enable bounded critic loops | `true` |
| `AGENTIC_CRITIC_MIN_SCORE` | Critic threshold before revision | `0.78` |
| `AGENTIC_CRITIC_MAX_LOOPS` | Max critic revisions | `1` |
| `AGENTIC_TENANT_POLICY_JSON` | JSON registry for `default` and per-guild overrides | `{}` |

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

---

<a id="replay-gate-controls"></a>

## Replay Gate Controls

Used by `npm run agentic:replay-gate` and release checks.

| Variable | Description | `.env.example` |
| :--- | :--- | :--- |
| `REPLAY_GATE_LIMIT` | Number of recent traces evaluated | `200` |
| `REPLAY_GATE_MIN_AVG_SCORE` | Minimum average score (0-1) | `0.65` |
| `REPLAY_GATE_MIN_SUCCESS_RATE` | Minimum success ratio (0-1) | `0.75` |
| `REPLAY_GATE_REQUIRE_DATA` | Fail when no traces exist (`1`/`0`) | `1` |
| `REPLAY_GATE_MIN_TOTAL` | Minimum trace count before pass allowed | `10` |
| `REPLAY_GATE_REQUIRED_ROUTES_CSV` | Routes that must have coverage | `chat,coding,search,creative` |
| `REPLAY_GATE_MIN_ROUTE_SAMPLES` | Minimum samples per required route | `1` |
| `REPLAY_GATE_GUILD_ID` | Optional guild scope | *(empty)* |
| `REPLAY_GATE_CHANNEL_ID` | Optional channel scope | *(empty)* |

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
| `RAW_MESSAGE_TTL_DAYS` | In-memory transcript retention days | `3` |
| `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` | In-memory transcript size cap | `200` |
| `CONTEXT_TRANSCRIPT_MAX_MESSAGES` | Transcript message cap per prompt | `15` |
| `CONTEXT_TRANSCRIPT_MAX_CHARS` | Transcript char cap per prompt | `12000` |

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
| `TIMEOUT_CHAT_MS` | Chat/model request timeout | `300000` |
| `TIMEOUT_MEMORY_MS` | Memory/summarization timeout | `600000` |

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

AGENTIC_GRAPH_PARALLEL_ENABLED=true
AGENTIC_GRAPH_MAX_PARALLEL=2
AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE=false
AGENTIC_TOOL_ALLOW_HIGH_RISK=false
AGENTIC_TOOL_BLOCKLIST_CSV=join_voice_channel,leave_voice_channel
AGENTIC_CRITIC_ENABLED=true
AGENTIC_CRITIC_MIN_SCORE=0.78
AGENTIC_CRITIC_MAX_LOOPS=1
AGENTIC_CANARY_ENABLED=true
AGENTIC_CANARY_PERCENT=100
AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV=chat,coding,search,creative
AGENTIC_TENANT_POLICY_JSON={}

REPLAY_GATE_LIMIT=200
REPLAY_GATE_MIN_AVG_SCORE=0.65
REPLAY_GATE_MIN_SUCCESS_RATE=0.75
REPLAY_GATE_REQUIRE_DATA=1
REPLAY_GATE_MIN_TOTAL=10
REPLAY_GATE_REQUIRED_ROUTES_CSV=chat,coding,search,creative
REPLAY_GATE_MIN_ROUTE_SAMPLES=1
```

---

## 🔗 Related Documentation

- [Getting Started](GETTING_STARTED.md)
- [Pollinations Integration](POLLINATIONS.md)
- [Memory System](architecture/memory_system.md)
- [Operations Runbook](operations/runbook.md)

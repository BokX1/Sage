# ⚙️ Configuration Reference

A complete reference for Sage configuration. All settings are configured in your `.env` file and loaded through a single validated config module (`src/shared/config/env.ts`). Do not access `process.env` directly in runtime modules.

> [!TIP]
> After changing `.env`, restart Sage for settings to take effect.

---

## Quick Navigation

- [How to Use This Page](#how-to-use-this-page)
- [Essential (Required)](#essential-required)
- [AI Models](#ai-models)
- [Behavior & Agentic Triggers](#behavior-agentic-triggers)
- [Agentic Runtime Governance](#agentic-runtime-governance)
- [Message Ingestion & Storage](#message-ingestion-storage)
- [Channel Summaries](#channel-summaries)
- [Context Budgeting](#context-budgeting)
- [Relationship Graph](#relationship-graph)
- [Rate Limits & Timeouts](#rate-limits-timeouts)
- [Admin Access Control](#admin-access-control)

---

<a id="how-to-use-this-page"></a>

## ✅ How to Use This Page

- **Required** settings are the minimum needed for Sage to start.
- Most users can keep defaults and only adjust **Behavior**, **Admin Access**, and **Logging/Retention**.
- If you’re new to `.env` files, start with the example at the bottom and edit from there.

---

<a id="essential-required"></a>

## 🔴 Essential (Required)

These settings are required for Sage to start.

| Variable | Description | Example |
| :--- | :--- | :--- |
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal | `MTIz...abc` |
| `DISCORD_APP_ID` | Discord application ID | `1234567890123456789` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/sage?schema=public` |

---

<a id="ai-models"></a>

## 🤖 AI Models

Sage uses specialized models for different tasks.

### Primary Configuration

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LLM_PROVIDER` | AI provider | `pollinations` |
| `LLM_BASE_URL` | API endpoint | `https://gen.pollinations.ai/v1` |
| `LLM_IMAGE_BASE_URL` | Image generation endpoint | `https://gen.pollinations.ai` |
| `CHAT_MODEL` | Primary chat model (Sage automatically switches to `kimi` for coding/reasoning tasks) | `gemini-fast` |
| `LLM_API_KEY` | Global LLM key. Optional fallback (useful for self-hosting). We recommend **BYOP** (server-wide keys) for communities. | *(empty)* |

### Specialized System Models

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PROFILE_PROVIDER` | Provider override for profile analysis | *(empty)* |
| `PROFILE_CHAT_MODEL` | Model for user profile analysis | `deepseek` |
| `SUMMARY_MODEL` | Model for channel summaries | `openai-large` |
| `FORMATTER_MODEL` | Model for reliable JSON formatting | `qwen-coder` |

### Model Limits

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LLM_MODEL_LIMITS_JSON` | Custom token limits per model (JSON string) | *(empty)* |

---

<a id="behavior-agentic-triggers"></a>

## 💬 Behavior & Agentic Triggers

Control how Sage responds in chat.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `WAKE_WORDS_CSV` | Words that trigger Sage at start of message | `sage` |
| `WAKE_WORD_PREFIXES_CSV` | Optional prefixes (e.g., “hey sage”) | *(empty)* |
| `AUTOPILOT_MODE` | Response mode: `manual`, `reserved`, or `talkative` | `manual` |
| `PROFILE_UPDATE_INTERVAL` | Messages between background profile updates | `5` |
| `WAKEWORD_COOLDOWN_SEC` | Cooldown per user between responses (seconds) | `20` |
| `WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL` | Max responses per minute per channel | `6` |

### Autopilot Modes Explained

| Mode | Behavior | API Usage |
| :--- | :--- | :--- |
| `manual` | Responds only on wake word, @mention, or reply | 🟢 **Low** |
| `reserved` | Occasionally joins relevant conversations | 🟡 **Medium** |
| `talkative` | Actively participates without prompts | 🔴 **High** |

---

<a id="agentic-runtime-governance"></a>

## Agentic Runtime Governance

These settings control the planner/executor safety rails, per-tenant overrides, and rollout behavior.

### Graph, Tool, Critic, and Tenant Overrides

| Variable | Description | Default |
| :--- | :--- | :--- |
| `AGENTIC_GRAPH_PARALLEL_ENABLED` | Enables parallel graph execution when dependencies allow | `true` |
| `AGENTIC_GRAPH_MAX_PARALLEL` | Upper bound for concurrent graph nodes | `3` |
| `AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE` | Allows tools with external side effects | `false` |
| `AGENTIC_TOOL_ALLOW_HIGH_RISK` | Allows high-risk tools | `false` |
| `AGENTIC_TOOL_BLOCKLIST_CSV` | Comma-separated blocked tool names | *(empty)* |
| `AGENTIC_CRITIC_ENABLED` | Enables bounded critic loops | `false` |
| `AGENTIC_CRITIC_MIN_SCORE` | Critic score threshold before revision | `0.72` |
| `AGENTIC_CRITIC_MAX_LOOPS` | Max critic-driven revisions | `1` |
| `AGENTIC_TENANT_POLICY_JSON` | JSON policy registry for `default` and per-`guilds` overrides (max parallel, critic, tool policy, allowed models) | `{}` |

### Canary and Rollback Controls

| Variable | Description | Default |
| :--- | :--- | :--- |
| `AGENTIC_CANARY_ENABLED` | Enables rollout sampling and error-budget guardrails | `true` |
| `AGENTIC_CANARY_PERCENT` | Percent of eligible traffic that uses agentic graph execution (0-100) | `100` |
| `AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV` | Comma-separated routes eligible for agentic execution | `chat,coding,search,art,analyze,manage` |
| `AGENTIC_CANARY_MAX_FAILURE_RATE` | Failure-rate threshold that trips cooldown | `0.30` |
| `AGENTIC_CANARY_MIN_SAMPLES` | Minimum samples before evaluating failure rate | `50` |
| `AGENTIC_CANARY_COOLDOWN_SEC` | Cooldown duration after error-budget breach | `900` |
| `AGENTIC_CANARY_WINDOW_SIZE` | Rolling sample window size for failure-rate checks | `250` |

### Replay Gate Controls

Used by `npm run agentic:replay-gate` (and CI release readiness).

| Variable | Description | Default |
| :--- | :--- | :--- |
| `REPLAY_GATE_LIMIT` | Number of recent traces evaluated | `200` |
| `REPLAY_GATE_MIN_AVG_SCORE` | Minimum average replay score (0-1) | `0.65` |
| `REPLAY_GATE_MIN_SUCCESS_RATE` | Minimum success-likely ratio (0-1) | `0.75` |
| `REPLAY_GATE_REQUIRE_DATA` | Fails gate when no traces exist (`1`/`0`) | `1` |
| `REPLAY_GATE_GUILD_ID` | Optional guild scope for evaluation | *(empty)* |
| `REPLAY_GATE_CHANNEL_ID` | Optional channel scope for evaluation | *(empty)* |

---

<a id="message-ingestion-storage"></a>

## 📥 Message Ingestion & Storage

Control what Sage logs and stores.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `INGESTION_ENABLED` | Enable message/voice ingestion | `true` |
| `INGESTION_MODE` | `all` or `allowlist` | `all` |
| `INGESTION_ALLOWLIST_CHANNEL_IDS_CSV` | Comma-separated channel IDs to log (if allowlist) | *(empty)* |
| `INGESTION_BLOCKLIST_CHANNEL_IDS_CSV` | Comma-separated channel IDs to exclude | *(empty)* |
| `MESSAGE_DB_STORAGE_ENABLED` | Persist messages to database | `true` |
| `PROACTIVE_POSTING_ENABLED` | Allow autonomous message posting | `true` |

### Retention Settings

| Variable | Description | Default |
| :--- | :--- | :--- |
| `RAW_MESSAGE_TTL_DAYS` | In-memory transcript retention (days) | `3` |
| `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` | Max messages in memory per channel | `200` |
| `CONTEXT_TRANSCRIPT_MAX_MESSAGES` | Max recent messages included in the transcript window (used in prompts) | `15` |
| `CONTEXT_TRANSCRIPT_MAX_CHARS` | Max characters per transcript block | `12000` |

---

<a id="channel-summaries"></a>

## 📊 Channel Summaries

Configure automatic channel summarization.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `SUMMARY_ROLLING_WINDOW_MIN` | Rolling window duration (minutes) | `60` |
| `SUMMARY_ROLLING_MIN_MESSAGES` | Min messages before triggering summary | `20` |
| `SUMMARY_ROLLING_MIN_INTERVAL_SEC` | Min seconds between summaries | `300` |
| `SUMMARY_PROFILE_MIN_INTERVAL_SEC` | Min seconds between profile summaries | `21600` (6h) |
| `SUMMARY_MAX_CHARS` | Max characters per summary | `4000` in `.env.example`, `1800` in runtime defaults when unset |
| `SUMMARY_SCHED_TICK_SEC` | Summary scheduler tick interval | `60` |

---

<a id="context-budgeting"></a>

## 🧠 Context Budgeting

Control token allocation for LLM requests.

### Global Limits

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CONTEXT_MAX_INPUT_TOKENS` | Total input token budget | `65536` |
| `CONTEXT_RESERVED_OUTPUT_TOKENS` | Reserved tokens for output | `8192` |
| `SYSTEM_PROMPT_MAX_TOKENS` | Max tokens for system prompt | `6000` |
| `CONTEXT_USER_MAX_TOKENS` | Max tokens for user message | `24000` |

### Block Budgets

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` | Budget for raw transcript | `8000` |
| `CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY` | Budget for rolling summary | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY` | Budget for profile summary | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_MEMORY` | Budget for memory data | `6000` |
| `CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT` | Budget for reply context | `3200` |
| `CONTEXT_BLOCK_MAX_TOKENS_EXPERTS` | Budget for expert packets | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS` | Budget for relationship hints | `2400` |

### Token Estimation

| Variable | Description | Default |
| :--- | :--- | :--- |
| `TOKEN_ESTIMATOR` | Token counting method | `heuristic` |
| `TOKEN_HEURISTIC_CHARS_PER_TOKEN` | Characters per token estimate | `4` |
| `CONTEXT_TRUNCATION_NOTICE` | Show truncation notice in context | `true` |

---

<a id="relationship-graph"></a>

## 🤝 Relationship Graph

Tune social relationship calculations.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `RELATIONSHIP_HINTS_MAX_EDGES` | Max relationship edges to include | `10` |
| `RELATIONSHIP_DECAY_LAMBDA` | Time decay factor | `0.06` |
| `RELATIONSHIP_WEIGHT_K` | Weight scaling constant | `0.2` |
| `RELATIONSHIP_CONFIDENCE_C` | Confidence scaling constant | `0.25` |

---

<a id="rate-limits-timeouts"></a>

## 🔒 Rate Limits & Timeouts

Prevent spam and manage latency.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `RATE_LIMIT_MAX` | Max responses per window | `5` |
| `RATE_LIMIT_WINDOW_SEC` | Window duration (seconds) | `10` |
| `TIMEOUT_CHAT_MS` | Timeout for chat requests | `300000` (5 min) |
| `TIMEOUT_MEMORY_MS` | Timeout for memory operations | `600000` (10 min) |

---

<a id="admin-access-control"></a>

## 👑 Admin Access Control

| Variable | Description | Default |
| :--- | :--- | :--- |
| `ADMIN_ROLE_IDS_CSV` | Comma-separated role IDs with admin access | *(empty)* |
| `ADMIN_USER_IDS_CSV` | Comma-separated user IDs with admin access | *(empty)* |

---

## 🔍 Observability & Debugging

| Variable | Description | Default |
| :--- | :--- | :--- |
| `NODE_ENV` | `development`, `production`, `test` | `development` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `TRACE_ENABLED` | Store processing traces in database | `true` |
| `DEV_GUILD_ID` | Guild ID for fast command registration (dev only) | *(empty)* |
| `LLM_DOCTOR_PING` | Enable LLM ping in `npm run doctor` (set to `1`) | `0` |

---

## 📝 Example `.env`

```env
# =============================================================================
# Required
# =============================================================================
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_app_id_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/sage?schema=public

# =============================================================================
# Recommended
# =============================================================================
LLM_API_KEY=sk_... # Optional global key (or set a server key via /sage key set)
AUTOPILOT_MODE=manual
PROFILE_UPDATE_INTERVAL=5
WAKE_WORDS_CSV=sage
TRACE_ENABLED=true
AGENTIC_GRAPH_PARALLEL_ENABLED=true
AGENTIC_GRAPH_MAX_PARALLEL=3
AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE=false
AGENTIC_TOOL_ALLOW_HIGH_RISK=false
AGENTIC_TOOL_BLOCKLIST_CSV=
AGENTIC_CRITIC_ENABLED=false
AGENTIC_CRITIC_MIN_SCORE=0.72
AGENTIC_CRITIC_MAX_LOOPS=1
AGENTIC_CANARY_ENABLED=true
AGENTIC_CANARY_PERCENT=100
AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV=chat,coding,search,art,analyze,manage
AGENTIC_CANARY_MAX_FAILURE_RATE=0.30
AGENTIC_CANARY_MIN_SAMPLES=50
AGENTIC_CANARY_COOLDOWN_SEC=900
AGENTIC_CANARY_WINDOW_SIZE=250
AGENTIC_TENANT_POLICY_JSON={}
REPLAY_GATE_LIMIT=200
REPLAY_GATE_MIN_AVG_SCORE=0.65
REPLAY_GATE_MIN_SUCCESS_RATE=0.75
REPLAY_GATE_REQUIRE_DATA=1
LOG_LEVEL=info

# =============================================================================
# Admin Access (add your Discord user ID)
# =============================================================================
ADMIN_USER_IDS_CSV=123456789012345678
```

---

## 🔗 Related Documentation

- [Getting Started](GETTING_STARTED.md) — Full setup walkthrough
- [Pollinations Integration](POLLINATIONS.md) — Provider + model configuration
- [Memory System](architecture/memory_system.md) — How context budgets are applied
- [Operations Runbook](operations/runbook.md) — Production deployment notes

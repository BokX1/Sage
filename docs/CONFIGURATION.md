# Configuration Reference

Complete reference for all Sage configuration options. All settings are configured in your `.env` file.

> [!TIP]
> After making changes, restart Sage for them to take effect.

---

## 🔴 Essential (Required)

These settings are **required** for Sage to start.

| Variable | Description | Example |
|:---------|:------------|:--------|
| `DISCORD_TOKEN` | Your bot's authentication token from Discord Developer Portal | `MTIz...abc` |
| `DISCORD_APP_ID` | Your application's ID from Discord Developer Portal | `1234567890123456789` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/sage?schema=public` |

---

## 🤖 AI Models

Sage uses an intelligent agentic architecture with specialized models for different tasks.

### Primary Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LLM_PROVIDER` | AI provider | `pollinations` |
| `POLLINATIONS_BASE_URL` | API endpoint URL | `https://gen.pollinations.ai/v1` |
| `POLLINATIONS_MODEL` | Primary chat model (ensure this is a vision-capable model like `gemini` for image support) | `gemini` |
| `POLLINATIONS_API_KEY` | Your Pollinations API key (required for guild chats) | *(empty)* |

### Specialized System Models

| Variable | Description | Default |
|:---------|:------------|:--------|
| `PROFILE_PROVIDER` | Provider override for profile analysis | *(empty)* |
| `PROFILE_POLLINATIONS_MODEL` | Model for user profile analysis | `deepseek` |
| `SUMMARY_MODEL` | Model for channel summaries | `openai-large` |
| `SUMMARY_PROVIDER` | Provider override for summaries | *(empty)* |
| `FORMATTER_MODEL` | Model for reliable JSON formatting | `qwen-coder` |

### Model Limits

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LLM_MODEL_LIMITS_JSON` | Custom token limits per model (JSON string) | *(empty)* |

---

## 💬 Behavior & Agentic Triggers

Control how Sage interacts with users.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `WAKE_WORDS` | Words that trigger Sage at start of message | `sage` |
| `WAKE_WORD_PREFIXES` | Optional prefixes (e.g., "hey sage") | *(empty)* |
| `AUTOPILOT_MODE` | Response mode: `manual`, `reserved`, or `talkative` | `manual` |
| `PROFILE_UPDATE_INTERVAL` | Messages between background profile updates | `5` |
| `WAKEWORD_COOLDOWN_SEC` | Cooldown per user between responses (seconds) | `20` |
| `WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL` | Max responses per minute per channel | `6` |

### Autopilot Modes Explained

| Mode | Behavior | API Usage |
|:-----|:---------|:----------|
| `manual` | Only responds when wake word is used, bot is @mentioned, or via Reply | 🟢 **Low** |
| `reserved` | Occasionally joins relevant conversations autonomously | 🟡 **Medium** |
| `talkative` | Actively participates in discussions without prompts | 🔴 **High** |

---

## 📥 Message Ingestion & Storage

Control what Sage logs and stores.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LOGGING_ENABLED` | Enable message/voice ingestion | `true` |
| `LOGGING_MODE` | `all` or `allowlist` for channel filtering | `all` |
| `LOGGING_ALLOWLIST_CHANNEL_IDS` | Comma-separated channel IDs to log (if mode=allowlist) | *(empty)* |
| `LOGGING_BLOCKLIST_CHANNEL_IDS` | Comma-separated channel IDs to exclude | *(empty)* |
| `MESSAGE_DB_STORAGE_ENABLED` | Persist messages to database | `true` |
| `PROACTIVE_POSTING_ENABLED` | Allow autonomous message posting | `true` |

### Retention Settings

| Variable | Description | Default |
|:---------|:------------|:--------|
| `RAW_MESSAGE_TTL_DAYS` | In-memory transcript retention (days) | `3` |
| `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` | Max messages in memory per channel | `200` |
| `CONTEXT_TRANSCRIPT_MAX_MESSAGES` | Max messages stored in DB per channel | `15` |
| `CONTEXT_TRANSCRIPT_MAX_CHARS` | Max characters per transcript block | `12000` |

---

## 📊 Channel Summaries

Configure automatic channel summarization.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `SUMMARY_ROLLING_WINDOW_MIN` | Rolling window duration (minutes) | `60` |
| `SUMMARY_ROLLING_MIN_MESSAGES` | Min messages before triggering summary | `20` |
| `SUMMARY_ROLLING_MIN_INTERVAL_SEC` | Min seconds between summaries | `300` |
| `SUMMARY_PROFILE_MIN_INTERVAL_SEC` | Min seconds between profile summaries | `21600` (6h) |
| `SUMMARY_MAX_CHARS` | Max characters per summary | `1800` |
| `SUMMARY_SCHED_TICK_SEC` | Summary scheduler tick interval | `60` |

---

## 🧠 Context Budgeting

Control token allocation for LLM requests.

### Global Limits

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CONTEXT_MAX_INPUT_TOKENS` | Total input token budget | `65536` |
| `CONTEXT_RESERVED_OUTPUT_TOKENS` | Reserved tokens for output | `8192` |
| `SYSTEM_PROMPT_MAX_TOKENS` | Max tokens for system prompt | `6000` |
| `CONTEXT_USER_MAX_TOKENS` | Max tokens for user message | `24000` |

### Block Budgets

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` | Budget for raw message transcript | `8000` |
| `CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY` | Budget for rolling summary | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY` | Budget for profile summary | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_MEMORY` | Budget for memory data | `6000` |
| `CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT` | Budget for reply context | `3200` |
| `CONTEXT_BLOCK_MAX_TOKENS_EXPERTS` | Budget for expert packets | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS` | Budget for relationship hints | `2400` |

### Token Estimation

| Variable | Description | Default |
|:---------|:------------|:--------|
| `TOKEN_ESTIMATOR` | Token counting method | `heuristic` |
| `TOKEN_HEURISTIC_CHARS_PER_TOKEN` | Characters per token estimate | `4` |
| `CONTEXT_TRUNCATION_NOTICE` | Show truncation notice in context | `true` |

---

## 🤝 Relationship Graph

Tune social relationship calculations.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `RELATIONSHIP_HINTS_MAX_EDGES` | Max relationship edges to include | `10` |
| `RELATIONSHIP_DECAY_LAMBDA` | Time decay factor for relationships | `0.06` |
| `RELATIONSHIP_WEIGHT_K` | Weight scaling constant | `0.2` |
| `RELATIONSHIP_CONFIDENCE_C` | Confidence scaling constant | `0.25` |

---

## 🔒 Rate Limits & Timeouts

Prevent spam and manage latency.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `RATE_LIMIT_MAX` | Max responses per window | `5` |
| `RATE_LIMIT_WINDOW_SEC` | Rate limit window duration (seconds) | `10` |
| `TIMEOUT_CHAT_MS` | Timeout for chat requests | `300000` (5 min) |
| `TIMEOUT_MEMORY_MS` | Timeout for memory operations | `600000` (10 min) |

---

## 👑 Admin Access Control

Configure administrator permissions.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `ADMIN_ROLE_IDS` | Comma-separated Discord role IDs with admin access | *(empty)* |
| `ADMIN_USER_IDS` | Comma-separated Discord user IDs with admin access | *(empty)* |

---

## 🔍 Observability & Debugging

| Variable | Description | Default |
|:---------|:------------|:--------|
| `NODE_ENV` | Environment: `development`, `production`, `test` | `development` |
| `LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `TRACE_ENABLED` | Store processing traces in database | `true` |
| `DEV_GUILD_ID` | Guild ID for fast command registration (dev only) | *(empty)* |
| `LLM_DOCTOR_PING` | Enable LLM ping in `npm run doctor` (set to `1`) | `0` |

---

## 📝 Example .env File

```env
# =============================================================================
# Required
# =============================================================================
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_app_id_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/sage?schema=public
POLLINATIONS_API_KEY=sk_...

# =============================================================================
# Recommended
# =============================================================================
AUTOPILOT_MODE=manual
PROFILE_UPDATE_INTERVAL=5
WAKE_WORDS=sage
TRACE_ENABLED=true
LOG_LEVEL=info

# =============================================================================
# Admin Access (add your Discord user ID)
# =============================================================================
ADMIN_USER_IDS=123456789012345678
```

---

## 🔗 Related Documentation

- [Getting Started](GETTING_STARTED.md) — Initial setup walkthrough
- [Pollinations Integration](POLLINATIONS.md) — AI provider details
- [Memory System](architecture/memory_system.md) — How context budgets work
- [Operations Runbook](operations/runbook.md) — Production deployment

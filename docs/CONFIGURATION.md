# Configuration Reference

Complete reference for all Sage configuration options.

All settings are configured in your `.env` file. After making changes, restart Sage for them to take effect.

---

## 🔴 Essential (Required)

These three settings are **required** for Sage to start.

| Variable | Description | Example |
|:---------|:------------|:--------|
| `DISCORD_TOKEN` | Your bot's authentication token from Discord Developer Portal | `MTIz...abc` |
| `DISCORD_APP_ID` | Your application's ID from Discord Developer Portal | `1234567890123456789` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/sage?schema=public` |

**How to get these:**

- See [Getting Started Guide](GETTING_STARTED.md#step-2-create-your-discord-bot) for Discord credentials
- Database URL is auto-configured if using Docker

---

## 🤖 AI Models

Configure which AI models Sage uses.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LLM_PROVIDER` | AI provider (only Pollinations supported) | `pollinations` |
| `POLLINATIONS_BASE_URL` | API endpoint | `https://gen.pollinations.ai/v1` |
| `POLLINATIONS_MODEL` | Primary chat model (does not affect summaries/profile) | `gemini` |
| `POLLINATIONS_API_KEY` | Required for onboarding; higher rate limits | *(empty)* |

### Specialized Models

| Variable | Description | Default |
|:---------|:------------|:--------|
| `PROFILE_PROVIDER` | Override provider for profile updates | *(empty)* |
| `PROFILE_POLLINATIONS_MODEL` | Model for user profile analysis | `deepseek` |
| `SUMMARY_MODEL` | Model for channel summaries | `openai-large` |
| `FORMATTER_MODEL` | Model for structured JSON output | `qwen-coder` |

> 💡 **Tip:** Run `npm run onboard` to browse available models or consult the Pollinations model catalog.

---

## 💬 Behavior

Control how Sage interacts with users.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `WAKE_WORDS` | Words that trigger Sage at start of message (comma-separated) | `sage` |
| `WAKE_WORD_PREFIXES` | Optional prefixes before wake words (e.g., "hey sage") | *(empty)* |
| `AUTOPILOT_MODE` | Response mode: `manual`, `reserved`, or `talkative` | `manual` |
| `WAKEWORD_COOLDOWN_SEC` | Cooldown per user between responses | `20` |
| `WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL` | Channel-wide rate cap | `6` |

### Autopilot Modes Explained

| Mode | Behavior | API Usage |
|:-----|:---------|:----------|
| `manual` | Only responds when wake word is used or bot is @mentioned | 🟢 **Low** — Most cost-effective |
| `reserved` | Occasionally joins relevant conversations | 🟡 **Medium** — Moderate increase |
| `talkative` | Actively participates in discussions without prompts | 🔴 **High** — Significant cost increase |

> ⚠️ **Cost Warning:** Autopilot modes (`reserved` and `talkative`) process **every message** in your server to decide whether to respond. This can **dramatically increase API usage** and is best suited for:
>
> - Low-activity servers (< 100 messages/day)
> - Servers where you want Sage to feel "alive" and responsive
> - Testing/development environments
>
> For high-activity servers, stick with `manual` mode to control costs.

**Example:**

```env
AUTOPILOT_MODE=reserved  # Good for small, close-knit communities
```

---

## 🧠 Memory & Logging

Configure what Sage remembers.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LOGGING_ENABLED` | Enable message/voice ingestion | `true` |
| `LOGGING_MODE` | `all` or `allowlist` | `all` |
| `LOGGING_ALLOWLIST_CHANNEL_IDS` | Channels to log (if mode=allowlist) | *(empty)* |
| `LOGGING_BLOCKLIST_CHANNEL_IDS` | Channels to never log | *(empty)* |
| `MESSAGE_DB_STORAGE_ENABLED` | Persist messages to database | `true` |
| `RAW_MESSAGE_TTL_DAYS` | Days to keep messages in memory | `3` |
| `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` | Max messages in memory per channel | `200` |

---

## 📊 Summaries

Configure automatic channel summaries.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `SUMMARY_ROLLING_WINDOW_MIN` | Window size for rolling summaries (minutes) | `60` |
| `SUMMARY_ROLLING_MIN_MESSAGES` | Messages required to trigger summary | `20` |
| `SUMMARY_ROLLING_MIN_INTERVAL_SEC` | Minimum time between summaries | `300` |
| `SUMMARY_PROFILE_MIN_INTERVAL_SEC` | Minimum time between profile updates | `21600` (6h) |
| `SUMMARY_MAX_CHARS` | Maximum summary length | `1800` |
| `SUMMARY_SCHED_TICK_SEC` | How often to check for summary needs | `60` |

---

## 📏 Context Budgets

Control token limits for AI context.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CONTEXT_MAX_INPUT_TOKENS` | Total input token budget | `65536` |
| `CONTEXT_RESERVED_OUTPUT_TOKENS` | Reserved for AI response | `8192` |
| `SYSTEM_PROMPT_MAX_TOKENS` | System prompt limit | `6000` |
| `CONTEXT_USER_MAX_TOKENS` | User message limit | `24000` |
| `CONTEXT_TRUNCATION_NOTICE` | Add notice when content truncated | `true` |

### Block Budgets

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` | Chat history budget | `8000` |
| `CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY` | Rolling summary budget | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY` | Profile summary budget | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_MEMORY` | Memory block budget | `6000` |
| `CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT` | Reply context budget | `3200` |
| `CONTEXT_BLOCK_MAX_TOKENS_EXPERTS` | Expert packet budget | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS` | Relationship hints budget | `2400` |
| `CONTEXT_TRANSCRIPT_MAX_MESSAGES` | Max messages in context | `15` |
| `CONTEXT_TRANSCRIPT_MAX_CHARS` | Max transcript characters | `12000` |

### Token Estimation

| Variable | Description | Default |
|:---------|:------------|:--------|
| `TOKEN_ESTIMATOR` | Estimator type: `heuristic` | `heuristic` |
| `TOKEN_HEURISTIC_CHARS_PER_TOKEN` | Characters per token ratio | `4` |

---

## 🔒 Rate Limits

Prevent spam and abuse.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `RATE_LIMIT_MAX` | Max responses per window | `5` |
| `RATE_LIMIT_WINDOW_SEC` | Rate limit window duration | `10` |

---

## 👑 Admin Access

Configure who can use admin commands.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `ADMIN_ROLE_IDS` | Discord role IDs with admin access (comma-separated) | *(empty)* |
| `ADMIN_USER_IDS` | Discord user IDs with admin access (comma-separated) | *(empty)* |

**Example:**

```
ADMIN_USER_IDS=123456789012345678,987654321098765432
ADMIN_ROLE_IDS=111111111111111111
```

---

## 🤝 Relationships

Tune the relationship graph algorithm.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `RELATIONSHIP_HINTS_MAX_EDGES` | Max relationship edges to show | `10` |
| `RELATIONSHIP_DECAY_LAMBDA` | How fast relationships decay | `0.06` |
| `RELATIONSHIP_WEIGHT_K` | Weight tuning factor | `0.2` |
| `RELATIONSHIP_CONFIDENCE_C` | Confidence tuning factor | `0.25` |

---

## 🔍 Debugging

Options for troubleshooting.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `NODE_ENV` | Environment: `development` or `production` | `development` |
| `LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `TRACE_ENABLED` | Store processing traces in database | `true` |
| `DEV_GUILD_ID` | Guild for fast command registration (dev only) | *(empty)* |
| `LLM_DOCTOR_PING` | Set to `1` to enable LLM ping in diagnostics | `0` |

---

## ⏱️ Timeouts

Configure operation timeouts.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `TIMEOUT_CHAT_MS` | Chat request timeout | `300000` (5 min) |
| `TIMEOUT_MEMORY_MS` | Background memory operations | `600000` (10 min) |

---

## 📝 Example .env File

Here's a minimal `.env` file to get started:

```env
# Required
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_app_id_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/sage?schema=public

# Recommended
LOGGING_ENABLED=true
MESSAGE_DB_STORAGE_ENABLED=true
AUTOPILOT_MODE=manual
WAKE_WORDS=sage

# Admin (add your Discord User ID)
ADMIN_USER_IDS=

# Development (for fast command registration)
DEV_GUILD_ID=
```

For a complete template, see [.env.example](../.env.example).

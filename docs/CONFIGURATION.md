# Configuration Reference

Complete reference for all Sage configuration options. All settings are configured in your `.env` file. After making changes, restart Sage for them to take effect.

---

## 🔴 Essential (Required)

These three settings are **required** for Sage to start.

| Variable | Description | Example |
|:---------|:------------|:--------|
| `DISCORD_TOKEN` | Your bot's authentication token from Discord Developer Portal | `MTIz...abc` |
| `DISCORD_APP_ID` | Your application's ID from Discord Developer Portal | `1234567890123456789` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/sage?schema=public` |

---

## 🤖 AI Models

Sage uses an intelligent agentic architecture with specialized models for different tasks.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LLM_PROVIDER` | AI provider (Pollinations supported) | `pollinations` |
| `POLLINATIONS_MODEL` | Primary chat model | `gemini` |
| `POLLINATIONS_API_KEY` | Your personal Pollinations API key (Required for Guild chats) | *(empty)* |

### Specialized System Models

| Variable | Description | Default |
|:---------|:------------|:--------|
| `PROFILE_POLLINATIONS_MODEL` | Model used for user profile analysis | `deepseek` |
| `SUMMARY_MODEL` | Model used for generating channel summaries | `openai-large` |
| `FORMATTER_MODEL` | Model used for reliable JSON formatting | `qwen-coder` |

---

## 💬 Behavior & Agentic Triggers

Control how Sage interacts with users.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `WAKE_WORDS` | Words that trigger Sage at start of message | `sage` |
| `WAKE_WORD_PREFIXES` | Optional prefixes (e.g., "hey sage") | *(empty)* |
| `AUTOPILOT_MODE` | Response mode: `manual`, `reserved`, or `talkative` | `manual` |
| `PROFILE_UPDATE_INTERVAL` | Number of messages between background profile updates | `5` |
| `WAKEWORD_COOLDOWN_SEC` | Cooldown per user between responses | `20` |

### Autopilot Modes Explained

| Mode | Behavior | API Usage |
|:-----|:---------|:----------|
| `manual` | Only responds when wake word is used, bot is @mentioned, or via Reply | 🟢 **Low** |
| `reserved` | Occasionally joins relevant conversations autonomously | 🟡 **Medium** |
| `talkative` | Actively participates in discussions without prompts | 🔴 **High** |

---

## 🧠 Memory & Context Assembly

Configure how much Sage remembers and how it budgets tokens.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LOGGING_ENABLED` | Enable message/voice ingestion | `true` |
| `MESSAGE_DB_STORAGE_ENABLED` | Persist messages to database | `true` |
| `RAW_MESSAGE_TTL_DAYS` | In-memory transcript retention (days) | `3` |
| `CONTEXT_MAX_INPUT_TOKENS` | Total input token budget for LLM requests | `65536` |
| `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` | Budget for the raw message transcript | `8000` |
| `CONTEXT_BLOCK_MAX_TOKENS_EXPERTS` | Budget for narrative expert packets | `4800` |

---

## 🔒 Rate Limits & Timeouts

Prevent spam and manage latency.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `RATE_LIMIT_MAX` | Max responses per window | `5` |
| `RATE_LIMIT_WINDOW_SEC` | Rate limit window duration | `10` |
| `TIMEOUT_CHAT_MS` | Total timeout for chat requests | `300000` (5 min) |

---

## 🔍 Observability & Debugging

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `TRACE_ENABLED` | Store processing traces (with `reasoningText`) in DB | `true` |
| `DEV_GUILD_ID` | Guild for fast command registration | *(empty)* |
| `LLM_DOCTOR_PING` | Enable LLM ping in `npm run doctor` | `0` |

---

## 📝 Example .env File

```env
# Required
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_app_id_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/sage?schema=public
POLLINATIONS_API_KEY=sk_...

# Recommended
AUTOPILOT_MODE=manual
PROFILE_UPDATE_INTERVAL=5
WAKE_WORDS=sage
TRACE_ENABLED=true
```

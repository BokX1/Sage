# Sage

[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![CI](https://github.com/BokX1/Sage/actions/workflows/ci.yml/badge.svg)](https://github.com/BokX1/Sage/actions/workflows/ci.yml)
[![Powered by Pollinations](https://img.shields.io/badge/Powered%20by-Pollinations-blue)](https://pollinations.ai)

Sage is a context-aware Discord bot that blends channel memory, relationship hints, and voice awareness to deliver richer replies.

---

## Overview

Sage listens to messages and voice activity in your Discord server, stores summaries and relationship signals, and uses that context to answer questions with more continuity. It supports vision inputs, file ingestion, and per-guild model selection with safe fallbacks.

---

## Key features

- **Multimodal chat**: Sends image attachments to the LLM when a user posts an image. If the selected model lacks vision, Sage falls back to the default model for that request.
- **Reply-aware context**: Replies include the referenced message (text or image) as context.
- **File/code attachment ingest**: Text-based attachments are fetched, size-checked, and inserted into the prompt with truncation notes.
- **Memory + summaries**: User profiles and rolling/channel summaries are stored in Postgres and injected into prompts.
- **Relationship & voice awareness**: Relationship edges are updated from mentions + voice overlap; voice sessions power “who’s in voice” responses.
- **Long-message splitting**: Bot replies are split with code-fence preservation to stay within Discord limits.
- **Model catalog + guild overrides**: Runtime model catalog fetch with guild-level overrides and per-request capability checks.

---

## Quick start

```bash
npm install
npm run setup

# Optional: start Postgres via Docker
docker compose up -d db

npm run db:migrate
npm run dev
```

Notes:
- `npm run setup` writes a `.env` file from `.env.example` (interactive).
- If you use Docker for Postgres, run `docker compose up -d db` first.
- Production: `npm run build` then `npm start`.

---

## Configuration

Sage validates configuration at startup in `src/config.ts`. Required variables must be set before the bot will start.

### Core

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | Runtime mode. | `development` |
| `DISCORD_TOKEN` | Discord bot token. | *(required)* |
| `DISCORD_APP_ID` | Discord application ID for slash commands. | *(required)* |
| `DATABASE_URL` | Postgres connection string. | *(required)* |
| `DEV_GUILD_ID` | Register commands to a single guild for fast iteration. | *(empty)* |

### LLM (Pollinations)

| Variable | Purpose | Default |
| --- | --- | --- |
| `LLM_PROVIDER` | LLM provider (Pollinations only). | `pollinations` |
| `POLLINATIONS_BASE_URL` | Pollinations API base URL. | `https://gen.pollinations.ai/v1` |
| `POLLINATIONS_MODEL` | Default chat model. | `gemini` |
| `POLLINATIONS_API_KEY` | Optional API key for higher limits. | *(empty)* |
| `LLM_MODEL_LIMITS_JSON` | JSON map of model limits used as fallback catalog hints. | *(empty)* |

### Memory + summaries

| Variable | Purpose | Default |
| --- | --- | --- |
| `PROFILE_PROVIDER` | Override provider for profile updates. | *(empty)* |
| `PROFILE_POLLINATIONS_MODEL` | Model for profile updates. | `deepseek` |
| `SUMMARY_PROVIDER` | Reserved (currently unused). | *(empty)* |
| `SUMMARY_MODEL` | Model for channel summaries. | `openai-large` |
| `FORMATTER_MODEL` | Formatter model for structured JSON. | `qwen-coder` |

### Ingestion + storage

| Variable | Purpose | Default |
| --- | --- | --- |
| `LOGGING_ENABLED` | Toggle message + voice ingestion. | `true` |
| `LOGGING_MODE` | `all` or `allowlist`. | `all` |
| `LOGGING_ALLOWLIST_CHANNEL_IDS` | Channels to ingest in allowlist mode. | *(empty)* |
| `LOGGING_BLOCKLIST_CHANNEL_IDS` | Channels to skip. | *(empty)* |
| `MESSAGE_DB_STORAGE_ENABLED` | Persist messages to Postgres. | `true` |
| `PROACTIVE_POSTING_ENABLED` | Enable proactive posting features. | `true` |
| `RAW_MESSAGE_TTL_DAYS` | In-memory transcript TTL in days. | `3` |
| `RING_BUFFER_MAX_MESSAGES_PER_CHANNEL` | In-memory transcript cap per channel. | `200` |
| `CONTEXT_TRANSCRIPT_MAX_MESSAGES` | Max messages pulled into context. | `15` |
| `CONTEXT_TRANSCRIPT_MAX_CHARS` | Max transcript chars. | `12000` |

### Summaries scheduler

| Variable | Purpose | Default |
| --- | --- | --- |
| `SUMMARY_ROLLING_WINDOW_MIN` | Rolling summary window (minutes). | `60` |
| `SUMMARY_ROLLING_MIN_MESSAGES` | Messages required for a rolling summary. | `20` |
| `SUMMARY_ROLLING_MIN_INTERVAL_SEC` | Minimum time between rolling summaries. | `300` |
| `SUMMARY_PROFILE_MIN_INTERVAL_SEC` | Minimum time between profile updates. | `21600` |
| `SUMMARY_MAX_CHARS` | Max summary characters. | `1800` |
| `SUMMARY_SCHED_TICK_SEC` | Scheduler tick interval. | `60` |

### Behavior + rate limits

| Variable | Purpose | Default |
| --- | --- | --- |
| `LOG_LEVEL` | Log verbosity. | `info` |
| `RATE_LIMIT_MAX` | Responses per window (per channel). | `5` |
| `RATE_LIMIT_WINDOW_SEC` | Rate-limit window seconds. | `10` |
| `AUTOPILOT_MODE` | `manual`, `reserved`, or `talkative`. | `manual` |
| `WAKE_WORDS` | Comma-separated wake words. | `sage` |
| `WAKE_WORD_PREFIXES` | Optional prefixes (e.g., “hey”). | `hey,yo,hi,hello` |
| `WAKEWORD_COOLDOWN_SEC` | Per-user cooldown seconds. | `20` |
| `WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL` | Channel-wide cap. | `6` |

### Context budgets

| Variable | Purpose | Default |
| --- | --- | --- |
| `CONTEXT_MAX_INPUT_TOKENS` | Total input token budget. | `65536` |
| `CONTEXT_RESERVED_OUTPUT_TOKENS` | Reserved output tokens. | `8192` |
| `SYSTEM_PROMPT_MAX_TOKENS` | Max system prompt tokens. | `6000` |
| `TOKEN_ESTIMATOR` | Token estimator type. | `heuristic` |
| `TOKEN_HEURISTIC_CHARS_PER_TOKEN` | Char/token ratio. | `4` |
| `CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT` | Transcript block budget. | `8000` |
| `CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY` | Rolling summary budget. | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY` | Profile summary budget. | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_MEMORY` | Memory block budget (currently unused). | `6000` |
| `CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT` | Reply context budget. | `3200` |
| `CONTEXT_BLOCK_MAX_TOKENS_EXPERTS` | Expert packet budget. | `4800` |
| `CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS` | Relationship hint budget. | `2400` |
| `CONTEXT_USER_MAX_TOKENS` | User message budget. | `24000` |
| `CONTEXT_TRUNCATION_NOTICE` | Add truncation notice. | `true` |

### Relationship + tracing

| Variable | Purpose | Default |
| --- | --- | --- |
| `RELATIONSHIP_HINTS_MAX_EDGES` | Max edges rendered. | `10` |
| `RELATIONSHIP_DECAY_LAMBDA` | Decay lambda. | `0.06` |
| `RELATIONSHIP_WEIGHT_K` | Weight tuning. | `0.2` |
| `RELATIONSHIP_CONFIDENCE_C` | Confidence tuning. | `0.25` |
| `TRACE_ENABLED` | Persist router/expert traces. | `true` |

### Admin access

| Variable | Purpose | Default |
| --- | --- | --- |
| `ADMIN_ROLE_IDS` | Comma-separated admin role IDs. | *(empty)* |
| `ADMIN_USER_IDS` | Comma-separated admin user IDs. | *(empty)* |

### Timeouts

| Variable | Purpose | Default |
| --- | --- | --- |
| `TIMEOUT_CHAT_MS` | Chat request timeout. | `300000` |
| `TIMEOUT_MEMORY_MS` | Background memory timeout. | `600000` |

### Doctor utility

| Variable | Purpose | Default |
| --- | --- | --- |
| `LLM_DOCTOR_PING` | Set to `1` to ping the LLM during `npm run doctor`. | `0` |

### Model selection behavior

- Default model comes from `POLLINATIONS_MODEL`.
- Guild overrides are stored in `GuildSetting` and set via `/setmodel`.
- If a request includes images and the selected model lacks vision, Sage falls back to the default model for that request.

---

## Commands

| Command | Description | Admin only |
| --- | --- | --- |
| `/ping` | Check bot responsiveness. | No |
| `/llm_ping` | Test LLM connectivity + latency. | Yes |
| `/models` | List available models and selection. | Yes |
| `/setmodel <model_id>` | Set guild-level model. | Yes |
| `/resetmodel` | Clear guild model override. | Yes |
| `/refreshmodels` | Refresh runtime model catalog. | Yes |
| `/sage whoiswho [user]` | Show relationship info for a user. | No |
| `/sage relationship set user_a user_b level` | Manually set relationship strength. | Yes |
| `/sage admin stats` | Bot stats. | Yes |
| `/sage admin relationship_graph [user]` | View relationship edges. | Yes |
| `/sage admin trace [trace_id] [limit]` | View recent traces. | Yes |
| `/sage admin summarize [channel]` | Force channel summary. | Yes |

Admin commands require `ADMIN_ROLE_IDS` and/or `ADMIN_USER_IDS` to be configured.

---

## Permissions & intents

Sage uses the following gateway intents:
- `Guilds`
- `GuildMessages`
- `MessageContent`
- `GuildVoiceStates`

Ensure the bot has permission to read messages, send messages, and view channels where it is enabled.

---

## Security & privacy

- `.env` is ignored by git; never commit secrets.
- If `LOGGING_ENABLED=false`, message and voice ingestion stops.
- If `MESSAGE_DB_STORAGE_ENABLED=false`, messages stay in memory only (summaries and profiles still persist).
- Messages (including attachment text blocks and image URLs) are sent to the LLM provider when generating replies.

For more detail, see `docs/security_privacy.md`.

---

## Development

```bash
npm run dev       # nodemon + ts-node
npm run build     # compile to dist/
npm run lint      # eslint
npm run test      # vitest
npm run doctor    # config + DB checks
npm run cert      # lint + build + test + prisma validate
```

Database helpers:

```bash
npm run db:migrate
npm run db:studio
```

---

## License

ISC

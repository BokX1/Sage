# Sage

[![CI](https://github.com/BokX1/Sage/actions/workflows/ci.yml/badge.svg)](https://github.com/BokX1/Sage/actions/workflows/ci.yml)
[![Powered by Pollinations](https://img.shields.io/badge/Powered%20by-Pollinations-blue)](https://pollinations.ai)

**Sage** is a context-aware Discord bot that stores conversation context, relationship signals, and channel summaries to deliver more personalized responses in real time.

---

## Key capabilities

- **Persistent user profiles** built from conversations and updated after each reply.
- **Relationship graph** that scores connections from mentions, replies, and voice overlap events.
- **Channel summaries** (rolling + long-term profiles) to compress recent and historical context.
- **Voice awareness** with presence tracking, voice sessions, and “who’s in voice / how long today” answers.
- **Routing + tracing** that classifies requests, runs expert lookups, and stores trace metadata for debugging.

---

## Architecture at a glance

```
Discord events
  ├─ ingestEvent (logs message/voice + updates relationship graph)
  ├─ generateChatReply
  │   ├─ router → experts → context builder → LLM
  │   └─ trace start/end persisted (optional)
  └─ background updates
      ├─ user profile updater
      └─ channel summary scheduler
```

Deep dives:
- Memory + summaries: `docs/architecture/memory_system.md`
- Routing + orchestration: `docs/architecture/pipeline.md`
- Operations + safety: `docs/operations/runbook.md`
- Security & privacy: `docs/security_privacy.md`

---

## Quick start

```bash
# Clone the repo
git clone https://github.com/BokX1/Sage.git
cd Sage

# Install dependencies
npm install

# Configure env
npm run setup

# Start Postgres (optional helper)
docker compose up -d db

# Run migrations
npm run db:migrate

# Start the bot in dev mode
npm run dev
```

Prefer manual configuration? Copy `.env.example` to `.env` and edit the required values directly.

After the bot is running:

- Use `/models` to list available models.
- Use `/setmodel <id>` to set a guild-level model.
- Use `/resetmodel` to clear the guild override.

Notes on model selection:

- If no model is selected, the bot uses `defaultModelId`.
- Guild model selection overrides any global environment fallback (if set).
- If a non-vision model is selected, image messages auto-fallback to the default per request.

---

## Configuration

### Required

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal. |
| `DISCORD_APP_ID` | Discord application ID (used for slash command registration). |
| `DATABASE_URL` | PostgreSQL connection string for Prisma. |

### LLM provider (Pollinations-only)

| Variable | Purpose | Default |
| --- | --- | --- |
| `LLM_PROVIDER` | LLM backend (Pollinations only). | `pollinations` |
| `POLLINATIONS_BASE_URL` | Pollinations base URL. | `https://gen.pollinations.ai/v1` |
| `POLLINATIONS_MODEL` | Chat model used for replies. | `gemini` |
| `POLLINATIONS_API_KEY` | Optional API key for Pollinations. | *(empty)* |
| `PROFILE_PROVIDER` | Override provider for profile updates (Pollinations only). | *(empty)* |
| `PROFILE_POLLINATIONS_MODEL` | Model for profile updates. | `deepseek` |
| `SUMMARY_MODEL` | Model for channel summaries. | `openai-large` |
| `FORMATTER_MODEL` | JSON formatter model for summaries/profiles. | `qwen-coder` |

### Behavior + logging

| Variable | Purpose | Default |
| --- | --- | --- |
| `AUTOPILOT_MODE` | `manual`, `reserved`, or `talkative`. | `manual` |
| `WAKE_WORDS` | Comma-separated wake words. | `sage` |
| `WAKE_WORD_PREFIXES` | Optional prefixes like “hey”. | `hey,yo,hi,hello` |
| `WAKEWORD_COOLDOWN_SEC` | Per-user wakeword cooldown. | `20` |
| `WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL` | Channel-wide wakeword cap. | `6` |
| `RATE_LIMIT_MAX` | Max bot responses per window (per channel). | `5` |
| `RATE_LIMIT_WINDOW_SEC` | Rate-limit window. | `10` |
| `LOGGING_ENABLED` | Enable message/voice ingestion. | `true` |
| `LOGGING_MODE` | `all` or `allowlist`. | `all` |
| `LOGGING_ALLOWLIST_CHANNEL_IDS` | Channels to log in allowlist mode. | *(empty)* |
| `LOGGING_BLOCKLIST_CHANNEL_IDS` | Channels to skip logging. | *(empty)* |
| `TRACE_ENABLED` | Persist router/expert trace metadata. | `true` |

See `.env.example` for the full list of environment variables (summaries, context budgets, relationship tuning, timeouts, etc.).

---

## Commands

| Command | Description |
| --- | --- |
| `/ping` | Check bot responsiveness. |
| `/llm_ping` | Admin: test LLM connectivity/latency. |
| `/sage whoiswho [user]` | Show relationship data (probabilistic). |
| `/sage relationship set user_a user_b level` | Admin: set relationship strength (0–1). |
| `/sage admin stats` | Admin: bot uptime, memory, edge count, version. |
| `/sage admin relationship_graph [user]` | Admin: view top relationship edges. |
| `/sage admin trace [trace_id] [limit]` | Admin: view recent traces or a specific trace. |
| `/sage admin summarize [channel]` | Admin: force a channel summary (rolling + profile update). |

Admin commands require `ADMIN_ROLE_IDS` and/or `ADMIN_USER_IDS` to be configured.

---

## Development & testing

```bash
npm run dev       # Start with nodemon + ts-node
npm run build     # Compile TypeScript to dist/
npm run lint      # ESLint
npm test          # Vitest
npm run doctor    # Validate config + DB connectivity
npm run cert      # Lint + build + test + prisma validate
```

### Database

```bash
npm run db:migrate   # prisma migrate dev
npm run db:studio    # prisma studio
npx prisma validate  # schema validation
```

---

## Deployment

- **Postgres required**: see `docker-compose.yml` for a ready-to-run Postgres service.
- Run `npm run build` and `npm start` for production.
- Ensure `DISCORD_TOKEN`, `DISCORD_APP_ID`, and `DATABASE_URL` are set.

---

## Troubleshooting

- **Bot never responds**: confirm `AUTOPILOT_MODE=manual` and that you mention the bot, reply to it, or use a wake word.
- **Slash commands missing**: restart the bot to re-register commands; use `DEV_GUILD_ID` for faster propagation.
- **Database errors**: check `DATABASE_URL`, run `npm run db:migrate`.
- **No summaries/relationships**: verify `LOGGING_ENABLED=true` and channel allowlist/blocklist settings.
- **Rate limiting**: tune `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_SEC` for busy channels.

---

## License

ISC

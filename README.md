# Sage

[![CI](https://github.com/BokX1/Sage/actions/workflows/ci.yml/badge.svg)](https://github.com/BokX1/Sage/actions/workflows/ci.yml)

**Sage** is a context-aware Discord bot that remembers conversations, tracks relationships, and generates personalized responses using LLM-powered intelligence.

---

## What Sage Does

Sage is built to give Discord communities a reliable, memory-aware assistant. It combines persistent memory, social graph analysis, and channel summaries to produce richer, more personalized replies.

### Key Capabilities

- **User Memory** — Learns and recalls preferences, interests, and conversation history.
- **Relationship Graph** — Builds probabilistic relationships based on mentions, replies, and voice activity.
- **Channel Summaries** — Maintains rolling summaries to give the model compact context.
- **Voice Awareness** — Tracks voice joins, leaves, and overlap sessions.
- **Agentic Routing** — Routes requests through a Mixture-of-Experts architecture with tracing.

---

## Repository Structure

```
.
├── docs/               # Design docs and architecture references
├── prisma/             # Prisma schema & migrations
├── src/                # Bot runtime (TypeScript)
│   ├── bot/            # Discord event handlers
│   ├── core/           # Runtime pipeline, LLM, orchestration, memory
│   ├── db/             # Prisma client
│   ├── scripts/        # Operational scripts (doctor/cert)
│   └── utils/          # Shared utilities
├── tests/              # Vitest unit/integration tests
├── README.md
└── CHANGELOG.md
```

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/BokX1/Sage.git
cd Sage
npm ci

# Configure
cp .env.example .env
# Edit .env with your Discord token and database URL

# Database setup
npx prisma migrate dev

# Run
npm run dev
```

---

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_APP_ID` | Application ID from Discord Developer Portal |
| `DATABASE_URL` | PostgreSQL connection string |

### LLM Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `pollinations` | LLM backend |
| `POLLINATIONS_MODEL` | `gemini` | Model name for Pollinations API |

### Bot Behavior

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_MAX` | `5` | Max requests per window per user |
| `RATE_LIMIT_WINDOW_SEC` | `10` | Rate limit window in seconds |
| `AUTOPILOT_MODE` | `manual` | `manual`, `reserved`, `talkative` |
| `WAKE_WORDS` | `sage` | Comma-separated trigger words |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

### Admin Access

| Variable | Description |
|----------|-------------|
| `ADMIN_ROLE_IDS` | Comma-separated Discord role IDs with admin access |
| `ADMIN_USER_IDS` | Comma-separated Discord user IDs with admin access |

See `.env.example` for the full list of configuration options.

---

## Commands

| Command | Description |
|---------|-------------|
| `/ping` | Check bot responsiveness |
| `/llm_ping` | Test LLM connection and latency |
| `/sage whoiswho [user]` | View relationship data for a user |
| `/sage relationship set` | Manually set relationship level (admin) |
| `/sage admin stats` | Bot statistics and uptime |
| `/sage admin relationship_graph [user]` | View full relationship graph |
| `/sage admin trace [trace_id]` | View agent decision traces |
| `/sage admin summarize [channel]` | Force channel summary generation |

---

## Development

```bash
npm run dev        # Start with hot reload
npm run build      # Compile TypeScript to dist/
npm run lint       # ESLint
npm test           # Vitest tests
npm run doctor     # Config + database check
npm run cert       # Full certification (lint + build + test + prisma)
```

### Database

```bash
npx prisma migrate dev   # Run migrations
npx prisma studio        # GUI database browser
npx prisma validate      # Schema validation
```

---

## Testing

- Tests live under `tests/` and are run with Vitest.
- Build output (`dist/`) is excluded from test discovery to avoid CommonJS/Vitest mismatches.

---

## Docs

- `docs/architecture/` contains the memory and pipeline design notes.
- `docs/D9_IMPLEMENTATION.md` covers the MoE orchestration rollout.

---

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Discord**: discord.js v14
- **Database**: Prisma ORM (PostgreSQL)
- **LLM**: Pollinations API
- **Validation**: Zod
- **Logging**: Pino
- **Testing**: Vitest

---

## License

ISC

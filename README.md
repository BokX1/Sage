# Sage v0.1 Beta

[![CI](https://github.com/BokX1/Sage/actions/workflows/ci.yml/badge.svg)](https://github.com/BokX1/Sage/actions/workflows/ci.yml)

A personalized Discord chatbot powered by Pollinations AI with user memory, relationship tracking, and adaptive responses.

## ✨ Features

- **Personalized Memory** - Remembers user preferences and adapts responses over time
- **Relationship Graph** - Tracks user interactions and relationships within your server
- **Channel Summaries** - Automatic rolling summaries of channel activity
- **Voice Awareness** - Tracks voice channel presence and overlaps
- **Multi-LLM Support** - Works with Pollinations (default, uses Deepseek) or native Gemini
- **Smart Rate Limiting** - Prevents abuse with configurable limits
- **Admin Commands** - Stats, relationship graphs, and trace debugging
- **Structured Logging** - Production-ready logging with Pino
- **Type-Safe** - Built with TypeScript and strict Zod validation

---

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/BokX1/Sage.git
cd Sage
npm ci

# Configure environment
cp .env.example .env
# Edit .env with your values

# Setup database
docker-compose up -d          # Start Postgres (or use SQLite for dev)
npx prisma migrate dev        # Run migrations

# Run bot
npm run dev                   # Development mode
```

---

## ⚙️ Configuration

### Required Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from [Discord Developer Portal](https://discord.com/developers/applications) |
| `DISCORD_APP_ID` | Your Discord application ID |
| `DATABASE_URL` | Database connection string (Postgres or SQLite) |

### LLM Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `pollinations` | `pollinations`, `gemini`, or `off` |
| `POLLINATIONS_MODEL` | `deepseek` | Model to use with Pollinations |
| `GEMINI_API_KEY` | - | Required if using native Gemini |

### Bot Behavior

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_MAX` | `5` | Max requests per window |
| `RATE_LIMIT_WINDOW_SEC` | `10` | Rate limit window (seconds) |
| `SERIOUS_MODE` | `false` | Disable humor/casual responses |
| `AUTOPILOT_LEVEL` | `cautious` | Bot proactivity level |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

---

## 🛠️ Development

```bash
npm run dev       # Start with hot reload
npm run build     # Compile TypeScript
npm run lint      # Run ESLint
npm test          # Run Vitest tests
npm run doctor    # Check configuration & database
npm run cert      # Full certification suite
```

### Database

```bash
docker-compose up -d      # Start Postgres
npx prisma migrate dev    # Run migrations
npx prisma studio         # Open DB GUI
npx prisma validate       # Validate schema
```

### Code Quality

```bash
npx prettier --write src/**/*.ts   # Format code
npm run lint                        # Check linting
npm run cert                        # Full quality gate check
```

---

## 🔐 Security

- `.env` files are gitignored — **never commit them**
- Use `.env.example` as a template
- If a token is exposed, **rotate it immediately**

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Discord.js     │────▶│  Chat Engine │────▶│  LLM Client │
│  (Events)       │     │  (Core)      │     │  (Provider) │
└─────────────────┘     └──────────────┘     └─────────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐     ┌──────────────┐
│ Voice Tracker   │     │ User Profile │
│ (Presence)      │     │ (Prisma DB)  │
└─────────────────┘     └──────────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐     ┌──────────────┐
│ Relationship    │     │  Channel     │
│ Graph           │     │  Summaries   │
└─────────────────┘     └──────────────┘
```

### Core Components

- **Chat Engine** - Generates personalized responses with LLM
- **User Profile** - Stores user preferences and memory
- **Relationship Graph** - Tracks probabilistic user relationships
- **Voice Tracker** - Monitors voice channel activity
- **Channel Summaries** - Rolling summaries of channel activity
- **Profile Updater** - Background learning from conversations
- **Safety Gates** - Rate limiting and abuse prevention

---

## 🤖 Bot Commands

| Command | Description |
|---------|-------------|
| `/ping` | Check bot responsiveness |
| `/llm_ping` | Test LLM connection |
| `/sage whoiswho` | View your relationships |
| `/sage admin stats` | Bot statistics (admin) |
| `/sage admin relationship_graph` | View relationship graph (admin) |
| `/sage admin trace` | View agent traces (admin) |
| `/sage admin summarize` | Force channel summary (admin) |
| `/sage relationship set` | Manually set relationship level (admin) |

---

## 🤖 Invite to Server

Replace `YOUR_APP_ID`:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=277025687552&scope=bot%20applications.commands
```

---

## 📄 License

MIT

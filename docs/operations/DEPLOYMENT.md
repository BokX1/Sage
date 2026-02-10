# 🚀 Deployment Guide

How to deploy Sage to production.

---

## 🧭 Quick navigation

- [Prerequisites](#prerequisites)
- [Deployment Options](#deployment-options)
- [Environment Setup](#environment-setup)
- [Database Setup](#database-setup)
- [Production Checklist](#production-checklist)
- [Monitoring](#monitoring)

---

<a id="prerequisites"></a>

## 📋 Prerequisites

| Requirement | Version | Notes |
| :--- | :--- | :--- |
| Node.js | ≥ 18.x | LTS recommended |
| PostgreSQL | ≥ 14.x | Or any Prisma-compatible database |
| Discord Bot Token | — | From [Discord Developer Portal](https://discord.com/developers/applications) |
| Pollinations API Key | — | Via `enter.pollinations.ai` or `/sage key login` |

---

<a id="deployment-options"></a>

## 🏗️ Deployment Options

### Option 1: Direct (Node.js)

```bash
git clone https://github.com/BokX1/Sage.git && cd Sage
npm ci --production
npm run build
npm start
```

### Option 2: Docker Compose (Recommended)

```bash
# Start database + bot together
docker compose -f config/ci/docker-compose.yml up -d
```

### Option 3: With Self-Hosted Tool Stack

```bash
# Start local SearXNG, Crawl4AI, Ollama alongside Sage
docker compose -f config/ci/docker-compose.yml up -d
docker compose -f config/self-host/docker-compose.tools.yml up -d
```

For full tool stack details, see **[🧰 Self-Hosted Tool Stack](../operations/TOOL_STACK.md)**.

---

<a id="environment-setup"></a>

## ⚙️ Environment Setup

### Required Variables

```env
# Core
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://user:password@host:5432/sage

# LLM (at minimum)
POLLINATIONS_API_BASE_URL=https://text.pollinations.ai/openai
```

### Recommended Production Variables

```env
# Behavior
AUTOPILOT_MODE=manual
TRACE_ENABLED=true
LOG_LEVEL=info

# Security
ADMIN_USER_IDS_CSV=your_discord_user_id
ADMIN_ROLE_IDS_CSV=your_admin_role_id

# Performance
CONTEXT_MAX_INPUT_TOKENS=120000
CONTEXT_RESERVED_OUTPUT_TOKENS=12000
```

See **[⚙️ Configuration Reference](../reference/CONFIGURATION.md)** for all available variables.

---

<a id="database-setup"></a>

## 💾 Database Setup

### Initial Setup

```bash
# Push schema to database (development)
npm run db:push

# Or generate and run migrations (production)
npx prisma migrate deploy
```

### Schema Updates

When upgrading Sage:

```bash
git pull
npm ci
npm run db:push    # Sync schema changes
npm run build
npm start
```

> [!WARNING]
> Always back up your database before running schema migrations in production.

---

<a id="production-checklist"></a>

## ✅ Production Checklist

Use this checklist before going live:

- [ ] **Discord bot token** is set and valid
- [ ] **Database** is running and accessible
- [ ] **`npm run doctor`** passes all checks
- [ ] **`npm run check`** passes (lint + typecheck + tests)
- [ ] **Admin IDs** are configured (`ADMIN_USER_IDS_CSV`)
- [ ] **Tracing is enabled** (`TRACE_ENABLED=true`)
- [ ] **Log level** is appropriate (`LOG_LEVEL=info`)
- [ ] **BYOP key** is set for at least one server
- [ ] **Process manager** is configured (PM2, systemd, Docker restart policy)
- [ ] **Database backups** are scheduled

---

<a id="monitoring"></a>

## 📊 Monitoring

### Health Checks

```bash
# Built-in diagnostics
npm run doctor

# Admin-only Discord command
/sage admin stats
```

### Logs

Sage uses structured logging. Key log patterns to watch:

| Pattern | Meaning |
| :--- | :--- |
| `[info] Logged in as Sage#1234` | Bot started successfully |
| `[info] Ready!` | Bot is fully operational |
| `[error] P1001` | Database connection lost |
| `[warn] Model degraded` | A model is experiencing errors |

### Traces

Admin traces provide detailed insight into response generation:

```text
/sage admin trace          # View recent traces
/sage admin trace <id>     # View specific trace
```

---

## 🔗 Related Documentation

- [📖 Getting Started](../guides/GETTING_STARTED.md) — Initial setup walkthrough
- [⚙️ Configuration](../reference/CONFIGURATION.md) — All environment variables
- [📋 Operations Runbook](../operations/RUNBOOK.md) — Day-to-day operations
- [🧰 Self-Hosted Tool Stack](../operations/TOOL_STACK.md) — Local tool stack setup

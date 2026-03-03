# 🚀 Deployment Guide

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Deployment-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Deployment" />
</p>

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
| Node.js | >= 22.12 | LTS recommended |
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
# Start local SearXNG, Crawl4AI, and Tika alongside Sage
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
DISCORD_APP_ID=your_discord_app_id
DATABASE_URL=postgresql://user:password@host:5432/sage

# LLM (at minimum)
LLM_PROVIDER=pollinations
LLM_BASE_URL=https://gen.pollinations.ai/v1
```

### Recommended Production Variables

```env
# Behavior
AUTOPILOT_MODE=manual
TRACE_ENABLED=true
LOG_LEVEL=info

# Attachment extraction (recommended when file ingestion is enabled)
FILE_INGEST_TIKA_BASE_URL=http://127.0.0.1:9998

# Security
# Admin commands/tools use Discord-native permissions.
# Grant Manage Server or Administrator to approved moderators/admins in Discord.

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
# Apply tracked migrations
npx prisma migrate deploy
```

### Schema Updates

When upgrading Sage:

```bash
git pull
npm ci
npx prisma migrate deploy    # Apply schema changes from committed migrations
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
- [ ] **`npm run check:trust`** passes (lint + typecheck + trusted test audit)
- [ ] **Admin roles/users** in Discord have `Manage Server` or `Administrator`
- [ ] **Tracing is enabled** (`TRACE_ENABLED=true`)
- [ ] **Log level** is appropriate (`LOG_LEVEL=info`)
- [ ] **BYOP key** is set for at least one server
- [ ] **Tika is running** when file ingestion is enabled (`FILE_INGEST_TIKA_BASE_URL`)
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
| `[info] Successfully reloaded application (/) commands GLOBALLY.` | Slash commands are registered and runtime is operational |
| `[error] P1001` | Database connection lost |
| `[warn] Model degraded` | A model is experiencing errors |

### Traces

For detailed response diagnostics, inspect trace rows in the database:

```bash
npm run db:studio
```

---

## 🔗 Related Documentation

- [📖 Getting Started](../guides/GETTING_STARTED.md) — Initial setup walkthrough
- [⚙️ Configuration](../reference/CONFIGURATION.md) — All environment variables
- [📋 Operations Runbook](../operations/RUNBOOK.md) — Day-to-day operations
- [🧰 Self-Hosted Tool Stack](../operations/TOOL_STACK.md) — Local tool stack setup

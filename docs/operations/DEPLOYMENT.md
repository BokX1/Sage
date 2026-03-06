# 🚀 Deployment Guide

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Deployment-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Deployment" />
</p>

How to run Sage in production with the current repo layout.

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
| Node.js | `>= 22.12.0` | Required for the Sage process |
| PostgreSQL | Prisma-compatible | Required |
| Discord Bot Token | - | From the Discord Developer Portal |
| Discord App ID | - | Used for slash commands and invite generation |
| Pollinations key or server BYOP flow | - | Required for Pollinations-backed chat/image usage |
| Docker | Optional | Used by the repo's support-service compose files |

> [!NOTE]
> `config/services/core/docker-compose.yml` runs support services (`db` and `tika`). It does **not** run the Sage Node.js process for you.

---

<a id="deployment-options"></a>

## 🏗️ Deployment Options

### Option 1: Direct Node.js process

```bash
git clone https://github.com/BokX1/Sage.git
cd Sage
npm ci
npm run build
npm start
```

### Option 2: Use the repo's core support services

```bash
npm ci
docker compose -f config/services/core/docker-compose.yml up -d db tika
npx prisma migrate deploy
npm run build
npm start
```

This is the closest match to the repo's expected local/production shape: Postgres and Tika are containerized, while the Sage runtime itself runs as a normal Node.js process.

### Option 3: Add the self-hosted tool stack

```bash
npm ci
docker compose -f config/services/core/docker-compose.yml up -d db tika
docker compose -f config/services/self-host/docker-compose.tools.yml up -d
npx prisma migrate deploy
npm run build
npm start
```

This adds local SearXNG, Crawl4AI, and Tika-backed extraction paths. Sage still runs as its own process.

Optional social-graph infrastructure is separate:

```bash
docker compose -f docker-compose.social-graph.yml up -d
```

---

<a id="environment-setup"></a>

## ⚙️ Environment Setup

### Required variables

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_APP_ID=your_discord_app_id
DATABASE_URL=postgresql://user:password@host:5432/sage?schema=public
LLM_PROVIDER=pollinations
LLM_BASE_URL=https://gen.pollinations.ai/v1
```

### Recommended production variables

```env
AUTOPILOT_MODE=manual
TRACE_ENABLED=true
LOG_LEVEL=info
FILE_INGEST_TIKA_BASE_URL=http://127.0.0.1:9998
```

Key notes:

- If you do **not** set `LLM_API_KEY`, each server must configure a BYOP key with `/sage key set`.
- Admin commands and approval-gated actions use Discord-native permissions. Grant `Manage Server` or `Administrator` only to approved operators.
- Social-graph export is disabled by setting `KAFKA_BROKERS=`.

See **[⚙️ Configuration Reference](../reference/CONFIGURATION.md)** for the full environment surface.

---

<a id="database-setup"></a>

## 💾 Database Setup

### Initial setup

```bash
npx prisma migrate deploy
```

### Upgrades

When upgrading Sage:

```bash
git pull
npm ci
npx prisma migrate deploy
npm run build
npm start
```

> [!WARNING]
> Back up your database before production schema changes.

---

<a id="production-checklist"></a>

## ✅ Production Checklist

- [ ] `DISCORD_TOKEN` and `DISCORD_APP_ID` are set
- [ ] PostgreSQL is reachable from `DATABASE_URL`
- [ ] `npx prisma migrate deploy` completed successfully
- [ ] `npm run doctor` passes
- [ ] `npm run check:trust` passes on the release candidate
- [ ] Tika is reachable when file ingestion is enabled
- [ ] A global `LLM_API_KEY` is configured or operators know to use `/sage key set`
- [ ] `TRACE_ENABLED=true` if you want runtime trace rows
- [ ] Approved moderators/admins have `Manage Server` or `Administrator`
- [ ] Process supervision is configured (`systemd`, PM2, container restart policy, or similar)
- [ ] Database backups are scheduled

---

<a id="monitoring"></a>

## 📊 Monitoring

### Health checks

```bash
npm run doctor
```

Discord-side checks:

```text
/ping
/sage admin stats
```

### Logs

Useful log patterns:

| Pattern | Meaning |
| :--- | :--- |
| `[info] Logged in as` | Bot started successfully |
| `[info] Successfully reloaded application (/) commands` | Slash commands registered |
| `[error] P1001` | Database connection issue |
| `[warn] Model degraded` | Model health has dropped |

### Traces

For detailed response diagnostics, inspect trace rows in the database:

```bash
npm run db:studio
```

---

## 🔗 Related Documentation

- [📖 Getting Started](../guides/GETTING_STARTED.md) — Initial setup walkthrough
- [⚙️ Configuration](../reference/CONFIGURATION.md) — All environment variables
- [📋 Operations Runbook](RUNBOOK.md) — Day-to-day operations
- [🧰 Self-Hosted Tool Stack](TOOL_STACK.md) — Local tool stack setup

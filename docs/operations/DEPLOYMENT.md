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
| Discord App ID | - | Used for bot invite generation and Discord app identity |
| Explicit AI provider config or hosted server-key flow | - | Required for Sage to make upstream model requests |
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
docker compose -f config/services/self-host/docker-compose.social-graph.yml up -d
```

---

<a id="environment-setup"></a>

## ⚙️ Environment Setup

### Required variables

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_APP_ID=your_discord_app_id
DATABASE_URL=postgresql://user:password@host:5432/sage?schema=public
AI_PROVIDER_BASE_URL=https://your-provider.example/v1
```

These values show the provider-neutral runtime contract. `AI_PROVIDER_BASE_URL` can point at any OpenAI-compatible chat endpoint.

### Recommended production variables

```env
AUTOPILOT_MODE=manual
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=your_langsmith_api_key
LANGSMITH_PROJECT=sage
SAGE_TRACE_DB_ENABLED=true
LOG_LEVEL=info
FILE_INGEST_TIKA_BASE_URL=http://127.0.0.1:9998
```

Key notes:

- Preferred host auth path: run `npm run auth:codex:login` on the VM/host to configure one shared Codex OAuth login for the deployment.
- The login flow now follows the real host-side Codex pattern: Sage embeds the public client id, waits on `http://localhost:1455/auth/callback` first, and then falls back to a pasted redirect URL/code if the VM is remote or headless.
- When host Codex auth is healthy, Sage routes the main, profile, and summary text lanes to OpenAI/Codex automatically using the built-in `gpt-5.4` route.
- If you also set `AI_PROVIDER_API_KEY`, Sage uses it as the automatic host fallback when Codex auth is absent or unhealthy.
- If you do **not** configure either host Codex auth or `AI_PROVIDER_API_KEY`, Sage can still run in servers that complete the current hosted/server-key path. Direct-message chat still needs a host-level credential because there is no guild-scoped key to fall back to.
- Admin actions and approval-gated flows use Discord-native permissions. Grant `Manage Server` or `Administrator` only to approved operators.
- Social-graph export is disabled by setting `KAFKA_BROKERS=`.

See **[⚙️ Configuration Reference](../reference/CONFIGURATION.md)** for the full environment surface.

---

<a id="database-setup"></a>

## 💾 Database Setup

### Initial setup

```bash
npx prisma migrate deploy
```

Sage now ships a single current-schema Prisma baseline. For a fresh environment or an intentional hard reset, `npx prisma migrate deploy` applies that baseline directly, including `CREATE EXTENSION IF NOT EXISTS vector` for the pgvector-backed embedding tables.

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
> Sage's current Prisma history is a hard-reset baseline, not a layered compatibility chain. Treat upgrades as rebuild-oriented unless you have your own migration and rollback strategy.

---

<a id="production-checklist"></a>

## ✅ Production Checklist

- [ ] `DISCORD_TOKEN` and `DISCORD_APP_ID` are set
- [ ] PostgreSQL is reachable from `DATABASE_URL`
- [ ] `npx prisma migrate deploy` completed successfully
- [ ] `npm run doctor` passes
- [ ] `npm run check:trust` passes on the release candidate
- [ ] Tika is reachable when file ingestion is enabled
- [ ] If you want shared host Codex auth, `npm run auth:codex:status` reports an active login
- [ ] `AI_PROVIDER_BASE_URL`, `AI_PROVIDER_MAIN_AGENT_MODEL`, `AI_PROVIDER_PROFILE_AGENT_MODEL`, and `AI_PROVIDER_SUMMARY_AGENT_MODEL` are set explicitly for the fallback/default text provider route; if you use `AI_PROVIDER_MODEL_PROFILES_JSON`, treat it as optional operator metadata and verify Chat Completions tool-calling support with `npm run doctor -- --llm-ping` or `npm run ai-provider:probe`
- [ ] If you rely on the current hosted/server-key path, a no-key test guild still shows the setup card correctly
- [ ] If you want hosted execution tracing, set `LANGSMITH_TRACING=true` and provide `LANGSMITH_API_KEY`
- [ ] `SAGE_TRACE_DB_ENABLED=true` if you want compact `AgentTrace` ledger rows in Postgres
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

- `@Sage health check`
- `Sage, are you online?`
- In a no-key hosted guild, trigger Sage once and verify the setup card appears

### Logs

Useful log patterns:

| Pattern | Meaning |
| :--- | :--- |
| `[info] Logged in as` | Bot started successfully |
| `Cleared legacy Discord application commands...` | Startup cleaned stale slash-command registrations from older builds |
| `[error] P1001` | Database connection issue |

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

<p align="center">
  <img src="https://img.shields.io/badge/Sage-Discord%20Agentic%20Runtime-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage" />
</p>

<h1 align="center">Sage</h1>
<h3 align="center">Agentic Discord runtime with routing, tools, critic loops, and replay gates</h3>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge" alt="License" /></a>
  <a href="https://github.com/BokX1/Sage/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BokX1/Sage/ci.yml?style=for-the-badge&label=Build" alt="CI Status" /></a>
  <img src="https://img.shields.io/badge/Version-1.0.0-green?style=for-the-badge" alt="Version" />
</p>

> [!IMPORTANT]
> Sage is proprietary software (All Rights Reserved). Running, modifying, or distributing Sage requires written permission or a commercial license from the copyright owner. See `LICENSE` and `COPYRIGHT`.

---

## What Sage Is

Sage is a Discord bot runtime that routes each turn to specialized paths (`chat`, `coding`, `search`, `creative`), then executes bounded agentic workflows with context providers, tool calls, and critic-based quality control.

Core behaviors in the current codebase:

- Route-aware orchestration with search-mode selection (`simple` or `complex`)
- Context graph execution with canary controls and safe fallback
- Bounded tool-call loop with policy gates, blocklists, and per-turn cache
- Tool evidence hard-gate for freshness/source-sensitive turns
- Critic loop with revision, targeted redispatch, and optional tool-backed revisions
- Trace persistence, replay scoring, and release gate checks

---

## Built-in Runtime Tools

Sage registers these agentic tools at bootstrap:

- `get_current_datetime`
- `web_search`
- `web_scrape`
- `github_repo_lookup`
- `github_file_lookup`
- `npm_package_lookup`
- `wikipedia_lookup`
- `stack_overflow_search`
- `local_llm_models`
- `local_llm_infer`

Provider/fallback support includes:

- Search: Tavily, Exa, SearXNG, Pollinations
- Scrape: Firecrawl, Crawl4AI, Jina reader, raw fetch fallback
- Local inference: Ollama

---

## Quick Start

### Use the public bot

- Follow `docs/QUICKSTART.md`
- For BYOP key flow, use `/sage key login` then `/sage key set <key>`

### Self-host from source

```bash
git clone https://github.com/BokX1/Sage.git
cd Sage
npm ci
npm run onboard
docker compose -f config/ci/docker-compose.yml up -d db
npm run db:push
npm run dev
```

Expected startup logs:

```text
[info] Logged in as Sage#1234
[info] Ready!
```

---

## Production Start

```bash
npm run build
npm start
```

---

## Optional Local Tool Stack (Self-host-first)

Start local tool services:

```bash
docker compose -f config/self-host/docker-compose.tools.yml up -d
```

Recommended `.env` profile:

```env
TOOL_WEB_SEARCH_PROVIDER_ORDER=searxng,tavily,exa,pollinations
TOOL_WEB_SCRAPE_PROVIDER_ORDER=crawl4ai,firecrawl,jina,raw_fetch
SEARXNG_BASE_URL=http://127.0.0.1:8080
CRAWL4AI_BASE_URL=http://127.0.0.1:11235
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Validate tool wiring:

```bash
npm run tools:smoke
```

Full guide: `docs/operations/tool_stack.md`

---

## Developer Commands

```bash
npm run dev                 # run in watch mode (ts-node + nodemon)
npm run build               # compile TypeScript
npm start                   # run compiled bot
npm run check               # lint + typecheck + tests
npm run test                # run vitest suite
npm run db:push             # sync Prisma schema
npm run db:reset            # reset DB and re-sync schema
npm run tools:smoke         # smoke-test tool providers
npm run agentic:replay-gate # replay quality gate
npm run release:agentic-check
```

---

## Configuration

Main runtime config is in `.env` and validated by `src/shared/config/env.ts`.

Start from `.env.example`, then tune:

- Route/tool/critic policy: `AGENTIC_*`
- Context and output budgets: `CONTEXT_*`, `*_MAX_OUTPUT_TOKENS`
- Tool provider order/timeouts: `TOOL_WEB_*`, `SEARXNG_*`, `FIRECRAWL_*`, `CRAWL4AI_*`, `OLLAMA_*`

Reference: `docs/CONFIGURATION.md`

---

## Architecture Docs

- High-level: `docs/AGENTIC_ARCHITECTURE.md`
- Runtime pipeline: `docs/architecture/pipeline.md`
- Memory system: `docs/architecture/memory_system.md`
- Database schema: `docs/architecture/database.md`
- Operations runbook: `docs/operations/runbook.md`
- Docs hub: `docs/README.md`

---

## Project Structure

```text
src/                 bot runtime and agentic core
src/core/agentRuntime route orchestration, tool loop, critic, tracing
tests/               unit and integration tests (Vitest)
prisma/              Prisma schema and DB model
docs/                user, ops, and architecture documentation
config/              CI + self-host tool stack configs
```

---

## Security and Data

See:

- `docs/security_privacy.md`
- `SECURITY.md`

---

## Contributing and Conduct

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`

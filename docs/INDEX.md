# 📚 Sage Documentation

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Docs-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Docs" />
  <img src="https://img.shields.io/badge/Version-1.0.0-green?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/License-PolyForm%20Strict%201.0.0-red?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <strong>Everything you need to run, configure, and understand Sage.</strong>
</p>

> [!IMPORTANT]
> Sage is source-available under PolyForm Strict 1.0.0. Noncommercial use is permitted. Redistribution, modification, and derivative works are not permitted under the public license. Commercial/business use requires a separate written license (<Ahazihak03@gmail.com>). See [LICENSE](../LICENSE) and [COPYRIGHT](../COPYRIGHT).

---

## 🎯 Choose Your Path

Pick the journey that fits your role:

### 🎮 "I just want to use the bot"

```text
Invite → Activate → Chat
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [⚡ Quick Start](guides/QUICKSTART.md) — Invite, activate BYOP, start chatting | ~5 min |
| 2️⃣ | [🎮 Commands Reference](guides/COMMANDS.md) — All slash commands + image gen + search | ~10 min |
| 3️⃣ | [❓ FAQ](guides/FAQ.md) — Common questions answered | As needed |

---

### 💻 "I want to self-host Sage"

```text
Clone → Configure → Deploy → Operate
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [📖 Getting Started](guides/GETTING_STARTED.md) — Discord app, `.env`, database, onboarding | ~30 min |
| 2️⃣ | [⚙️ Configuration](reference/CONFIGURATION.md) — Tune behavior, memory, and limits | ~15 min |
| 3️⃣ | [🧰 Self-Hosted Tool Stack](operations/TOOL_STACK.md) — Local SearXNG/Crawl4AI/Tika | ~20 min |
| 4️⃣ | [📋 Operations Runbook](operations/RUNBOOK.md) — Production monitoring + maintenance | Reference |

---

### 🏗️ "I want to understand how Sage works"

```text
Architecture → Pipeline → Memory → Database
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [🤖 Agentic Architecture](architecture/OVERVIEW.md) — Single-agent design, 26 tools, and runtime flow | ~15 min |
| 2️⃣ | [🔀 Runtime Pipeline](architecture/PIPELINE.md) — Message flow through agent + tool loop | ~20 min |
| 3️⃣ | [🧠 Memory System](architecture/MEMORY.md) — Summaries, profiles, context budgeting | ~15 min |
| 4️⃣ | [💾 Database Schema](architecture/DATABASE.md) — 18 tables, relationships, ERD | ~10 min |
| 5️⃣ | [🕸️ Social Graph](architecture/SOCIAL_GRAPH.md) — GNN pipeline, Memgraph, relationship intelligence | ~15 min |

---

## 📖 Complete Documentation Index

### 📘 Guides

| Document | Description |
| :--- | :--- |
| [⚡ Quick Start](guides/QUICKSTART.md) | Run Sage in ~5 minutes |
| [📖 Getting Started](guides/GETTING_STARTED.md) | Full setup from source (step-by-step) |
| [🎮 Commands Reference](guides/COMMANDS.md) | Slash commands, triggers, image gen, and search |
| [❓ FAQ](guides/FAQ.md) | Common questions about setup and behavior |
| [🔧 Troubleshooting](guides/TROUBLESHOOTING.md) | Fixes for common failures and misconfigurations |
| [🌸 BYOP Mode](guides/BYOP.md) | Bring-Your-Own-Pollen key setup |

### 📗 Reference

| Document | Description |
| :--- | :--- |
| [⚙️ Configuration](reference/CONFIGURATION.md) | All 100+ environment variables explained with defaults |
| [🧩 Model Reference](reference/MODELS.md) | Model resolution, health tracking, and fallbacks |
| [🐝 Pollinations Integration](reference/POLLINATIONS.md) | Provider overview (text/vision/images) + API details |
| [🔌 API Examples](reference/API_EXAMPLES.md) | Annotated `curl` examples for Pollinations calls + optional voice-service STT calls |
| [🚢 Release Process](reference/RELEASE.md) | SemVer workflow, changelog, and CI checks |

### 📙 Architecture

| Document | Description |
| :--- | :--- |
| [🤖 Agentic Overview](architecture/OVERVIEW.md) | Single-agent design, 26 tools, tool registry, and reliability model |
| [🔀 Runtime Pipeline](architecture/PIPELINE.md) | Message flow, context assembly, tool call loop, and trace outputs |
| [🔍 Search Architecture](architecture/SEARCH.md) | SAG flow, search modes, tool providers |
| [🧠 Memory System](architecture/MEMORY.md) | How Sage stores, summarizes, and injects memory |
| [🎤 Voice System](architecture/VOICE.md) | Voice awareness + optional transcription |
| [💾 Database Schema](architecture/DATABASE.md) | 18 PostgreSQL tables, ERD, and common operations |
| [🕸️ Social Graph](architecture/SOCIAL_GRAPH.md) | GNN pipeline, Memgraph, and relationship intelligence |

### 📕 Operations

| Document | Description |
| :--- | :--- |
| [📋 Operations Runbook](operations/RUNBOOK.md) | Production health checks, validation, and incident response |
| [🚀 Deployment Guide](operations/DEPLOYMENT.md) | Deploy to production with Docker or Node.js |
| [🧰 Self-Hosted Tool Stack](operations/TOOL_STACK.md) | SearXNG, Crawl4AI, Tika — local-first with hosted fallback |
| [🛠️ Social Graph Setup](operations/SOCIAL_GRAPH_SETUP.md) | Memgraph + Redpanda infrastructure and GNN module ops |

### 📓 Security

| Document | Description |
| :--- | :--- |
| [🔒 Security & Privacy](security/SECURITY_PRIVACY.md) | What Sage stores, retention policies, and privacy controls |

---

## 🆘 Need Help?

```text
npm run doctor → Troubleshooting → FAQ → GitHub Issue
```

1. Run `npm run doctor` — catches the majority of setup problems
2. Check **[🔧 Troubleshooting](guides/TROUBLESHOOTING.md)** — fast fixes for common issues
3. Browse **[❓ FAQ](guides/FAQ.md)** — answers to frequent questions
4. Open an issue: <https://github.com/BokX1/Sage/issues>

---

*Built with 💚 using [Pollinations.ai](https://pollinations.ai)*

<p align="right"><a href="#top">⬆️ Back to top</a></p>

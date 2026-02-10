# 📚 Sage Documentation

<p align="center">
  <img src="https://img.shields.io/badge/🌿-Sage%20Docs-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Documentation" />
  <img src="https://img.shields.io/badge/Version-1.0.0-green?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <strong>Everything you need to run, configure, and understand Sage.</strong>
</p>

> [!IMPORTANT]
> Sage is proprietary software (All Rights Reserved). Usage, modification, or distribution requires written permission or a commercial license from the copyright owner. See [LICENSE](../LICENSE) and [COPYRIGHT](../COPYRIGHT).

---

## 🎯 Choose Your Path

Pick the journey that fits your role:

### 🎮 "I just want to use the bot"

```
Invite → Activate → Chat
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [⚡ Quick Start](guides/QUICKSTART.md) — Invite, activate BYOP, start chatting | ~5 min |
| 2️⃣ | [🎮 Commands Reference](guides/COMMANDS.md) — All slash commands + image gen + search | ~10 min |
| 3️⃣ | [❓ FAQ](guides/FAQ.md) — Common questions answered | As needed |

---

### 💻 "I want to self-host Sage"

```
Clone → Configure → Deploy → Operate
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [📖 Getting Started](guides/GETTING_STARTED.md) — Discord app, `.env`, database, onboarding | ~30 min |
| 2️⃣ | [⚙️ Configuration](reference/CONFIGURATION.md) — Tune behavior, memory, and limits | ~15 min |
| 3️⃣ | [🧰 Self-Hosted Tool Stack](operations/TOOL_STACK.md) — Local SearXNG/Crawl4AI/Ollama | ~20 min |
| 4️⃣ | [📋 Operations Runbook](operations/RUNBOOK.md) — Production monitoring + maintenance | Reference |

---

### 🏗️ "I want to understand how Sage works"

```
Architecture → Pipeline → Memory → Database
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [🤖 Agentic Architecture](architecture/OVERVIEW.md) — What makes Sage "agentic" | ~15 min |
| 2️⃣ | [🔀 Runtime Pipeline](architecture/PIPELINE.md) — Message flow through agents + tools | ~20 min |
| 3️⃣ | [🧠 Memory System](architecture/MEMORY.md) — Summaries, profiles, context budgeting | ~15 min |
| 4️⃣ | [💾 Database Schema](architecture/DATABASE.md) — Tables, relationships, ERD | ~10 min |

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
| [⚙️ Configuration](reference/CONFIGURATION.md) | All environment variables explained with defaults |
| [🧩 Model Reference](reference/MODELS.md) | Model chains, resolution flow, health fallbacks |
| [🐝 Pollinations Integration](reference/POLLINATIONS.md) | Provider overview (text/vision/images) + API details |
| [🔌 API Examples](reference/API_EXAMPLES.md) | Annotated `curl` examples for all Pollinations API calls |
| [🚢 Release Process](reference/RELEASE.md) | SemVer workflow, changelog, and CI checks |

### 📙 Architecture

| Document | Description |
| :--- | :--- |
| [🤖 Agentic Overview](architecture/OVERVIEW.md) | High-level agentic design — agent selection, governance, search |
| [🔀 Runtime Pipeline](architecture/PIPELINE.md) | Message routing, context providers, tool execution |
| [🔍 Search Architecture](architecture/SEARCH.md) | SAG flow, search modes, tool providers |
| [🧠 Memory System](architecture/MEMORY.md) | How Sage stores, summarizes, and injects memory |
| [🎤 Voice System](architecture/VOICE.md) | Voice awareness + voice companion (beta) |
| [💾 Database Schema](architecture/DATABASE.md) | PostgreSQL tables, relationships, and ERD |

### 📕 Operations

| Document | Description |
| :--- | :--- |
| [📋 Operations Runbook](operations/RUNBOOK.md) | Production operations, monitoring, and recovery |
| [🚀 Deployment Guide](operations/DEPLOYMENT.md) | Deploy to production with Docker or Node.js |
| [🧰 Self-Hosted Tool Stack](operations/TOOL_STACK.md) | SearXNG, Crawl4AI, Ollama — local-first with hosted fallback |

### 📓 Security

| Document | Description |
| :--- | :--- |
| [🔒 Security & Privacy](security/SECURITY_PRIVACY.md) | What Sage stores, retention policies, and privacy controls |

---

## 🆘 Need Help?

```
npm run doctor → Troubleshooting → FAQ → GitHub Issue
```

1. Run `npm run doctor` — catches the majority of setup problems
2. Check **[🔧 Troubleshooting](guides/TROUBLESHOOTING.md)** — fast fixes for common issues
3. Browse **[❓ FAQ](guides/FAQ.md)** — answers to frequent questions
4. Open an issue: <https://github.com/BokX1/Sage/issues>

---

<p align="center">
  <em>Built with 💚 using <a href="https://pollinations.ai">Pollinations.ai</a></em>
</p>

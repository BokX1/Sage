# 📚 Sage Documentation

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Docs-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Docs" />
  <img src="https://img.shields.io/badge/Version-1.0.0-green?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <strong>Everything you need to run, configure, and understand Sage.</strong>
</p>

> [!IMPORTANT]
> Sage is released under the [MIT License](../LICENSE).

---

## 🎯 Choose Your Path

Pick the journey that fits your role:

### 🎮 "I want to use Sage in Discord"

```text
Invite → Activate → Chat
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [⚡ Quick Start](guides/QUICKSTART.md) — Join an existing deployment or self-host quickly | ~5 min |
| 2️⃣ | [💬 Conversation & Controls](guides/COMMANDS.md) — Chat triggers, setup controls, voice control, and admin action patterns | ~10 min |
| 3️⃣ | [❓ FAQ](guides/FAQ.md) — Common questions about setup, behavior, and data storage | As needed |

---

### 💻 "I want to self-host Sage"

```text
Clone → Configure → Deploy → Operate
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [📖 Getting Started](guides/GETTING_STARTED.md) — Discord app, `.env`, database, onboarding, invite flow | ~30 min |
| 2️⃣ | [⚙️ Configuration](reference/CONFIGURATION.md) — Environment variables, grouped by subsystem | ~15 min |
| 3️⃣ | [🧰 Self-Hosted Tool Stack](operations/TOOL_STACK.md) — Local SearXNG, Crawl4AI, and Tika | ~20 min |
| 4️⃣ | [📋 Operations Runbook](operations/RUNBOOK.md) — Validation, monitoring, and maintenance | Reference |

---

### 🏗️ "I want to understand how Sage works"

```text
Architecture → Pipeline → Memory → Database
```

| Step | Document | Time |
| :--- | :--- | :--- |
| 1️⃣ | [🤖 Agentic Architecture](architecture/OVERVIEW.md) — Single-agent design, 15 built-in tools, runtime flow | ~15 min |
| 2️⃣ | [🔀 Runtime Pipeline](architecture/PIPELINE.md) — Context assembly, LangGraph runtime flow, and trace outputs | ~20 min |
| 3️⃣ | [🧠 Memory System](architecture/MEMORY.md) — Transcript retention, summaries, profiles, and on-demand retrieval | ~15 min |
| 4️⃣ | [💾 Database Schema](architecture/DATABASE.md) — 17 Prisma models and common operations | ~10 min |
| 5️⃣ | [🕸️ Social Graph](architecture/SOCIAL_GRAPH.md) — Optional Memgraph/Redpanda export and analytics design | ~15 min |

---

## 📖 Complete Documentation Index

### 📘 Guides

| Document | Description |
| :--- | :--- |
| [⚡ Quick Start](guides/QUICKSTART.md) | Fastest path to an existing deployment or a minimal self-host setup |
| [📖 Getting Started](guides/GETTING_STARTED.md) | Full setup from source (step-by-step) |
| [💬 Conversation & Controls](guides/COMMANDS.md) | Chat triggers, setup controls, voice control, and approval-gated admin actions |
| [❓ FAQ](guides/FAQ.md) | Common questions about setup, behavior, and privacy |
| [🔧 Troubleshooting](guides/TROUBLESHOOTING.md) | Fixes for common failures and misconfigurations |
| [🌸 BYOP Mode](guides/BYOP.md) | Bring-Your-Own-Pollen key setup |

### 📗 Reference

| Document | Description |
| :--- | :--- |
| [⚙️ Configuration](reference/CONFIGURATION.md) | Environment variables, grouped by runtime area |
| [🧩 Model Reference](reference/MODELS.md) | Single-agent model resolution, health tracking, and search fallbacks |
| [🐝 Pollinations Integration](reference/POLLINATIONS.md) | Current Pollinations-backed hosted/default flows plus built-in BYOP and image integration |
| [🔌 API Examples](reference/API_EXAMPLES.md) | Annotated `curl` examples for the current Pollinations integration and the optional voice service |
| [🚢 Release Process](reference/RELEASE.md) | SemVer workflow, changelog, and CI checks |

### 📙 Architecture

| Document | Description |
| :--- | :--- |
| [🤖 Agentic Overview](architecture/OVERVIEW.md) | Single-agent design, tool registry, and reliability model |
| [🔀 Runtime Pipeline](architecture/PIPELINE.md) | Message flow, context assembly, LangGraph runtime flow, and trace outputs |
| [🔍 Search Architecture](architecture/SEARCH.md) | SAG flow, web providers, and guarded search fallbacks |
| [🧠 Memory System](architecture/MEMORY.md) | How Sage stores memory and fetches richer context on demand |
| [🎤 Voice System](architecture/VOICE.md) | Voice awareness plus optional local transcription |
| [💾 Database Schema](architecture/DATABASE.md) | PostgreSQL schema, ERD, and common operations |
| [🕸️ Social Graph](architecture/SOCIAL_GRAPH.md) | Event export, Memgraph analytics, and query behavior |

### 📕 Operations

| Document | Description |
| :--- | :--- |
| [📋 Operations Runbook](operations/RUNBOOK.md) | Production health checks, validation, and incident response |
| [🚀 Deployment Guide](operations/DEPLOYMENT.md) | Run Sage with Node.js plus the repo's compose-managed support services |
| [🧰 Self-Hosted Tool Stack](operations/TOOL_STACK.md) | SearXNG, Crawl4AI, and Tika with hosted fallback |
| [🛠️ Social Graph Setup](operations/SOCIAL_GRAPH_SETUP.md) | Memgraph + Redpanda setup, topic creation, and manual analytics ops |

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

*Provider-flexible runtime docs. Pollinations is documented here as Sage's current hosted/default integration and built-in BYOP/image path.*

<p align="right"><a href="#top">⬆️ Back to top</a></p>

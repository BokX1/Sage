# 📚 Sage Documentation

<p align="center">
  <img src="https://img.shields.io/badge/🌿-Sage%20Docs-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Documentation" />
</p>

Sage documentation is organized to support two common goals:

- 🎮 **Run Sage quickly** (public bot or minimal setup)
- 💻 **Self-host and develop** (from source, with full configuration control)

> [!IMPORTANT]
> Sage is proprietary software (All Rights Reserved). Usage, modification, or distribution requires written permission or a commercial license from the copyright owner. See ../LICENSE and ../COPYRIGHT.

---

## 🚀 Quick Navigation

### Getting Started

| Document | Best For |
| :--- | :--- |
| [⚡ Quick Start](QUICKSTART.md) | Run Sage in ~5 minutes |
| [📖 Getting Started](GETTING_STARTED.md) | Set up Sage from source (step-by-step) |
| [⚙️ Configuration](CONFIGURATION.md) | Tune behavior, memory, and limits |

### Usage & Commands

| Document | Best For |
| :--- | :--- |
| [🎮 Commands Reference](COMMANDS.md) | Slash commands, triggers, and **image generation/editing** usage |
| [❓ FAQ](FAQ.md) | Common questions |
| [🔧 Troubleshooting](TROUBLESHOOTING.md) | Fixes for common failures and misconfig |

### Architecture & Technical

| Document | Best For |
| :--- | :--- |
| [🤖 Agentic Architecture](AGENTIC_ARCHITECTURE.md) | What makes Sage “agentic” (high-level) |
| [🧠 Memory System](architecture/memory_system.md) | How Sage stores/summarizes context |
| [🔀 Runtime Pipeline](architecture/pipeline.md) | How messages flow through agent selection, context providers, and tools |
| [💾 Database](architecture/database.md) | Storage model + schema overview |

### Operations & Security

| Document | Best For |
| :--- | :--- |
| [📋 Operations Runbook](operations/runbook.md) | Operating Sage in production |
| [🔒 Security & Privacy](security_privacy.md) | What Sage stores and how to control it |
| [🐝 Pollinations Integration](POLLINATIONS.md) | Provider overview (text/vision/images) + BYOP key flow |
| [🌸 BYOP Mode](BYOP_MODE.md) | Bring-Your-Own-Pollen setup (keys) |

---

## 🎯 Start Here

### "I just want to use the bot"

1. **[Quick Start Guide](QUICKSTART.md)** — Invite + activate
2. **[Commands Reference](COMMANDS.md)** — What to run in Discord
3. **[FAQ](FAQ.md)** — Common questions

### "I want to self-host Sage"

1. **[Getting Started](GETTING_STARTED.md)** — Create bot, configure `.env`, run locally
2. **[Configuration](CONFIGURATION.md)** — Tune behavior and budgets
3. **[Operations Runbook](operations/runbook.md)** — Production notes

### "I want to understand how Sage works"

1. **[Agentic Architecture](AGENTIC_ARCHITECTURE.md)** — Mental model (why/how)
2. **[Runtime Pipeline](architecture/pipeline.md)** — Message routing + orchestration
3. **[Memory System](architecture/memory_system.md)** — Summaries, profiles, context budgeting
4. **[Database Schema](architecture/database.md)** — Tables and relationships

---

## 🆘 Need Help?

- Start with **[Troubleshooting](TROUBLESHOOTING.md)**
- Then check **[FAQ](FAQ.md)**
- If you’re still blocked, open an issue on GitHub: <https://github.com/BokX1/Sage/issues>

---

<p align="center">
  <em>Built with 💚 using <a href="https://pollinations.ai">Pollinations.ai</a></em>
</p>

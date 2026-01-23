<p align="center">
  <img src="https://img.shields.io/badge/🌿-Sage-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Logo" />
</p>

<h1 align="center">Sage</h1>
<h3 align="center">Fully Agentic Intelligence for Discord</h3>

<p align="center">
  <a href="https://pollinations.ai"><img src="https://img.shields.io/badge/Built%20with-Pollinations.ai-8a2be2?style=for-the-badge&logo=data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20viewBox%3D%220%200%20124%20124%22%3E%3Ccircle%20cx%3D%2262%22%20cy%3D%2262%22%20r%3D%2262%22%20fill%3D%22%23ffffff%22/%3E%3C/svg%3E&logoColor=white&labelColor=6a0dad" alt="Built with Pollinations" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-ISC-blue?style=for-the-badge" alt="License" /></a>
  <a href="https://github.com/BokX1/Sage/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BokX1/Sage/ci.yml?style=for-the-badge&label=Build" alt="CI Status" /></a>
  <img src="https://img.shields.io/badge/Version-1.0.0-green?style=for-the-badge" alt="Version" />
</p>

<p align="center">
  <strong>Sage is a self-learning AI companion that grows with your community, observes social vibes, and delivers intelligent, context-aware responses.</strong>
</p>

<p align="center">
  <strong>🎮 <a href="docs/QUICKSTART.md">I just want to run the bot</a></strong> · <strong>💻 <a href="#-quick-start">I'm a developer</a></strong>
</p>

---

## 🎯 What is Sage?

Sage is a **Fully Agentic Discord companion** that goes beyond simple chat commands. Unlike traditional bots, Sage is designed to be a friendly member of your community who **listens and evolves alongside you**:

- 🧠 **Self-Learning Memory**: Remembers past conversations to build personalized user contexts.
- 👥 **Socially Aware**: Understands relationship tiers (Best Friend, Acquaintance) and interaction "vibes."
- 👁️ **Vision & Image Analysis**: Ingests images to discuss visual content and extract information.
- 📄 **Knowledge Base**: Ingests code files and text documents to provide expert-level analysis.
- 💬 **Intelligent Routing**: Uses a high-precision LLM classifier to resolve pronouns and context.

**Perfect for:** Coding communities • Gaming groups • Research teams • Any Discord that wants a bot that "gets it."

---

## 🏛️ High-Level Architecture

```mermaid
graph TD
    User((User)) -- "Message/Reply/Mention" --> Sage[Sage Bot]
    Sage --> Router{LLM Router}
    Router -- "Summarize" --> Summarizer[Summarizer Expert]
    Router -- "Social" --> Social[Social Graph Expert]
    Router -- "Voice" --> Voice[Voice Expert]
    Router -- "General/Memory" --> Memory[Memory Expert]
    
    Social --> Context[Context Builder]
    Voice --> Context
    Memory --> Context
    Summarizer --> Context
    
    Context --> LLM[LLM Brain]
    LLM -- "Tools/Reply" --> Sage
    Sage -- "Chat Response" --> User
```

---

## ✨ Features

| Feature | Description |
|:--------|:------------|
| 🧠 **Agentic Memory** | Builds long-term preferences and throttles updates for efficiency |
| 👁️ **Vision Support** | Analyzes and discusses images shared in chat |
| 📄 **File Analysis** | Share `.ts`, `.py`, `.txt` files for instant review or discussion |
| 🎤 **Voice Insights** | Tracks presence and duration, translating raw data into natural language |
| 🤝 **Social Graph** | Visualizes relationship tiers and interaction patterns with emojis |
| 🚀 **Self-Correcting** | Autonomous tool loop with error recovery for high reliability |
| ⚡ **Powered by Pollinations.ai** | Fast, high-throughput multi-model AI access |

---

## 🚀 Quick Start

### Option 1: Use the Public Bot (Recommended)

**Zero coding required.** Just invite the bot and bring your own API key (BYOP).

1. [**Invite Sage**](https://discord.com/oauth2/authorize?client_id=1462117382398017667&scope=bot%20applications.commands&permissions=8)
2. Type `/sage key login` to get your free API key.
3. Type `/sage key set <key>` to start chatting!

[**Read the full Quick Start Guide**](docs/QUICKSTART.md)

---

## 💬 Using Sage

### How to Trigger

Once activated, you can talk to Sage in 3 ways:

- **Prefix**: Start a message with "**Sage**" (e.g., *Sage, summarize the code I just sent*)
- **Mention**: Tag the bot anywhere (**@Sage**)
- **Reply**: Just **reply** to any of Sage's previous messages.

### Slash Commands

| Command | Description | Admin Only |
|:--------|:------------|:-----------|
| `/ping` | Check if Sage is online | No |
| `/sage whoiswho [user]` | View relationship info and tiers | No |
| `/sage admin trace` | **New!** View decision reasoning behind any response | Yes |
| `/sage key set` | Configure your Pollinations API Key (BYOP) | Yes |

---

## ⚙️ Configuration (Recommended Default)

Sage is optimized for community interaction out of the box.

```env
# behavior
AUTOPILOT_MODE=manual      # Recommended for stability
PROFILE_UPDATE_INTERVAL=5  # Update user knowledge every 5 messages
TRACE_ENABLED=true         # enable observability for admins
```

See [Configuration Reference](docs/CONFIGURATION.md) for full details.

---

## 📚 Documentation

| Document | Description |
|:---------|:------------|
| [📚 Documentation Hub](docs/README.md) | **Start here** — Complete navigation index |
| [⚡ Quick Start](docs/QUICKSTART.md) | 5-minute setup for new users |
| [📖 Getting Started](docs/GETTING_STARTED.md) | Complete beginner walkthrough |
| [🎮 Commands](docs/COMMANDS.md) | Full slash command reference |
| [❓ FAQ](docs/FAQ.md) | Frequently asked questions |
| [🔧 Troubleshooting](docs/TROUBLESHOOTING.md) | Error resolution guide |
| [⚙️ Configuration](docs/CONFIGURATION.md) | All settings explained |
| [🤖 Agentic Architecture](docs/AGENTIC_ARCHITECTURE.md) | What makes Sage different |
| [🏗️ Architecture](docs/architecture/) | Technical deep-dives |
| [🔒 Security & Privacy](docs/security_privacy.md) | Data handling and privacy |
| [🐝 Pollinations](docs/POLLINATIONS.md) | AI provider details |
| [📋 Operations](docs/operations/runbook.md) | Deployment guide |

---

## 💚 Why Choose Sage?

| Feature | Traditional Bots | Sage |
|:--------|:-----------------|:-----|
| **Memory** | Forgets after each message | Remembers and learns over time |
| **Social Awareness** | Treats all users the same | Understands relationships and vibes |
| **Context** | Limited to current message | Full conversation + user history |
| **Error Recovery** | Fails silently | Self-corrects with retry loops |
| **Adaptation** | Static responses | Evolves with your community |

[Learn more about Sage's Agentic Architecture →](docs/AGENTIC_ARCHITECTURE.md)

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
  <strong>🎮 <a href="docs/QUICKSTART.md">I just want to run the bot</a></strong> · <strong>💻 <a href="#-developer-quick-start">I'm a developer</a></strong>
</p>

---

## 🧭 Quick navigation

- [🎯 What is Sage?](#what-is-sage)
- [🏛️ High-Level Architecture](#high-level-architecture)
- [✨ Features](#features)
- [🚀 Getting Started](#getting-started)
- [💻 Developer Quick Start](#developer-quick-start)
- [🛠️ Configuration](#configuration)
- [📚 Documentation](#documentation)
- [💚 Why Choose Sage?](#why-choose-sage)

---

<a id="what-is-sage"></a>

## 🎯 What is Sage?

Sage is a **fully agentic Discord companion** that goes beyond simple chat commands. Unlike traditional bots, Sage is designed to be a friendly member of your community who **listens and evolves alongside you**:

- 🧠 **Self-Learning Memory**: Remembers past conversations to build personalized user contexts.
- 👥 **Socially Aware**: Understands relationship tiers (Best Friend, Acquaintance) and interaction "vibes."
- 👁️ **Vision & Image Analysis**: Ingests images to discuss visual content and extract information.
- 📄 **Knowledge Base**: Ingests code files and text documents to provide expert-level analysis.
- 💬 **Intelligent Routing**: Uses a high-precision LLM classifier to resolve pronouns and context.

**Perfect for:** Coding communities • Gaming groups • Research teams • Any Discord that wants a bot that "gets it."

---

<a id="high-level-architecture"></a>

## 🏛️ High-Level Architecture

```mermaid
flowchart LR
    %% Keep the diagram left-to-right to reduce vertical scroll on GitHub.
    classDef user fill:#f96,stroke:#333,stroke-width:2px,color:black
    classDef bot fill:#9d9,stroke:#333,stroke-width:2px,color:black
    classDef router fill:#b9f,stroke:#333,stroke-width:2px,color:black
    classDef expert fill:#fff,stroke:#333,stroke-width:1px,stroke-dasharray: 5 5,color:black
    classDef context fill:#ff9,stroke:#333,stroke-width:2px,color:black

    U((User)):::user -->|"Message / reply / mention"| B[Sage Bot]:::bot
    B --> R{LLM Router}:::router

    subgraph Experts
        direction TB
        S[📊 Summarizer]:::expert
        G[👥 Social Graph]:::expert
        V[🎤 Voice Analytics]:::expert
        M[🧠 Memory]:::expert
    end

    R --> S
    R --> G
    R --> V
    R --> M

    S --> C[Context Builder]:::context
    G --> C
    V --> C
    M --> C

    C --> L[LLM Brain]:::router --> B
    B -->|"Chat response"| U

    B -->|"Voice trigger"| T[TTS Generator]:::bot --> VC[(Voice Channel)]:::user
    VC -.-> U
```

---

<a id="features"></a>

## ✨ Features

| Feature | Description |
| :--- | :--- |
| 🧠 **Agentic Memory** | Builds long-term preferences and throttles updates for efficiency |
| 👁️ **Vision Support** | Analyzes and discusses images shared in chat |
| 📄 **File Analysis** | Share `.ts`, `.py`, `.txt` files for instant review or discussion |
| 🎤 **Voice Companion (Beta)** | Text-to-speech companion with dynamic personas (BYOP required) |
| 📊 **Voice Insights** | Tracks presence and duration, translating raw data into natural language |
| 🤝 **Social Graph** | Visualizes relationship tiers and interaction patterns with emojis |
| 🚀 **Self-Correcting** | Autonomous tool loop with error recovery for high reliability |
| ⚡ **Powered by Pollinations.ai** | Fast, high-throughput multi-model AI access |

---

<a id="getting-started"></a>

## 🚀 Getting Started

### Option A: Use the public bot

1. **Invite Sage**

   [**Click here to invite Sage to your server**](https://discord.com/api/oauth2/authorize?client_id=1211723232808570971&permissions=414464731200&scope=bot%20applications.commands)

2. **Activate BYOP (recommended for higher limits)**

   - Run `/sage key login` to get your Pollinations key.
   - Run `/sage key set <your_key>` to activate Sage for the entire server.

> [!TIP]
> Prefer least-privilege permissions? Generate a custom invite URL in the Discord Developer Portal (see [Getting Started → Invite Bot](docs/GETTING_STARTED.md#step-6-invite-sage-to-your-server)).

### Option B: Self-host from source

Follow **[📖 Getting Started](docs/GETTING_STARTED.md)** for a full walkthrough (Node.js, Docker/Postgres, onboarding wizard, and invite generation).

---

<a id="developer-quick-start"></a>

## 💻 Developer Quick Start

> [!NOTE]
> This is a fast path. For a complete setup (including creating a Discord app), use [Getting Started](docs/GETTING_STARTED.md).

```bash
git clone https://github.com/BokX1/Sage.git
cd Sage
npm install
npm run onboard
docker compose -f config/ci/docker-compose.yml up -d db
npm run db:migrate
npm run dev
```

When Sage starts, you should see:

```text
[info] Logged in as Sage#1234
[info] Ready!
```

---

<a id="configuration"></a>

## 🛠️ Configuration

Sage is optimized for community interaction out of the box.

```env
# behavior
AUTOPILOT_MODE=manual      # Recommended for stability
PROFILE_UPDATE_INTERVAL=5  # Update user knowledge every 5 messages
TRACE_ENABLED=true         # enable observability for admins
```

See [Configuration Reference](docs/CONFIGURATION.md) for full details.

---

<a id="documentation"></a>

## 📚 Documentation

| Document | Description |
| :--- | :--- |
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

<a id="why-choose-sage"></a>

## 💚 Why Choose Sage?

| Feature | Traditional Bots | Sage |
| :--- | :--- | :--- |
| **Memory** | Forgets after each message | Remembers and learns over time |
| **Social Awareness** | Treats all users the same | Understands relationships and vibes |
| **Context** | Limited to current message | Full conversation + user history |
| **Error Recovery** | Fails silently | Self-corrects with retry loops |
| **Adaptation** | Static responses | Evolves with your community |

[Learn more about Sage's Agentic Architecture →](docs/AGENTIC_ARCHITECTURE.md)

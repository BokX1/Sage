<p align="center">
  <img src="https://img.shields.io/badge/🌿-Sage-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Logo" />
</p>

<h1 align="center">Sage</h1>
<h3 align="center">Agentic Intelligence for Discord</h3>

<p align="center">
  <a href="https://pollinations.ai"><img src="https://img.shields.io/badge/Built%20with-Pollinations.ai-8a2be2?style=for-the-badge&logo=data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20viewBox%3D%220%200%20124%20124%22%3E%3Ccircle%20cx%3D%2262%22%20cy%3D%2262%22%20r%3D%2262%22%20fill%3D%22%23ffffff%22/%3E%3C/svg%3E&logoColor=white&labelColor=6a0dad" alt="Built with Pollinations" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-ISC-blue?style=for-the-badge" alt="License" /></a>
  <a href="https://github.com/BokX1/Sage/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BokX1/Sage/ci.yml?style=for-the-badge&label=Build" alt="CI Status" /></a>
  <img src="https://img.shields.io/badge/Version-1.0.0-green?style=for-the-badge" alt="Version" />
</p>

<p align="center">
  <strong>Sage remembers your conversations, understands your community, and delivers intelligent responses that feel personal.</strong>
</p>

---

## 🎯 What is Sage?

Sage is an **intelligent Discord bot** that goes beyond simple chat commands. Unlike traditional bots that forget everything after each message, Sage:

- 🧠 **Remembers** what you talk about across conversations
- 👥 **Learns** about your community members over time  
- 🎯 **Understands** the context behind your questions
- 💬 **Responds** with meaningful, personalized answers

**Perfect for:** Gaming communities • Team servers • Study groups • Any Discord that wants smarter conversations

---

## ✨ Features

| Feature | Description |
|:--------|:------------|
| 🧠 **Persistent Memory** | Builds long-term profiles of users and summarizes channel conversations |
| 👁️ **Vision Support** | Share images and Sage can see and discuss them |
| 🎤 **Voice Awareness** | Knows who's in voice chat and tracks session duration |
| 🤝 **Relationship Insights** | Understands community connections from interactions |
| 📊 **Auto Summaries** | Generates rolling conversation summaries automatically |
| 🔧 **Customizable** | Choose AI models, set wake words, configure behavior |
| ⚡ **Powered by Pollinations.ai** | Fast, reliable multi-model AI access |

---

## 🚀 Quick Start

### Prerequisites

Before you begin, make sure you have:

| Requirement | How to Get It |
|:------------|:--------------|
| **Node.js** (v18 or newer) | [Download Node.js](https://nodejs.org/) |
| **Docker Desktop** | [Download Docker](https://www.docker.com/products/docker-desktop/) |
| **Discord Bot Token** | [Create at Discord Developer Portal](https://discord.com/developers/applications) |

> 💡 **New to Discord bots?** See our [Complete Setup Guide](docs/GETTING_STARTED.md) for step-by-step instructions with screenshots.

### Installation

```bash
# 1️⃣ Clone the repository
git clone https://github.com/BokX1/Sage.git
cd Sage

# 2️⃣ Install dependencies
npm install

# 3️⃣ Run the onboarding wizard (interactive configuration)
npm run onboard
# (alias: npm run setup)

# 4️⃣ Start the database (requires Docker)
docker compose up -d db

# 5️⃣ Initialize database tables
npm run db:migrate

# 6️⃣ Start Sage
npm run dev
```

### What to Expect

After running `npm run onboard` (or `npm run setup`), you'll be prompted for:

- **Discord Token** — Your bot's secret key from the Developer Portal
- **Discord App ID** — Your application ID (same portal)
- **Database URL** — Press `2` to use the Docker default
- **Pollinations API Key** — Required (get one at [pollinations.ai](https://pollinations.ai/))
- **Default Model** — Choose from the Pollinations model catalog

**🎉 Once running, invite Sage to your server and say "Sage, hello!" to start chatting.**

### Non-interactive Onboarding

Use flags for CI or automation:

```bash
npm run onboard -- \\
  --discord-token \"YOUR_TOKEN\" \\
  --discord-app-id \"YOUR_APP_ID\" \\
  --database-url \"postgresql://...\" \\
  --api-key \"YOUR_POLLINATIONS_KEY\" \\
  --model gemini \\
  --yes \\
  --non-interactive
```

---

## ⚙️ Configuration

### Essential Settings (Required)

| Variable | Description | Where to Find It |
|:---------|:------------|:-----------------|
| `DISCORD_TOKEN` | Your bot's authentication token | [Discord Developer Portal](https://discord.com/developers) → Bot → Token |
| `DISCORD_APP_ID` | Your application's unique ID | Developer Portal → General Information |
| `DATABASE_URL` | PostgreSQL connection string | Auto-configured with Docker |

### Quick Configuration Options

| Variable | What It Does | Default |
|:---------|:-------------|:--------|
| `WAKE_WORDS` | Words that trigger Sage (at start of message) | `sage` |
| `AUTOPILOT_MODE` | `manual`, `reserved`, or `talkative` | `manual` |
| `POLLINATIONS_MODEL` | Default chat model | `gemini` |

> 💡 **Autopilot Tip:** `reserved` and `talkative` modes make Sage respond without being mentioned — great for small servers but significantly increases API usage. See [Configuration Guide](docs/CONFIGURATION.md#autopilot-modes-explained) for details.
<details>
<summary><strong>📋 View All Configuration Options</strong></summary>

### LLM Settings

| Variable | Purpose | Default |
|:---------|:--------|:--------|
| `LLM_PROVIDER` | AI provider | `pollinations` |
| `POLLINATIONS_BASE_URL` | API endpoint | `https://gen.pollinations.ai/v1` |
| `POLLINATIONS_MODEL` | Primary chat model | `gemini` |
| `POLLINATIONS_API_KEY` | Required for onboarding; higher limits/premium models | — |
| `PROFILE_POLLINATIONS_MODEL` | Model for profile analysis | `deepseek` |
| `SUMMARY_MODEL` | Model for summaries | `openai-large` |
| `FORMATTER_MODEL` | Model for JSON formatting | `qwen-coder` |

### Memory & Summaries

| Variable | Purpose | Default |
|:---------|:--------|:--------|
| `LOGGING_ENABLED` | Enable message logging | `true` |
| `MESSAGE_DB_STORAGE_ENABLED` | Store messages in database | `true` |
| `RAW_MESSAGE_TTL_DAYS` | In-memory transcript retention | `3` |
| `SUMMARY_ROLLING_WINDOW_MIN` | Rolling summary window | `60` |
| `SUMMARY_ROLLING_MIN_MESSAGES` | Messages before summary | `20` |

### Behavior & Limits

| Variable | Purpose | Default |
|:---------|:--------|:--------|
| `LOG_LEVEL` | Logging verbosity | `info` |
| `RATE_LIMIT_MAX` | Max responses per window | `5` |
| `RATE_LIMIT_WINDOW_SEC` | Rate limit window | `10` |
| `WAKEWORD_COOLDOWN_SEC` | Per-user response cooldown | `20` |

### Context Budgets

| Variable | Purpose | Default |
|:---------|:--------|:--------|
| `CONTEXT_MAX_INPUT_TOKENS` | Total input token budget | `65536` |
| `CONTEXT_RESERVED_OUTPUT_TOKENS` | Reserved for response | `8192` |
| `CONTEXT_USER_MAX_TOKENS` | User message budget | `24000` |

### Admin Access

| Variable | Purpose | Default |
|:---------|:--------|:--------|
| `ADMIN_ROLE_IDS` | Discord role IDs with admin access | — |
| `ADMIN_USER_IDS` | Discord user IDs with admin access | — |

### Timeouts

| Variable | Purpose | Default |
|:---------|:--------|:--------|
| `TIMEOUT_CHAT_MS` | Chat request timeout | `300000` (5 min) |
| `TIMEOUT_MEMORY_MS` | Memory operation timeout | `600000` (10 min) |

</details>

---

## 💬 Using Sage

### Talking to Sage

Sage responds when its wake word (default: "sage") is at the **start** of your message:

```
Sage, what were we talking about yesterday?
Sage, who's been most active in voice today?
Sage, summarize the last hour of conversation
Sage, what do you know about me?
```

### Slash Commands

| Command | Description | Admin Only |
|:--------|:------------|:-----------|
| `/ping` | Check if Sage is online | No |
| `/sage whoiswho [user]` | View relationship info | No |
| `/llm_ping` | Test AI connectivity | Yes |
| `/models` | List available models | Yes |
| `/model list` | List available models | Yes |
| `/model select <model>` | Change chat model for this server | Yes |
| `/model reset` | Reset to default model | Yes |
| `/model refresh` | Refresh the model catalog | Yes |
| `/setmodel <model>` | Legacy alias for chat model selection | Yes |
| `/sage admin stats` | View bot statistics | Yes |
| `/sage admin summarize` | Force channel summary | Yes |
| `/sage admin trace` | View recent traces | Yes |

> 💡 Admin commands require configuring `ADMIN_ROLE_IDS` or `ADMIN_USER_IDS` in your `.env` file.

---

## ❓ Troubleshooting

<details>
<summary><strong>🔴 "Cannot connect to database"</strong></summary>

**Solution:** Make sure Docker is running and the database container is up:

```bash
docker compose up -d db
```

Wait 10 seconds, then try again.
</details>

<details>
<summary><strong>🔴 "Invalid Discord token"</strong></summary>

**Solution:**

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application → Bot → Reset Token
3. Copy the new token and update your `.env` file

</details>

<details>
<summary><strong>🔴 Sage isn't responding to messages</strong></summary>

**Check these:**

1. Is the bot online in your server? (check member list)
2. Does the bot have permission to read/send messages in the channel?
3. Are you using the wake word? Try "Sage, hello" or just "Sage"
4. Run `npm run doctor` to check configuration

</details>

<details>
<summary><strong>🔴 Commands not showing up</strong></summary>

**Solution:** Commands take up to 1 hour to register globally. For instant testing, set `DEV_GUILD_ID` in your `.env` to your server's ID.
</details>

### Diagnostic Tools

```bash
npm run doctor    # Check configuration and connectivity
npm run db:studio # Visual database browser
```

---

## 🔐 Privacy & Data

Sage stores data to provide personalized responses:

| Data Type | What's Stored | Control |
|:----------|:--------------|:--------|
| **User Profiles** | AI-generated summaries of user preferences | Stored per-user |
| **Channel Summaries** | Rolling conversation summaries | Stored per-channel |
| **Messages** | Recent messages for context | `MESSAGE_DB_STORAGE_ENABLED` |
| **Voice Sessions** | Join/leave times | Automatic |
| **Relationships** | Interaction patterns | Automatic |

**To disable logging:** Set `LOGGING_ENABLED=false` in `.env`

**To delete data:** Stop the bot, clear database tables, restart.

See [Security & Privacy Guide](docs/security_privacy.md) for complete details.

---

## 🛠️ For Developers

<details>
<summary><strong>Development Commands</strong></summary>

```bash
npm run dev       # Start with hot-reload
npm run build     # Compile TypeScript
npm run start     # Run production build
npm run lint      # ESLint check
npm run test      # Run test suite
npm run cert      # Full validation (lint + build + test)
```

</details>

<details>
<summary><strong>Database Commands</strong></summary>

```bash
npm run db:migrate  # Apply migrations
npm run db:studio   # Open Prisma Studio (visual DB editor)
```

</details>

<details>
<summary><strong>Architecture Documentation</strong></summary>

- [Pipeline Architecture](docs/architecture/pipeline.md) — Message routing and context building
- [Memory System](docs/architecture/memory_system.md) — How Sage remembers
- [Operations Runbook](docs/operations/runbook.md) — Deployment and monitoring

</details>

<details>
<summary><strong>Contributing</strong></summary>

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Before submitting a PR:
npm run lint
npm run build
npm run test
```

</details>

---

## 🌐 Powered By

<p align="center">
  <a href="https://pollinations.ai">
    <img src="https://pollinations.ai/favicon.ico" alt="Pollinations.ai" width="64" />
  </a>
</p>

<p align="center">
  Sage is proudly powered by <strong><a href="https://pollinations.ai">Pollinations.ai</a></strong><br/>
  Providing free, open-source AI APIs for text generation, vision, and more.
</p>

---

## 📚 Documentation

| Document | Description |
|:---------|:------------|
| [Getting Started Guide](docs/GETTING_STARTED.md) | Complete beginner walkthrough |
| [FAQ](docs/FAQ.md) | Frequently asked questions |
| [Configuration Reference](docs/CONFIGURATION.md) | All settings explained |
| [Security & Privacy](docs/security_privacy.md) | Data handling details |
| [Architecture](docs/architecture/) | Technical deep-dives |
| [Changelog](CHANGELOG.md) | Version history |

---

## 📄 License

[ISC License](LICENSE) — Free to use, modify, and distribute.

---

<p align="center">
  <sub>Made with ❤️ for Discord communities everywhere</sub>
</p>

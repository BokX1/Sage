# ⚡ Quick Start

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Quick%20Start-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Quick Start" />
</p>

Get Sage running in your Discord server in under 5 minutes.

---

## 🧭 Quick navigation

- [Option 1: Join an existing Sage deployment](#option-1-join-an-existing-sage-deployment)
- [Option 2: Self-host (developers)](#option-2-self-host-developers)
- [🆘 Troubleshooting](#troubleshooting-fast)

---

<a id="option-1-join-an-existing-sage-deployment"></a>

## Option 1: Join an existing Sage deployment

**Best for:** Servers that already have an operator running Sage.

### 1️⃣ Invite Sage

Ask the deployment operator for the current invite URL.

> [!TIP]
> If you are the operator, `npm run onboard` prints a recommended invite URL and the manual Discord Developer Portal flow is documented in [Getting Started](GETTING_STARTED.md#step-6-invite-sage-to-your-server).

### 2️⃣ Activate BYOP (server-wide key)

The current hosted Sage deployment uses **Bring Your Own Pollen (BYOP)** — your server provides a Pollinations API key for that hosted bot.

```text
/sage key login     ← Get your API key link
/sage key set sk_…  ← Activate for entire server
```

<details>
<summary><strong>Step-by-step breakdown</strong></summary>

1. Run `/sage key login` in any channel
2. Open the link → sign in via GitHub on Pollinations
3. Copy the `sk_...` key from the URL
4. Run `/sage key set <your_key>` as a server admin

After this, Sage is active for the entire server.

</details>

### 3️⃣ Try it out

| Action | Example |
| :--- | :--- |
| 🏓 Check status | `/ping` |
| 🔐 Check server key | `/sage key check` |
| 💬 Wake word | `Sage, what's the best programming language?` |
| 📎 Mention | `@Sage explain this code` |
| 🎨 Generate image | `Sage, draw a surreal landscape in oil paint style` |
| ✏️ Edit image | Reply to an image: `Sage, turn this into a watercolor` |
| 🔍 Search the web | `Sage, what's the current price of Bitcoin?` |

> [!NOTE]
> Image generation and editing on the hosted bot require an active Pollinations-backed BYOP key.

---

<a id="option-2-self-host-developers"></a>

## Option 2: Self-host (developers)

**Best for:** Customizing the codebase, running private instances, or controlling infrastructure.

```bash
git clone https://github.com/BokX1/Sage.git && cd Sage
npm ci
npm run onboard           # ← Interactive setup wizard
docker compose -f config/services/core/docker-compose.yml up -d db tika
npm run db:migrate
npm run dev               # ← Start in development mode
```

> [!TIP]
> `npm run onboard` now supports optional automation flags for CI/headless flows: `--start-docker --migrate --doctor`.

Self-hosted Sage can target any OpenAI-compatible chat provider through `LLM_BASE_URL`. Follow **[📖 Getting Started](GETTING_STARTED.md)** for the complete walkthrough (Discord app creation, `.env` configuration, database setup, provider setup, and invite generation).

---

<a id="troubleshooting-fast"></a>

## 🆘 Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Missing key / no responses | Set a BYOP key: `/sage key login` → `/sage key set` |
| Invalid API key | Make sure you copied the full `sk_...` value from the URL |
| Bot online but silent | Check wake word/mentions and verify channel permissions |
| Slash commands missing | Restart the bot; wait up to 1 hour for global propagation |

For deeper debugging, see **[🔧 Troubleshooting Guide](TROUBLESHOOTING.md)**.

---

## 📝 What's Next?

- **[🎮 Commands Reference](COMMANDS.md)** — Full list of slash commands and natural language triggers
- **[📖 Getting Started](GETTING_STARTED.md)** — Full source setup, Discord app creation, and invite flow
- **[⚙️ Configuration](../reference/CONFIGURATION.md)** — Customize Sage's behavior, memory, and limits
- **[❓ FAQ](FAQ.md)** — Answers to common questions

---

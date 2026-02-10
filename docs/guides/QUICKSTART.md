# ⚡ Quick Start Guide

Get Sage running in your Discord server in under 5 minutes.

---

## 🧭 Quick navigation

- [Option 1: Use the public bot (recommended)](#option-1-use-the-public-bot-recommended)
- [Option 2: Self-host (developers)](#option-2-self-host-developers)
- [🆘 Troubleshooting](#troubleshooting-fast)

---

<a id="option-1-use-the-public-bot-recommended"></a>

## Option 1: Use the public bot (recommended)

**Best for:** Most servers that want Sage running immediately.

### 1️⃣ Invite Sage

[**Click here to invite Sage to your server**](https://discord.com/oauth2/authorize?client_id=1462117382398017667&scope=bot%20applications.commands&permissions=8)

> [!TIP]
> Prefer least-privilege permissions? You can generate a custom invite URL with only the permissions you need (see [Getting Started → Invite Bot](GETTING_STARTED.md#step-6-invite-sage-to-your-server)).

### 2️⃣ Activate BYOP (server-wide key)

Sage uses **Bring Your Own Pollen (BYOP)** — your server provides a Pollinations API key for AI usage.

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
| 👤 View relationships | `/sage whoiswho` |
| 💬 Wake word | `Sage, what's the best programming language?` |
| 📎 Mention | `@Sage explain this code` |
| 🎨 Generate image | `Sage, draw a surreal landscape in oil paint style` |
| ✏️ Edit image | Reply to an image: `Sage, turn this into a watercolor` |
| 🔍 Search the web | `Sage, what's the current price of Bitcoin?` |

> [!NOTE]
> Image generation and editing require an active BYOP key.

---

<a id="option-2-self-host-developers"></a>

## Option 2: Self-host (developers)

**Best for:** Customizing the codebase, running private instances, or controlling infrastructure.

```bash
git clone https://github.com/BokX1/Sage.git && cd Sage
npm ci
npm run onboard           # ← Interactive setup wizard
docker compose -f config/ci/docker-compose.yml up -d db
npm run db:push
npm run dev               # ← Start in development mode
```

Follow **[📖 Getting Started](GETTING_STARTED.md)** for the complete walkthrough (Discord app creation, `.env` configuration, database setup, and invite generation).

---

<a id="troubleshooting-fast"></a>

## 🆘 Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Rate limits / shared quota | Set a BYOP key: `/sage key login` → `/sage key set` |
| Invalid API key | Make sure you copied the full `sk_...` value from the URL |
| Bot online but silent | Check wake word/mentions and verify channel permissions |
| Slash commands missing | Restart the bot; wait up to 1 hour for global propagation |

For deeper debugging, see **[🔧 Troubleshooting Guide](TROUBLESHOOTING.md)**.

---

## 📝 What's Next?

- **[🎮 Commands Reference](COMMANDS.md)** — Full list of slash commands and natural language triggers
- **[⚙️ Configuration](../reference/CONFIGURATION.md)** — Customize Sage's behavior, memory, and limits
- **[❓ FAQ](FAQ.md)** — Answers to common questions

---

<p align="center">
  <sub>Powered by <a href="https://pollinations.ai">Pollinations.ai</a> 🐝</sub>
</p>

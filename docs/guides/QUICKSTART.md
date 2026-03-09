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

### 2️⃣ Activate the hosted BYOP flow

If the hosted bot has no usable key for your server, just talk to Sage once in a guild channel:

- `@Sage hello`
- `Sage, are you online?`

Sage will respond with a server-key setup card.

As a server admin:

1. Click `Get Pollinations Key`
2. Complete the Pollinations login flow
3. Click `Set Server Key`
4. Paste the `sk_...` key into the modal

After that, Sage is active for the entire server.

### 3️⃣ Try it out

| Action | Example |
| :--- | :--- |
| 💬 Wake word | `Sage, what's the best programming language?` |
| 📎 Mention | `@Sage explain this code` |
| 🎨 Generate image | `Sage, draw a surreal landscape in oil paint style` |
| ✏️ Edit image | Reply to an image: `Sage, turn this into a watercolor` |
| 🔍 Search the web | `Sage, what's the current price of Bitcoin?` |
| 🎤 Voice control | `Sage, join my voice channel` |

> [!NOTE]
> Image generation and editing on the hosted bot require an active Pollinations-backed key path.

---

<a id="option-2-self-host-developers"></a>

## Option 2: Self-host (developers)

**Best for:** Customizing the codebase, running private instances, or controlling infrastructure.

```bash
git clone https://github.com/BokX1/Sage.git && cd Sage
npm ci
npm run onboard
docker compose -f config/services/core/docker-compose.yml up -d db tika
npm run db:migrate
npm run dev
```

> [!TIP]
> `npm run onboard` supports optional automation flags for CI/headless flows: `--start-docker --migrate --doctor`.

Self-hosted Sage can target any OpenAI-compatible chat provider through `LLM_BASE_URL`. Follow **[📖 Getting Started](GETTING_STARTED.md)** for the full walkthrough.

---

<a id="troubleshooting-fast"></a>

## 🆘 Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| Missing key / no responses | Trigger Sage once, then use the setup card buttons and modal |
| Invalid API key | Make sure you copied the full `sk_...` value from the Pollinations redirect |
| Bot online but silent | Check wake word/mentions and verify channel permissions |
| Voice join does nothing | Ask Sage to join while you are already in a standard voice channel |

For deeper debugging, see **[🔧 Troubleshooting Guide](TROUBLESHOOTING.md)**.

---

## 📝 What's Next?

- **[💬 Conversation & Controls](COMMANDS.md)** — Triggers, setup controls, and admin action patterns
- **[📖 Getting Started](GETTING_STARTED.md)** — Full source setup, Discord app creation, and invite flow
- **[⚙️ Configuration](../reference/CONFIGURATION.md)** — Customize Sage's behavior, memory, and limits
- **[❓ FAQ](FAQ.md)** — Answers to common questions

---

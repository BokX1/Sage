# ⚡ Quick Start

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Quick%20Start-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Quick Start" />
</p>

Get Sage live in Discord in a few minutes, then decide whether you want a hosted/server-key path or a full self-host deployment.

---

## 🧭 Quick navigation

- [Option 1: Join an Existing Sage Deployment](#option-1-join-an-existing-sage-deployment)
- [Option 2: Self-Host Sage](#option-2-self-host-sage)
- [🆘 Troubleshooting](#troubleshooting-fast)

---

<a id="option-1-join-an-existing-sage-deployment"></a>

## Option 1: Join an Existing Sage Deployment

### 1️⃣ Invite Sage

Get the current invite URL from the deployment operator and add Sage to your server.

### 2️⃣ Trigger the setup flow if needed

If the guild does not have a usable key path yet, mention Sage once:

- `@Sage hello`
- `Sage, are you online?`

Sage will post the setup card for that guild.

### 3️⃣ Activate the server

If you are a server admin:

1. Click `Get Pollinations Key`
2. Complete the Pollinations login flow
3. Click `Set Server Key`
4. Paste the `sk_...` key into the modal

### 4️⃣ Start using Sage

| Action | Example |
| :--- | :--- |
| Chat | `Sage, summarize this thread` |
| Research | `@Sage check the latest docs for this API` |
| Image generation | `Sage, draw a neon skyline at sunset` |
| Image editing | Reply to an image: `Sage, make this more cinematic` |
| Voice control | `Sage, join my voice channel` |

> [!NOTE]
> The built-in hosted/server-key and image flow are Pollinations-specific today. The self-hosted runtime itself is still provider-flexible.

---

<a id="option-2-self-host-sage"></a>

## Option 2: Self-Host Sage

```bash
git clone https://github.com/BokX1/Sage.git
cd Sage
npm ci
npm run onboard
docker compose -f config/services/core/docker-compose.yml up -d db tika
npm run db:migrate
npm run dev
```

That gives you:

- your own Discord application
- your own provider endpoint via `AI_PROVIDER_BASE_URL`
- optional host-level provider key via `AI_PROVIDER_API_KEY`
- optional local services for search, scraping, social graph, and voice

For the full walkthrough, use [📖 Getting Started](GETTING_STARTED.md).

---

<a id="troubleshooting-fast"></a>

## 🆘 Troubleshooting

| Symptom | Fast fix |
| :--- | :--- |
| Missing-key guidance | Trigger Sage once so the setup card appears |
| Bot online but silent | Check mention/wake word/reply entrypoints and channel permissions |
| Provider probe fails | Run `npm run doctor -- --llm-ping` or `npm run ai-provider:probe` |
| Voice join does nothing | Make sure you are already in a standard voice channel |

For deeper debugging, use [🔧 Troubleshooting](TROUBLESHOOTING.md).

---

## 📝 What’s Next?

- [💬 Conversation & Controls](COMMANDS.md)
- [📖 Getting Started](GETTING_STARTED.md)
- [⚙️ Configuration](../reference/CONFIGURATION.md)
- [❓ FAQ](FAQ.md)

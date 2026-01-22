# ⚡ Quick Start Guide

**Sage is the first Discord AI agent that pays for itself—literally.**

You have two options to use Sage:

1.  **🤖 Use the Public Bot (Recommended):** Zero setup, free hosting, "Bring Your Own Pollen" (BYOP).
2.  **💻 Self-Host:** For developers who want full control over the code and infrastructure.

---

## Option 1: Use the Public Bot (Zero Setup) 🚀

**Best for:** Community managers, gamers, and non-developers.

### 1. Invite Sage
[**Click here to invite Sage to your server**](https://discord.com/oauth2/authorize?client_id=1328994380695015465&permissions=328565073920&integration_type=0&scope=bot+applications.commands)  
*(Note: Replace with your actual invite link if different)*

### 2. Configure Your Key (BYOP)
Sage uses a **"Bring Your Own Pollen"** model. The bot hosting is free, but you provide the AI credits (Pollen) from Pollinations.ai.

**For Individual Users:**
1.  Type `/sage key login` in Discord.
2.  Click the link to log in to Pollinations.ai.
3.  Copy your key from the browser URL (it looks like `sk_...`).
4.  Type `/sage key set <your_key>`.
5.  Done! Sage will now respond to you using your credits.

**For Server Owners (Guild-Wide Key):**
Want to pay for your whole community?
1.  Follow the login steps above to get your key.
2.  Type `/sage key set api_key:<your_key> scope:guild`.
3.  Now Sage works for **everyone** in your server using your credits!

---

## Option 2: Self-Host (For Developers) 🛠️

**Best for:** Developers, privacy enthusiasts, or customizing the codebase.

### 1. Prerequisites
- **Node.js 18+**
- **Docker Desktop** (for the database)
- **Discord Bot Token**

### 2. Install
```bash
git clone https://github.com/BokX1/Sage.git
cd Sage
npm install
```

### 3. Configure
Run the interactive wizard:
```bash
npm run onboard
```

### 4. Start
```bash
docker compose up -d db
npm run db:migrate
npm run dev
```

You should see: `Logged in as Sage#1234` and `Ready!`.

---

## 🆘 Troubleshooting

- **"Rate limit hit"**: If using the public bot without a key, you might hit the free tier limits. Add a key to lift them.
- **"Invalid API Key"**: Make sure you copied the `sk_...` part correctly from the URL.

---

<p align="center">
  <sub>Powered by <a href="https://pollinations.ai">Pollinations.ai</a> 🐝</sub>
</p>
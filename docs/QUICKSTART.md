# ⚡ Quick Start Guide

Run Sage fast. Choose your path:

1. **🤖 Use the public bot** (invite + activate BYOP)
2. **💻 Self-host from source** (local/dev or production)

If you’re not sure, start with **Option 1**.

---

## 🧭 Quick navigation

- [Option 1: Use the public bot (recommended)](#option-1-use-the-public-bot-recommended)
- [Option 2: Self-host (developers)](#option-2-self-host-developers)
- [🆘 Troubleshooting (fast)](#troubleshooting-fast)

---

<a id="option-1-use-the-public-bot-recommended"></a>

## Option 1: Use the public bot (recommended)

**Best for:** Most servers that want Sage running immediately.

### 1) Invite Sage

[**Invite Sage to your server**](https://discord.com/api/oauth2/authorize?client_id=1211723232808570971&permissions=414464731200&scope=bot%20applications.commands)

> [!TIP]
> Prefer least-privilege permissions? You can generate a custom invite URL with only the permissions you want (see [Getting Started → Invite Bot](GETTING_STARTED.md#step-6-invite-sage-to-your-server)).

### 2) Activate BYOP (server-wide key)

Sage uses **Bring Your Own Pollen (BYOP)**: hosting is free, and your server provides a Pollinations key.

As a server admin (or someone with **Manage Guild** permission):

1. Run `/sage key login`
2. Open the link and log in to Pollinations.ai
3. Copy the `sk_...` key from the URL
4. Run `/sage key set <your_key>`

After this, Sage is active for the entire server.

### 3) Try it

- `/ping`
- `/sage whoiswho`
- Say “Sage, hello” (wake word)
- Mention `@Sage`
- Reply to a Sage message

---

<a id="option-2-self-host-developers"></a>

## Option 2: Self-host (developers)

**Best for:** Customizing the codebase, running private instances, or controlling infra.

Follow **[📖 Getting Started](GETTING_STARTED.md)** for a complete walkthrough (Discord app, `.env`, database, onboarding wizard, and invite generation).

---

<a id="troubleshooting-fast"></a>

## 🆘 Troubleshooting (fast)

- **Rate limits / shared quota:** Set a BYOP key with `/sage key login` → `/sage key set`.
- **Invalid API key:** Make sure you copied the `sk_...` value correctly from the URL.
- **Bot is online but silent:** Check wake word / mentions, and verify permissions in the channel.

For deeper debugging, see **[🔧 Troubleshooting Guide](TROUBLESHOOTING.md)**.

---

<p align="center">
  <sub>Powered by <a href="https://pollinations.ai">Pollinations.ai</a> 🐝</sub>
</p>

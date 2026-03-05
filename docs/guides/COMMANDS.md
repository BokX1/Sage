# 🎮 Sage Commands Reference

A complete reference for Sage slash commands, triggers, and interaction methods.

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Commands-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Commands" />
</p>

---

## 🧭 Quick Navigation

- [Quick Reference](#quick-reference)
- [Triggering Sage](#triggering-sage)
- [Public Commands](#public-commands)
- [Key Management (BYOP)](#key-management-byop)
- [Admin Commands](#admin-commands)
- [Natural Language Admin Actions](#natural-language-admin-actions)
- [Related Documentation](#related-documentation)

---

## 📋 Quick Reference

| Goal | Command / Action |
| :--- | :--- |
| Check bot is alive | `/ping` |
| Get Pollinations key link | `/sage key login` |
| Set server-wide key (admin) | `/sage key set <api_key>` |
| Check key status (admin) | `/sage key check` |
| Clear server key (admin) | `/sage key clear` |
| View bot stats (admin) | `/sage admin stats` |
| Join voice (beta) | `/join` |
| Leave voice (beta) | `/leave` |

---

## 🗣️ Triggering Sage

Sage can be triggered in three ways:

| Method | Example | Description |
| :--- | :--- | :--- |
| Wake word | `Sage, what is TypeScript?` | Start the message with "Sage" |
| Mention | `@Sage explain this code` | Mention the bot anywhere |
| Reply | Reply to Sage's message | Continue an existing thread |

Wake word prefixes like "hey" are also supported: `Hey Sage, help me!`

> [!TIP]
> Configure custom wake words and prefixes with `WAKE_WORDS_CSV` and `WAKE_WORD_PREFIXES_CSV` in your `.env`.

---

## 📌 Public Commands

### `/ping`

Check if Sage is online and responding.

```text
/ping
```

### `/sage key login`

Get a link to generate your Pollinations API key.

```text
/sage key login
```

### `/join`

Summon Sage to your current voice channel.

```text
/join
```

### `/leave`

Disconnect Sage from the voice channel.

```text
/leave
```

---

## 🔑 Key Management (BYOP)

Bring-Your-Own-Pollen (BYOP) commands for the server key.

`/sage key set`, `/sage key check`, and `/sage key clear` are admin-only.

### `/sage key set`

Set the server-wide Pollinations API key.

```text
/sage key set <api_key>
```

### `/sage key check`

Check the current server key status.

```text
/sage key check
```

### `/sage key clear`

Remove the server-wide API key.

```text
/sage key clear
```

---

## 🛡️ Admin Commands

Restricted to users with Discord admin permissions (`Manage Server` or `Administrator`).

### `/sage admin stats`

View bot statistics and runtime health.

```text
/sage admin stats
```

---

## 💬 Natural Language Admin Actions

Most admin actions are now chat-first. For admin users, admin tools are enabled automatically when chatting with Sage via wake word, mention, or reply.

Examples:

- `Sage, show recent traces for this guild`
- `Sage, summarize what happened this week`
- `Sage, update server memory with this policy`
- `Sage, send this to #announcements: <message>`
- `Sage, search message history in #support for: <query>`

> [!IMPORTANT]
> Destructive operations still require explicit approval through admin action buttons.
> Sage posts a per-action status message (with the `Action ID`), edits it with the outcome when resolved, and auto-deletes the resolved approval card after ~60 seconds to keep channels clean (including after restarts).

---

## 🔗 Related Documentation

- [⚙️ Configuration](../reference/CONFIGURATION.md) — All environment variables
- [🌸 BYOP Mode](BYOP.md) — Bring-Your-Own-Pollen setup guide
- [❓ FAQ](FAQ.md) — Common questions answered
- [🔧 Troubleshooting](TROUBLESHOOTING.md) — Fixes for common issues

<p align="right"><a href="#top">⬆️ Back to top</a></p>

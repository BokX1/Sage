# 💬 Sage Conversation & Controls

Sage is chat-first. Use normal Discord conversation, replies, buttons, and modals instead of a slash-command menu.

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Controls-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Controls" />
</p>

---

## 🧭 Quick Navigation

- [Quick Reference](#quick-reference)
- [Triggering Sage](#triggering-sage)
- [Setup Card and Server Keys](#setup-card-and-server-keys)
- [Voice Control](#voice-control)
- [Admin and Moderation Requests](#admin-and-moderation-requests)
- [Interactive Follow-Ups](#interactive-follow-ups)
- [Related Documentation](#related-documentation)

---

## 📋 Quick Reference

| Goal | How to do it |
| :--- | :--- |
| Talk to Sage | Mention Sage, reply to Sage, or start with `Sage` |
| Continue a thread | Reply to Sage or use Sage-authored follow-up buttons |
| Activate hosted/server-key flow | Trigger Sage once in a guild with no usable key |
| Ask Sage to join voice | `Sage, join my voice channel` |
| Ask Sage to leave voice | `Sage, leave voice` |
| Request admin work | Ask in normal chat; Sage queues approval when needed |

---

## 🗣️ Triggering Sage

Sage can be triggered in three primary ways:

| Method | Example | Description |
| :--- | :--- | :--- |
| Wake word | `Sage, what changed today?` | Start the message with `Sage` |
| Mention | `@Sage explain this stack trace` | Mention the bot anywhere in the message |
| Reply | Reply to a Sage message | Continue an existing exchange |

Wake word prefixes such as `hey sage` can also be enabled through `WAKE_WORD_PREFIXES_CSV`.

> [!TIP]
> Configure wake words with `WAKE_WORDS_CSV` and `WAKE_WORD_PREFIXES_CSV` in `.env`.

---

## 🔑 Setup Card and Server Keys

When a guild has no usable key path yet, Sage can post an interactive setup card in Discord.

Server admins can use:

- `Get Pollinations Key`
- `Set Server Key`
- `Check Key`
- `Clear Key`

Important context:

- This is part of Sage's current hosted/server-key path.
- Self-hosted runtime chat remains provider-flexible through `AI_PROVIDER_BASE_URL`.
- If you already set `AI_PROVIDER_API_KEY`, Sage can use that host-level key as a fallback for the configured provider.

---

## 🎤 Voice Control

Voice is also chat-first.

Examples:

- `Sage, join my current voice channel`
- `Sage, are you in voice right now?`
- `Sage, leave voice`

Voice expectations:

- voice status, join, and leave are normal chat requests
- optional local STT is controlled with `VOICE_*` env vars
- summary-only voice memory is persisted only when voice transcription is enabled and session summaries are on

---

## 🛡️ Admin and Moderation Requests

Most privileged work is requested in normal chat, not by slash command.

Examples:

- `Sage, create a thread for this incident`
- `Sage, update Sage Persona with this policy`
- `Sage, review the last spam wave and queue cleanup`
- `Sage, timeout the author of this replied-to message for 30 minutes`
- `Sage, send the setup card in this channel`

Current behavior:

- higher-impact actions are approval-gated
- requester status stays compact in the source channel
- detailed reviewer cards can route to a dedicated governance review channel
- equivalent unresolved requests are coalesced onto one review request when possible
- moderation works best when you reply to the target message or give a precise message link, ID, or mention

---

## 🔁 Interactive Follow-Ups

Sage can continue work through Components V2 buttons and modal prompts.

Typical patterns:

- retry a failed turn
- continue after approval
- answer a Sage-authored clarification prompt
- complete a modal-backed follow-up for setup or governance

The current runtime keeps those interactions on the same durable task-run story instead of forcing a brand-new slash command or command session.

---

## 🔗 Related Documentation

- [⚡ Quick Start](QUICKSTART.md)
- [🌸 BYOP Mode](BYOP.md)
- [❓ FAQ](FAQ.md)
- [🔧 Troubleshooting](TROUBLESHOOTING.md)

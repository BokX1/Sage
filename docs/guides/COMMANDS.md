# 💬 Sage Conversation & Controls

Sage is chat-first. There are no primary slash commands in the current product surface.

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Controls-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Controls" />
</p>

---

## 🧭 Quick Navigation

- [Quick Reference](#quick-reference)
- [Triggering Sage](#triggering-sage)
- [Server Key Setup](#server-key-setup)
- [Voice Control](#voice-control)
- [Admin Actions](#admin-actions)
- [Related Documentation](#related-documentation)

---

## 📋 Quick Reference

| Goal | How to do it |
| :--- | :--- |
| Talk to Sage | Mention Sage, reply to Sage, or start with `Sage` |
| Activate hosted Pollinations BYOP | Use Sage's setup card buttons and modal |
| Check or clear the server key | Use the setup card buttons as a server admin |
| Ask Sage to join voice | Say `Sage, join my voice channel` |
| Ask Sage to leave voice | Say `Sage, leave voice` |
| Run admin workflows | Ask in chat; Sage queues approval when needed |

---

## 🗣️ Triggering Sage

Sage can be triggered in three ways:

| Method | Example | Description |
| :--- | :--- | :--- |
| Wake word | `Sage, what changed today?` | Start the message with `Sage` |
| Mention | `@Sage explain this code` | Mention the bot anywhere |
| Reply | Reply to a Sage message | Continue an existing exchange |

Wake word prefixes like `Hey Sage` are also supported.

> [!TIP]
> Configure custom wake words and prefixes with `WAKE_WORDS_CSV` and `WAKE_WORD_PREFIXES_CSV` in your `.env`.

---

## 🔑 Server Key Setup

For the hosted/default Pollinations-backed flow, Sage exposes setup controls directly in Discord when a server key is missing.

Server admins can use:

- `Get Pollinations Key` to open the current login flow
- `Set Server Key` to open a secure modal for the `sk_...` key
- `Check Key` to verify status
- `Clear Key` to remove the server-wide key

Non-admins can still see the setup card, but only admins can submit changes.

> [!NOTE]
> Self-hosted deployments can skip this flow by setting a host-level `AI_PROVIDER_API_KEY` for any OpenAI-compatible provider, but the key is optional if you want to rely on Sage's in-Discord server-key flow instead.

---

## 🎤 Voice Control

Voice presence is also chat-first now.

Examples:

- `Sage, join my current voice channel`
- `Sage, are you in voice right now?`
- `Sage, leave voice`

Sage handles live voice control through the `discord_voice` tool path and keeps voice analytics and summaries separate under `discord_context`.

---

## 🛡️ Admin Actions

Most higher-impact actions are requested in chat, not through commands.

Examples:

- `Sage, search the server for the last thread about release blockers`
- `Sage, send a setup card in this channel`
- `Sage, update Sage Persona with this policy`
- `Sage, create a thread for this incident`
- `Sage, moderate the last spam message`
- `Sage, timeout the author of this replied-to message for 30 minutes`
- `Sage, remove the timeout for <@1234567890>`

Destructive or sensitive operations still require explicit approval through Sage-authored buttons.
Requester-facing governance cards stay compact in the source channel and move through states like queued, joined existing review, approved, executed, rejected, failed, or expired.
If a server review channel is configured, Sage posts the detailed reviewer card there; otherwise the reviewer card stays in the source channel by default.
Equivalent unresolved requests are coalesced, so repeated asks for the same admin action should point back to one approval review request and one reviewer card instead of spawning duplicates.
Rejections collect a short reason through a modal and show that reason back on the requester-facing status card.
For moderation, Sage works best when you reply directly to the target message or provide an exact Discord message link, mention, or ID; it should use exact message-history evidence rather than summaries before taking enforcement action.
For high-volume cleanup, Sage can queue approval-gated batch moderation through typed flows (explicit bulk delete IDs/URLs or criteria-based recent-message purge); execution skips messages older than 14 days and reports skipped counts instead of failing the whole action.
Normal channel replies should stay operator-friendly: Sage should not paste raw tool payloads, approval commands, or internal retry chatter into chat while an approval is pending.

---

## 🔗 Related Documentation

- [⚡ Quick Start](QUICKSTART.md) — Fastest path to using Sage
- [🌸 BYOP Mode](BYOP.md) — Hosted Pollinations key setup
- [❓ FAQ](FAQ.md) — Common questions
- [🔧 Troubleshooting](TROUBLESHOOTING.md) — Fixes for common failures

<p align="right"><a href="#top">⬆️ Back to top</a></p>

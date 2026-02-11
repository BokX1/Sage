# 🎮 Sage Commands Reference

A complete reference for Sage slash commands and interaction methods.

---

## 🧭 Quick navigation

- [⚡ Quick Reference](#quick-reference)
- [📋 Table of Contents](#table-of-contents)
- [💬 Triggering Sage](#triggering-sage)
- [🎨 Image Generation & Editing](#-image-generation--editing-natural-language)
- [🔍 Real-time Search](#-real-time-search-natural-language)
- [🌐 Public Commands](#public-commands)
- [🔑 Key Management (BYOP)](#key-management-byop)
- [👑 Admin Commands](#admin-commands)
- [🤝 Relationship Commands](#relationship-commands)
- [🎤 Voice Commands (Beta)](#voice-commands-beta)
- [🛠️ Utility Command](#utility-command)
- [📝 Related Documentation](#related-documentation)

---

<a id="quick-reference"></a>

## ⚡ Quick Reference

| Goal | Command / Action |
| :--- | :--- |
| Check bot is alive | <kbd>/ping</kbd> |
| Ping LLM provider (admin) | <kbd>/llm_ping</kbd> |
| See relationship tiers | <kbd>/sage whoiswho [user]</kbd> |
| Get Pollinations key link | <kbd>/sage key login</kbd> |
| Set server-wide key (admin) | <kbd>/sage key set &lt;api_key&gt;</kbd> |
| Check key status (admin) | <kbd>/sage key check</kbd> |
| Clear server key (admin) | <kbd>/sage key clear</kbd> |
| Join voice (beta) | <kbd>/join</kbd> |
| Leave voice (beta) | <kbd>/leave</kbd> |

---

<a id="table-of-contents"></a>

## 📋 Table of Contents

- [Triggering Sage](#-triggering-sage)
- [Public Commands](#-public-commands)
- [Key Management (BYOP)](#-key-management-byop)
- [Admin Commands](#-admin-commands)
- [Relationship Commands](#-relationship-commands)
- [Voice Commands (Beta)](#-voice-commands-beta)
- [Utility Command](#-utility-command)

---

<a id="triggering-sage"></a>

## 💬 Triggering Sage

Sage can be triggered in three ways:

| Method | Example | Description |
| :--- | :--- | :--- |
| **Wake Word** | `Sage, what is TypeScript?` | Start the message with “Sage” |
| **Mention** | `@Sage explain this code` | Mention the bot anywhere |
| **Reply** | *(Reply to Sage’s message)* | Continue an existing thread |

> [!TIP]
> Wake word prefixes like “hey” are also supported: `Hey Sage, help me!`

---

### 📎 File ingestion & recall (natural language)

Sage can parse non-image file attachments and remember them in channel file memory.

Examples:

- Upload a file and ask: `Sage, summarize this attachment`
- Follow-up later: `Sage, what files did I upload earlier?`
- Target a file: `Sage, check the config-live-2.json file and explain it`

Behavior:

1. Non-image attachments are extracted and cached.
2. Transcript stores cache notes, not full file bodies.
3. Sage retrieves full file text only when needed/requested.

---

### 🎨 Image generation & editing (natural language)

Sage can generate images (text → image) and do simple edits (image → image). No slash command required — just ask.

**Generate**

- `Sage, draw a neon cyberpunk city at night`
- `Sage, generate an image of a cozy cabin in the snow, watercolor style`

**Edit**

- Reply to an image: `Sage, make this look like a Studio Ghibli scene`
- Attach an image: `Sage, remove the background and make it a clean product photo`

> [!NOTE]
> Image replies typically include an **image attachment** (and may include a short caption). On the public bot, BYOP must be enabled (`/sage key login` → `/sage key set`).

---

### 🔍 Real-time search (natural language)

Sage can fetch live information from the web using Search-Augmented Generation. No command needed — just ask about current events, prices, or time-sensitive topics.

**Search triggers**

- `Sage, what's the current price of Bitcoin?`
- `Sage, search for the latest AI news`
- `Sage, look up Python async tutorials`
- `Sage, what's the weather in Tokyo right now?`

**How it works**

1. Router selects the `search` route for fresh/time-sensitive requests.
2. Router also sets `search_mode` (`simple` for direct lookups, `complex` for multi-step comparisons/synthesis).
3. In `simple` mode, Sage returns search output directly.
4. In `complex` mode, Sage runs `search -> chat summarization` so the final answer is cleaner and easier to read.
5. If router is uncertain, Sage falls back to `complex` mode for consistency.
6. Search answers include source URLs, and time-sensitive answers may include a `Checked on: YYYY-MM-DD` line.

> [!TIP]
> Search works best for factual, time-sensitive queries. For conceptual explanations, Sage uses its built-in knowledge.

---

<a id="public-commands"></a>

## 🌐 Public Commands

Available to all users.

### `/ping`

Check if Sage is online and responding.

```text
/ping
```

**Response:** `🏓 Pong!`

---

### `/sage whoiswho`

View relationship information and social tiers.

```text
/sage whoiswho [user]
```

| Parameter | Required | Description |
| :--- | :--- | :--- |
| `user` | No | User to inspect (defaults to yourself) |

**Shows:**

- Relationship tier (Best Friend, Close Friend, Acquaintance, etc.)
- Interaction strength score
- Recent interaction summary

---

<a id="key-management-byop"></a>

## 🔑 Key Management (BYOP)

Bring-Your-Own-Pollen (BYOP) — manage the Pollinations API key used by your server.

> [!IMPORTANT]
> `key set`, `key check`, and `key clear` are **admin-only**. They apply to the entire server.

### `/sage key login`

Get a link to generate your Pollinations API key.

```text
/sage key login
```

**Response:** Step-by-step instructions to obtain your API key.

---

### `/sage key set`

Set the server-wide Pollinations API key.

```text
/sage key set <api_key>
```

| Parameter | Required | Description |
| :--- | :--- | :--- |
| `api_key` | Yes | Your Pollinations API key (starts with `sk_`) |

---

### `/sage key check`

Check the current server's API key status.

```text
/sage key check
```

**Shows:**

- Key status (active/inactive)
- Masked key preview
- Account username and balance

---

### `/sage key clear`

Remove the server-wide API key.

```text
/sage key clear
```

Sage will fall back to shared quota (if available).

---

<a id="admin-commands"></a>

## 👑 Admin Commands

Restricted to users with admin permissions. Configure access via `ADMIN_USER_IDS_CSV` or `ADMIN_ROLE_IDS_CSV`.

### `/sage admin stats`

View bot statistics and performance metrics.

```text
/sage admin stats
```

**Shows:**

- Uptime
- Message counts
- Memory usage
- Active guilds

---

### `/sage admin relationship_graph`

Visualize the relationship graph.

```text
/sage admin relationship_graph [user]
```

| Parameter | Required | Description |
| :--- | :--- | :--- |
| `user` | No | Filter by specific user |

**Shows:** ASCII/emoji visualization of relationship connections.

---

### `/sage admin trace`

View recent agent processing traces for debugging.

```text
/sage admin trace [trace_id] [limit]
```

| Parameter | Required | Description |
| :--- | :--- | :--- |
| `trace_id` | No | Specific trace ID to view |
| `limit` | No | Number of traces (1-10, default: 3) |

**Shows:**

- Agent selector decision and route kind
- Context packet/runtime event metadata
- Context used
- Response generation details

> [!TIP]
> Traces are the fastest way to understand why Sage responded a certain way.

---

### `/sage admin summarize`

Manually trigger a channel summary.

```text
/sage admin summarize [channel]
```

| Parameter | Required | Description |
| :--- | :--- | :--- |
| `channel` | No | Channel to summarize (defaults to current) |

**Shows:** Generated summary of recent channel activity.

---

<a id="relationship-commands"></a>

## 🤝 Relationship Commands

### `/sage relationship set`

Manually set relationship level between two users.

```text
/sage relationship set <user_a> <user_b> <level>
```

| Parameter | Required | Description |
| :--- | :--- | :--- |
| `user_a` | Yes | First user |
| `user_b` | Yes | Second user |
| `level` | Yes | Relationship level (0.0 - 1.0) |

> [!IMPORTANT]
> This command is **admin-only**.

**Relationship Levels:**

| Level | Tier |
| :--- | :--- |
| 0.9+ | 👑 Best Friend |
| 0.7+ | 💚 Close Friend |
| 0.5+ | 🤝 Friend |
| 0.3+ | 👋 Acquaintance |
| < 0.3 | 👤 Stranger |

---

<a id="voice-commands-beta"></a>

## 🎤 Voice Commands (Beta)

Control Sage's voice presence.

> [!NOTE]
> Voice join/leave are command-driven (`/join`, `/leave`). They are intentionally not exposed as runtime tools.

### `/join`

Summon Sage to your current voice channel.

```text
/join
```

**Requirements:**

- You must be in a voice channel.
- Server must have a valid API key set (BYOP) for `openai-audio` support.

### `/leave`

Disconnect Sage from the voice channel.

```text
/leave
```

---

<a id="utility-command"></a>

## 🛠️ Utility Command

### `/llm_ping`

Test LLM connectivity. This command is restricted to admins.

```text
/llm_ping
```

**Shows:** Whether the AI provider is reachable and responding.

---

<a id="related-documentation"></a>

## 📝 Related Documentation

- [Configuration](../reference/CONFIGURATION.md) — Admin access + behavior settings
- [BYOP Mode](BYOP.md) — BYOP setup guide
- [FAQ](FAQ.md) — Common questions

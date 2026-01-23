# 🎮 Sage Commands Reference

Complete reference for all Sage slash commands and interaction methods.

---

## 📋 Table of Contents

- [Triggering Sage](#-triggering-sage)
- [Public Commands](#-public-commands)
- [Key Management (BYOP)](#-key-management-byop)
- [Admin Commands](#-admin-commands)
- [Relationship Commands](#-relationship-commands)

---

## 💬 Triggering Sage

Sage can be triggered in three ways:

| Method | Example | Description |
|:-------|:--------|:------------|
| **Wake Word** | `Sage, what is TypeScript?` | Start message with "Sage" |
| **Mention** | `@Sage explain this code` | Tag the bot anywhere |
| **Reply** | *Reply to Sage's message* | Continue a conversation |

> [!TIP]
> Wake word prefixes like "hey" are also supported: `Hey Sage, help me!`

---

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
|:----------|:---------|:------------|
| `user` | No | User to inspect (defaults to yourself) |

**Shows:**

- Relationship tier (Best Friend, Close Friend, Acquaintance, etc.)
- Interaction strength score
- Recent interaction summary

---

## 🔑 Key Management (BYOP)

Bring-Your-Own-Pollen — manage your API key for unlimited usage.

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
|:----------|:---------|:------------|
| `api_key` | Yes | Your Pollinations API key (starts with `sk_`) |

> [!IMPORTANT]
> This command is **Admin-only**. The key applies to the entire server.

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

> [!IMPORTANT]
> This command is **Admin-only**. Sage will fall back to shared quota.

---

## 👑 Admin Commands

Restricted to users with admin permissions. Configure via `ADMIN_USER_IDS` or `ADMIN_ROLE_IDS`.

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
|:----------|:---------|:------------|
| `user` | No | Filter by specific user |

**Shows:** ASCII/emoji visualization of relationship connections.

---

### `/sage admin trace`

View recent agent processing traces for debugging.

```text
/sage admin trace [trace_id] [limit]
```

| Parameter | Required | Description |
|:----------|:---------|:------------|
| `trace_id` | No | Specific trace ID to view |
| `limit` | No | Number of traces (1-10, default: 3) |

**Shows:**

- LLM router decisions
- Expert routing
- Context used
- Response generation details

> [!TIP]
> Use traces to understand why Sage responded a certain way.

---

### `/sage admin summarize`

Manually trigger a channel summary.

```text
/sage admin summarize [channel]
```

| Parameter | Required | Description |
|:----------|:---------|:------------|
| `channel` | No | Channel to summarize (defaults to current) |

**Shows:** Generated summary of recent channel activity.

---

## 🤝 Relationship Commands

### `/sage relationship set`

Manually set relationship level between two users.

```text
/sage relationship set <user_a> <user_b> <level>
```

| Parameter | Required | Description |
|:----------|:---------|:------------|
| `user_a` | Yes | First user |
| `user_b` | Yes | Second user |
| `level` | Yes | Relationship level (0.0 - 1.0) |

> [!IMPORTANT]
> This command is **Admin-only**.

**Relationship Levels:**

| Level | Tier |
|:------|:-----|
| 0.9+ | 👑 Best Friend |
| 0.7+ | 💚 Close Friend |
| 0.5+ | 🤝 Friend |
| 0.3+ | 👋 Acquaintance |
| < 0.3 | 👤 Stranger |

---

## 🎤 Voice Commands (Beta)

Control Sage's voice presence.

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

## 🛠️ Utility Command

### `/llm_ping`

Test LLM connectivity (admin/debug only).

```text
/llm_ping
```

**Shows:** Whether the AI provider is reachable and responding.

---

## 📝 Related Documentation

- [Configuration](CONFIGURATION.md) — Configure admin access and behavior
- [BYOP Mode](BYOP_MODE.md) — Detailed BYOP setup guide
- [FAQ](FAQ.md) — Common questions

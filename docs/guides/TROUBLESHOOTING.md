# 🔧 Troubleshooting

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Troubleshooting-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Troubleshooting" />
</p>

Fast fixes for common Sage issues.

> [!TIP]
> Start with `npm run doctor`. It catches the majority of setup problems.

---

## 🧭 Quick navigation

- [🚦 Quick Diagnostics](#quick-diagnostics)
- [🔴 Startup Issues](#startup-issues)
- [🟡 Response Issues](#response-issues)
- [🟠 Memory & Learning Issues](#memory-learning-issues)
- [🔵 Command Issues](#command-issues)
- [🟣 Database Issues](#database-issues)
- [⚡ Performance Issues](#performance-issues)
- [📋 Error Code Reference](#error-code-reference)
- [🆘 Still Having Issues?](#still-having-issues)

---

<a id="quick-diagnostics"></a>

## 🚦 Quick Diagnostics

Run the built-in health check:

```bash
npm run doctor
```

This validates:

- ✅ Environment configuration
- ✅ Database connectivity
- ✅ LLM provider availability (if `--llm-ping` or `LLM_DOCTOR_PING=1`)

---

<a id="startup-issues"></a>

## 🔴 Startup Issues

### Bot crashes on startup

Use the error message to pick the right fix:

```mermaid
flowchart TD
    %% Fast triage for common startup failures.
    classDef error fill:#ffcdd2,stroke:#c62828,color:black
    classDef fix fill:#c8e6c9,stroke:#2e7d32,color:black
    classDef check fill:#e1f5fe,stroke:#0277bd,color:black

    A[Startup crash]:::error --> B{What does the error say?}:::check

    B -->|DISCORD_TOKEN is required| C[Set DISCORD_TOKEN in .env]:::fix
    B -->|Cannot connect to database| D[Verify DATABASE_URL]:::fix
    B -->|P1001 / connection refused| E[Start PostgreSQL]:::fix
    B -->|Module not found| F[Run npm install]:::fix

    C --> G[Restart Sage]:::check
    D --> G
    E --> G
    F --> G
```

### “DISCORD_TOKEN is required”

**Cause:** Missing or invalid Discord token.

**Fix:**

1. Get token from <https://discord.com/developers/applications>
2. Add to `.env`: `DISCORD_TOKEN=your_token_here`
3. Restart the bot

### “P1001: Cannot connect to database”

**Cause:** PostgreSQL is not running or the URL is incorrect.

**Fix:**

1. Verify PostgreSQL is running
2. Check `DATABASE_URL` format: `postgresql://user:password@host:5432/sage`
3. Run `npx prisma migrate deploy` to apply schema migrations

---

<a id="response-issues"></a>

## 🟡 Response Issues

### Bot is online but not responding

Check these in order:

| Check | Command/Action | Expected |
| :--- | :--- | :--- |
| Bot has permissions | Check channel permissions | Send Messages ✅ |
| Wake word matches | `Sage, hello` | Response |
| API key active | `/sage key check` | Key status shown |
| Rate limit | Wait 10 seconds | Try again |

### “No API key” error in guild

**Cause:** Sage has no usable provider credential for this server or host.

**Fix:**

1. If you are using Sage's hosted/default Pollinations-backed flow, run `/sage key login`
2. Follow the Pollinations login instructions
3. Run `/sage key set sk_your_key`
4. If you self-host Sage against another OpenAI-compatible provider, set `LLM_API_KEY` in `.env` instead

### Response is truncated or cut off

**Cause:** Token limits too low.

**Fix in `.env`:**

```env
CONTEXT_MAX_INPUT_TOKENS=120000
CONTEXT_RESERVED_OUTPUT_TOKENS=12000
```

---

<a id="memory-learning-issues"></a>

## 🟠 Memory & Learning Issues

### Sage doesn’t remember conversations

Possible causes:

1. **Database storage disabled**

   ```env
   MESSAGE_DB_STORAGE_ENABLED=true  # Must be true
   ```

2. **Profile update interval too high**

   ```env
   PROFILE_UPDATE_INTERVAL=5  # Update every 5 messages
   ```

3. **Memory timeout too short**

   ```env
   TIMEOUT_MEMORY_MS=600000  # 10 minutes
   ```

### “520 Error” or JSON parsing errors

**Cause:** LLM response truncated.

**Fix:**

1. Increase timeout: `TIMEOUT_MEMORY_MS=600000`
2. Use reliable model for profiles: `PROFILE_CHAT_MODEL=deepseek`

---

<a id="command-issues"></a>

## 🔵 Command Issues

### Slash commands not appearing

**Cause:** Commands need to be registered with Discord.

**Fix:**

1. Set `DEV_GUILD_ID` for instant updates (dev):

   ```env
   DEV_GUILD_ID=your_guild_id
   ```

2. Restart the bot
3. Wait up to 1 hour for global commands to propagate

### “Unknown interaction” error

**Cause:** Bot took too long to respond.

**Fix:**

1. Check provider status
2. Reduce `TIMEOUT_CHAT_MS` if needed
3. Ensure a stable network connection

---

<a id="database-issues"></a>

## 🟣 Database Issues

### “P2002: Unique constraint violation”

**Cause:** Duplicate data being inserted.

**Fix:**

1. Usually harmless (duplicate prevention)
2. Ensure you don’t have duplicate bot instances running

### Missing tables or columns

**Cause:** Schema out of sync.

**Fix:**

```bash
npx prisma migrate deploy                     # Apply tracked migrations
npx prisma migrate reset --force --skip-generate  # Development-only full reset
```

---

<a id="performance-issues"></a>

## ⚡ Performance Issues

### High memory usage

Reduce these settings:

```env
RING_BUFFER_MAX_MESSAGES_PER_CHANNEL=100  # Reduce from 200
CONTEXT_TRANSCRIPT_MAX_MESSAGES=10         # Reduce from 15
RAW_MESSAGE_TTL_DAYS=1                     # Reduce from 3
```

### Slow responses

| Factor | Optimization |
| :--- | :--- |
| Model | Default is `CHAT_MODEL=kimi`; change only when you need a different quality/latency profile |
| Context | Reduce `CONTEXT_MAX_INPUT_TOKENS` |
| Network | Check your configured provider/API status |

---

<a id="error-code-reference"></a>

## 📋 Error Code Reference

| Error | Meaning | Quick Fix |
| :--- | :--- | :--- |
| `P1001` | Database connection failed | Start PostgreSQL |
| `P2002` | Unique constraint violation | Usually safe to ignore |
| `P2025` | Record not found | Data was already deleted |
| `520` | LLM response truncated | Increase timeouts |
| `ECONNREFUSED` | Service unavailable | Check if service is running |
| `ETIMEDOUT` | Request timed out | Increase `TIMEOUT_CHAT_MS` |

---

<a id="still-having-issues"></a>

## 🆘 Still Having Issues?

1. Enable debug logs:

   ```env
   LOG_LEVEL=debug
   ```

2. Check diagnostics and traces:

   ```bash
   npm run doctor -- --llm-ping
   ```

   Alternative env-var syntax also works: `LLM_DOCTOR_PING=1 npm run doctor`.
   For deeper trace inspection, review `AgentTrace` rows via `npm run db:studio`.

3. Open an issue: <https://github.com/BokX1/Sage/issues>

Include:

- Error message
- `npm run doctor` output
- Steps to reproduce
- Node.js and OS version

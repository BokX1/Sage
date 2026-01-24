# 🔧 Troubleshooting Guide

Quick fixes for common Sage issues.

---

## 🚦 Quick Diagnostics

Run the built-in health check first:

```bash
npm run doctor
```

This validates:

- ✅ Environment configuration
- ✅ Database connectivity
- ✅ LLM provider availability (if `LLM_DOCTOR_PING=1`)

---

## 🔴 Startup Issues

### Bot crashes on startup

```mermaid
flowchart TD
    %% Styling
    classDef error fill:#ffcdd2,stroke:#c62828,color:black
    classDef fix fill:#c8e6c9,stroke:#2e7d32,color:black
    classDef check fill:#e1f5fe,stroke:#0277bd,color:black

    A[Bot crashes on startup]:::error --> B{Error message?}:::check
    B -->|DISCORD_TOKEN is required| C[Set DISCORD_TOKEN in .env]:::fix
    B -->|Cannot connect to database| D[Check DATABASE_URL]:::fix
    B -->|P1001: Connection refused| E[Start PostgreSQL]:::fix
    B -->|Module not found| F[Run npm install]:::fix
    C --> G[Restart bot]:::check
    D --> G
    E --> G
    F --> G
```

### "DISCORD_TOKEN is required"

**Cause:** Missing or invalid Discord token.

**Fix:**

1. Get token from [Discord Developer Portal](https://discord.com/developers/applications)
2. Add to `.env`: `DISCORD_TOKEN=your_token_here`
3. Restart the bot

### "P1001: Cannot connect to database"

**Cause:** PostgreSQL is not running or URL is incorrect.

**Fix:**

1. Verify PostgreSQL is running
2. Check `DATABASE_URL` format: `postgresql://user:password@host:5432/sage`
3. Run `npx prisma db push` to sync schema

---

## 🟡 Response Issues

### Bot is online but not responding

Check these in order:

| Check | Command/Action | Expected |
|:------|:---------------|:---------|
| Bot has permissions | Check channel permissions | Send Messages ✅ |
| Wake word matches | `Sage, hello` | Response |
| API key active | `/sage key check` | Key status shown |
| Rate limit | Wait 10 seconds | Try again |

### "No API key" error in guild

**Cause:** Server needs a Pollinations API key.

**Fix:**

1. Run `/sage key login`
2. Follow the login instructions
3. Run `/sage key set sk_your_key`

### Response is truncated or cut off

**Cause:** Token limits too low.

**Fix in `.env`:**

```env
CONTEXT_MAX_INPUT_TOKENS=65536
CONTEXT_RESERVED_OUTPUT_TOKENS=8192
```

---

## 🟠 Memory & Learning Issues

### Sage doesn't remember conversations

**Possible causes:**

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

### "520 Error" or JSON parsing errors

**Cause:** LLM response truncated.

**Fix:**

1. Increase timeout: `TIMEOUT_MEMORY_MS=600000`
2. Use reliable model for profiles: `PROFILE_POLLINATIONS_MODEL=deepseek`

---

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

### "Unknown interaction" error

**Cause:** Bot took too long to respond.

**Fix:**

1. Check LLM provider status
2. Reduce `TIMEOUT_CHAT_MS` if needed
3. Ensure stable network connection

---

## 🟣 Database Issues

### "P2002: Unique constraint violation"

**Cause:** Duplicate data being inserted.

**Fix:**

1. This is usually harmless (duplicate prevention)
2. Check for duplicate bot instances running

### Missing tables or columns

**Cause:** Schema out of sync.

**Fix:**

```bash
npx prisma db push        # Development
npx prisma migrate deploy # Production
```

---

## ⚡ Performance Issues

### High memory usage

**Optimize these settings:**

```env
RING_BUFFER_MAX_MESSAGES_PER_CHANNEL=100  # Reduce from 200
CONTEXT_TRANSCRIPT_MAX_MESSAGES=10         # Reduce from 15
RAW_MESSAGE_TTL_DAYS=1                     # Reduce from 3
```

### Slow responses

Check these factors:

| Factor | Optimization |
|:-------|:-------------|
| Model | Use faster model: `POLLINATIONS_MODEL=gemini` |
| Context | Reduce `CONTEXT_MAX_INPUT_TOKENS` |
| Network | Check Pollinations API status |

---

## 📋 Error Code Reference

| Error | Meaning | Quick Fix |
|:------|:--------|:----------|
| `P1001` | Database connection failed | Start PostgreSQL |
| `P2002` | Unique constraint violation | Usually safe to ignore |
| `P2025` | Record not found | Data was already deleted |
| `520` | LLM response truncated | Increase timeouts |
| `ECONNREFUSED` | Service unavailable | Check if service is running |
| `ETIMEDOUT` | Request timed out | Increase `TIMEOUT_CHAT_MS` |

---

## 🆘 Still Having Issues?

1. **Enable debug logging:**

   ```env
   LOG_LEVEL=debug
   ```

2. **Check traces:**

   ```text
   /sage admin trace
   ```

3. **Open an issue:** [GitHub Issues](https://github.com/BokX1/Sage/issues)

Include:

- Error message
- `npm run doctor` output
- Steps to reproduce
- Node.js and OS version

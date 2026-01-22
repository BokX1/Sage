# Sage Runbook

A practical guide for operating and maintaining your Sage bot.

---

## 🚀 Quick Reference

### Start Sage

```bash
npm run dev        # Development (with hot-reload)
npm run build && npm start  # Production
```

### Check Health

```bash
npm run doctor     # Check configuration and database
```

### Database Operations

```bash
npm run db:migrate  # Apply database changes
npm run db:studio   # Open visual database browser
```

---

## ✅ Startup Checklist

Before starting Sage, verify:

| Check | Command/Action | Expected Result |
|:------|:---------------|:----------------|
| Docker running | Open Docker Desktop | Green "Running" status |
| Database up | `docker compose up -d db` | Container starts |
| Config valid | `npm run doctor` | All checks pass |
| Token correct | Check `.env` file | No spaces/quotes in token |

---

## 🔧 Environment Requirements

### Minimum Required

| Variable | Description | How to Get |
|:---------|:------------|:-----------|
| `DISCORD_TOKEN` | Bot authentication | [Discord Developer Portal](https://discord.com/developers) → Bot → Token |
| `DISCORD_APP_ID` | Application identifier | Developer Portal → General Information |
| `DATABASE_URL` | Database connection | Auto-configured with Docker |

### Recommended Settings

| Variable | Recommended Value | Why |
|:---------|:------------------|:----|
| `LOGGING_ENABLED` | `true` | Enables memory features |
| `TRACE_ENABLED` | `true` | Helps debug issues |
| `AUTOPILOT_MODE` | `manual` | Predictable behavior |
| `DEV_GUILD_ID` | Your server ID | Fast command registration (development) |

### Optional Enhancements

| Variable | When to Use |
|:---------|:------------|
| `POLLINATIONS_API_KEY` | Required for onboarding; higher rate limits |
| `ADMIN_USER_IDS` | To enable admin commands |
| `LOG_LEVEL=debug` | When troubleshooting |

See [Configuration Reference](../CONFIGURATION.md) for all options.

---

## 🗄️ Database Management

### Apply Migrations

After updates or fresh install:

```bash
npm run db:migrate
```

**What it does:** Creates or updates database tables to match Sage's requirements.

### Browse Data

```bash
npm run db:studio
```

**What it does:** Opens a visual interface at `http://localhost:5555` to view and edit database records.

### Reset Database

⚠️ **Warning:** This deletes all data!

```bash
docker compose down -v   # Remove containers and volumes
docker compose up -d db  # Start fresh database
npm run db:migrate       # Recreate tables
```

---

## 🏥 Health Checks

### In Discord

| Command | What It Checks | Who Can Use |
|:--------|:---------------|:------------|
| `/ping` | Bot is online and responsive | Everyone |
| `/llm_ping` | AI connectivity and latency | Admins only |

### In Terminal

```bash
npm run doctor
```

**Checks performed:**

- ✅ Required environment variables set
- ✅ Database connection works
- ✅ Discord token valid
- ✅ LLM connectivity (if `LLM_DOCTOR_PING=1`)

---

## 📋 Logs

Sage uses structured logging via Pino.

### Change Log Level

In `.env`:

```
LOG_LEVEL=debug   # Most verbose
LOG_LEVEL=info    # Normal (default)
LOG_LEVEL=warn    # Warnings only
LOG_LEVEL=error   # Errors only
```

### Key Log Messages

| Message | Meaning |
|:--------|:--------|
| `Logged in as Sage#1234` | Successfully connected to Discord |
| `Ready!` | Bot is fully operational |
| `Router decision` | Shows how a message was classified |
| `Agent runtime: built context` | Context being sent to AI |
| `Channel summary scheduler tick` | Automatic summary processing |

### Common Warning Signs

| Log Pattern | What It Means | Action |
|:------------|:--------------|:-------|
| `Database connection failed` | Can't reach PostgreSQL | Check Docker is running |
| `Rate limited` | Too many AI requests | Wait or get API key |
| `Formatter retry failed` | AI returned invalid JSON | Usually self-recovers |
| `Token invalid` | Discord rejected the token | Reset token in Developer Portal |

---

## 🔄 Restart Notes

### Safe to Restart Anytime

Restarting Sage is always safe:

- ✅ Commands re-register automatically
- ✅ Summary scheduler restarts from where it left off
- ✅ Database data persists

### What Happens on Restart

1. **Slash commands** re-register (global: up to 1 hour, guild: instant)
2. **Message backfill** fetches recent messages from each channel
3. **Summary scheduler** starts fresh timer
4. **Voice sessions** track new activity (previous sessions saved)

---

## 🆘 Common Issues

### "Cannot connect to database"

**Check:**

1. Is Docker Desktop running?
2. Is the database container up? Run: `docker compose up -d db`
3. Wait 10 seconds for database to initialize

### "Invalid token"

**Fix:**

1. Go to Discord Developer Portal
2. Bot → Reset Token
3. Copy new token to `.env`
4. Restart Sage

### Bot not responding

**Check:**

1. Is Sage online in your server?
2. Are you using a wake word? (default: "sage")
3. Does Sage have message permissions in the channel?
4. Run `npm run doctor` for diagnostics

### Commands not showing

**Causes & Fixes:**

- **Global commands:** Wait up to 1 hour
- **Fast testing:** Set `DEV_GUILD_ID` to your server ID
- **Missing scope:** Re-invite bot with `applications.commands` OAuth2 scope

---

## 📈 Performance Tips

### Reduce Memory Usage

Lower these in `.env`:

```
RING_BUFFER_MAX_MESSAGES_PER_CHANNEL=100
CONTEXT_TRANSCRIPT_MAX_MESSAGES=10
```

### Speed Up Responses

- Use a faster model: `POLLINATIONS_MODEL=gemini`
- Get an API key for higher rate limits
- Reduce context sizes (see above)

### Handle High Traffic

- Increase rate limits carefully
- Consider hosting on a VPS for better uptime
- Monitor with `LOG_LEVEL=info`

---

## 🚢 Production Deployment

### Build for Production

```bash
npm run build    # Compile TypeScript
npm start        # Run production build
```

### Recommended Hosting

| Provider | Notes |
|:---------|:------|
| [Railway](https://railway.app) | Easy deployment, free tier available |
| [Render](https://render.com) | Simple setup, auto-deploys from GitHub |
| [DigitalOcean](https://digitalocean.com) | Droplets for full control |
| VPS (any) | Full control, requires more setup |

### Production Checklist

- [ ] `NODE_ENV=production`
- [ ] Remove `DEV_GUILD_ID` (or set to empty)
- [ ] Set appropriate `LOG_LEVEL` (info or warn)
- [ ] Configure admin access (`ADMIN_USER_IDS`)
- [ ] Secure database credentials
- [ ] Set up process manager (pm2) for auto-restart

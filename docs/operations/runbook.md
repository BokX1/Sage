# Sage Operational Runbook

This runbook covers environment setup, migrations, health checks, and safe operations.

## Environment checklist

Minimum required:
- `DISCORD_TOKEN`
- `DISCORD_APP_ID`
- `DATABASE_URL`

Recommended:
- `LOGGING_ENABLED=true` to capture transcripts, summaries, and relationships.
- `TRACE_ENABLED=true` to store routing/expert traces.
- `AUTOPILOT_MODE=manual` to avoid unsolicited replies.

Optional:
- `DEV_GUILD_ID` to speed up slash command registration while developing.
- `POLLINATIONS_API_KEY` if your Pollinations endpoint needs it.

See `.env.example` for the complete list of tunables.

## Database migrations

```bash
npm run db:migrate
```

For DB inspection:

```bash
npm run db:studio
```

## Health checks

- `/ping` → verifies Discord connectivity.
- `/llm_ping` → verifies LLM connectivity and latency (admin-only).
- `npm run doctor` → validates config + database connectivity (optionally set `LLM_DOCTOR_PING=1` to ping the LLM).

## Logs

Sage uses structured logs via Pino. Set `LOG_LEVEL` to `debug` for verbose traces.

Common log indicators:
- `Router decision` → route selection and temperature.
- `Agent runtime: built context with experts` → expert packet injection.
- `Channel summary scheduler tick failed` → non-fatal summary errors.

## Safe restart notes

- **Restarting the bot** re-registers slash commands and restarts the summary scheduler.
- **Startup backfill**: on ready, Sage backfills recent messages for each cached text channel (up to `CONTEXT_TRANSCRIPT_MAX_MESSAGES`).
- **In-flight summaries**: scheduler runs on a timer; restarting is safe but may delay the next rollup.

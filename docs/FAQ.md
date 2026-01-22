# Frequently Asked Questions

Find answers to common questions about Sage.

---

## 📖 About Sage

<details>
<summary><strong>What is Sage?</strong></summary>

Sage is an AI-powered Discord bot that provides intelligent, context-aware conversations. Unlike simple chatbots, Sage:

- Remembers past conversations
- Builds profiles of users over time
- Understands community relationships
- Provides personalized responses based on context

It's designed to feel like a helpful community member, not just a command bot.
</details>

<details>
<summary><strong>Is Sage free to use?</strong></summary>

**Yes!** Sage is completely free and open source. It uses [Pollinations.ai](https://pollinations.ai) for AI capabilities, which offers free API access. You only need to cover your own hosting costs (which can be $0 if self-hosting).
</details>

<details>
<summary><strong>What AI models does Sage use?</strong></summary>

Sage uses multiple models through Pollinations.ai:

- **Chat:** Gemini (default), or any model available on Pollinations
- **Analysis:** DeepSeek for user profile analysis
- **Summaries:** OpenAI-Large for channel summaries
- **Formatting:** Qwen-Coder for structured JSON output

You can change the chat model via `/model select` (or legacy `/setmodel`) or in your `.env` file. Summaries and profile analysis use separate model settings.
</details>

<details>
<summary><strong>Can Sage see images?</strong></summary>

**Yes!** When you share an image and mention Sage, it can analyze and discuss the image using vision-capable models. If the current model doesn't support vision, Sage automatically falls back to one that does.
</details>

<details>
<summary><strong>Does Sage work with voice chat?</strong></summary>

Sage has **voice awareness** — it knows who's in voice channels and for how long. You can ask:

- "Sage, who's in voice right now?"
- "Sage, how long has @user been in voice today?"

However, Sage does not listen to or transcribe voice conversations.
</details>

---

## 🔧 Setup & Configuration

<details>
<summary><strong>What are the minimum requirements?</strong></summary>

**Software:**

- Node.js 18 or newer
- PostgreSQL database (via Docker or external)
- Internet connection

**Hardware:**

- Any modern computer can run Sage
- About 512MB RAM minimum
- 500MB disk space

**Discord:**

- Discord bot token and application ID
- Message Content Intent enabled

</details>

<details>
<summary><strong>Do I need to install Docker?</strong></summary>

**Recommended but not required.** Docker makes database setup simple with one command. Without Docker, you'll need to:

1. Install PostgreSQL manually
2. Create a database
3. Configure the connection string

See the [Getting Started Guide](GETTING_STARTED.md#alternative-database-without-docker) for manual setup.
</details>

<details>
<summary><strong>How do I get a Discord bot token?</strong></summary>

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click "New Application" → give it a name → Create
3. Click "Bot" in the sidebar
4. Click "Reset Token" and copy the token

**Important:** Enable these intents on the Bot page:

- ✅ Presence Intent
- ✅ Server Members Intent
- ✅ Message Content Intent

See [Step-by-step guide](GETTING_STARTED.md#step-2-create-your-discord-bot) for details.
</details>

<details>
<summary><strong>How do I change Sage's wake word?</strong></summary>

Edit `.env` and change:

```
WAKE_WORDS=sage
```

To a comma-separated list:

```
WAKE_WORDS=sage,buddy,assistant
```

Restart Sage for changes to take effect.
</details>

<details>
<summary><strong>How do I make Sage respond without being mentioned?</strong></summary>

Change `AUTOPILOT_MODE` in your `.env`:

| Mode | Behavior | API Usage |
|:-----|:---------|:----------|
| `manual` | Only responds when wake word/@ mentioned (default) | 🟢 Low |
| `reserved` | Occasionally joins relevant conversations | 🟡 Medium |
| `talkative` | Actively participates without prompts | 🔴 High |

> ⚠️ **Cost Warning:** Autopilot modes process **every message** to decide whether to respond. This significantly increases API usage. Best for **low-activity servers** (< 100 messages/day) where you want Sage to feel "alive."

Example:

```
AUTOPILOT_MODE=reserved
```

</details>

<details>
<summary><strong>How do I become an admin?</strong></summary>

Add your Discord User ID to `.env`:

```
ADMIN_USER_IDS=123456789012345678
```

**To find your User ID:**

1. Enable Developer Mode: Discord Settings → App Settings → Advanced → Developer Mode
2. Right-click your name → "Copy User ID"

For role-based admin access:

```
ADMIN_ROLE_IDS=111111111,222222222
```

</details>

---

## 💬 Using Sage

<details>
<summary><strong>How do I talk to Sage?</strong></summary>

Sage responds when its wake word (default: "sage") is at the **start** of your message:

- "Sage, how are you?"
- "Sage what's the weather like?"
- "sage tell me a joke"

> **Note:** The wake word must be at the beginning. Saying "I asked sage about this" will NOT trigger a response.
</details>

<details>
<summary><strong>What commands are available?</strong></summary>

**Public Commands:**

| Command | Description |
|:--------|:------------|
| `/ping` | Check if Sage is online |
| `/sage whoiswho @user` | See relationship info for a user |

**Admin Commands:**

| Command | Description |
|:--------|:------------|
| `/llm_ping` | Test AI connectivity and latency |
| `/models` | List available AI models |
| `/model list` | List available AI models |
| `/model select <model>` | Change the AI model for this server |
| `/model reset` | Reset to default model |
| `/model refresh` | Refresh the model catalog |
| `/setmodel <model>` | Legacy alias for model selection |
| `/resetmodel` | Legacy alias for model reset |
| `/sage admin stats` | View bot statistics |
| `/sage admin summarize` | Force a channel summary |
| `/sage admin trace` | View recent processing traces |

</details>

<details>
<summary><strong>Why isn't Sage responding to my messages?</strong></summary>

**Check these:**

1. **Is Sage online?** Check the member list.
2. **Are you using a wake word?** Default is "sage" — try "Sage, hello"
3. **Does Sage have permissions?** It needs Send Messages and Read Message History
4. **Is the channel blocked?** Check `LOGGING_BLOCKLIST_CHANNEL_IDS`
5. **Rate limited?** Wait a few seconds and try again

Run `npm run doctor` to diagnose configuration issues.
</details>

<details>
<summary><strong>Can Sage respond in other languages?</strong></summary>

Yes! Sage will typically respond in the language you use. The underlying AI models support many languages. For best results, ensure your conversation is consistently in one language.
</details>

---

## 🔴 Troubleshooting

<details>
<summary><strong>Error: "Cannot connect to database"</strong></summary>

**Causes:**

- Docker isn't running
- Database container isn't started
- Wrong connection string

**Solutions:**

1. Make sure Docker Desktop is running
2. Start the database: `docker compose up -d db`
3. Wait 10 seconds and try again
4. Check `DATABASE_URL` in `.env` is correct

</details>

<details>
<summary><strong>Error: "Invalid token"</strong></summary>

**Causes:**

- Token was copied incorrectly
- Token was reset on Discord's side
- Extra spaces or quotes in the token

**Solutions:**

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your app → Bot → Reset Token
3. Copy the new token (no extra spaces!)
4. Update `.env` with the new token
5. Restart Sage

</details>

<details>
<summary><strong>Error: "Missing intents"</strong></summary>

**Cause:** Required Discord intents aren't enabled.

**Solution:**

1. Go to Discord Developer Portal → Your App → Bot
2. Enable all three Privileged Gateway Intents:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent
3. Save changes and restart Sage

</details>

<details>
<summary><strong>Commands not appearing in Discord</strong></summary>

**Causes:**

- Commands take time to register globally (up to 1 hour)
- Bot wasn't invited with `applications.commands` scope

**Solutions:**

1. **For faster testing:** Add `DEV_GUILD_ID=your_server_id` to `.env`
2. **Re-invite the bot** with the correct OAuth2 scopes:
   - `bot`
   - `applications.commands`
3. Wait up to 1 hour for global registration

</details>

<details>
<summary><strong>Sage is slow to respond</strong></summary>

**Causes:**

- AI model is processing a long response
- Network latency
- Rate limiting on Pollinations API

**Solutions:**

1. Be patient — complex queries take longer
2. Get a Pollinations API key for higher limits
3. Try a faster model: `/model select gemini` (or `/setmodel gemini`)
4. Check your internet connection

</details>

<details>
<summary><strong>Out of memory errors</strong></summary>

**Cause:** Node.js running out of memory on large contexts.

**Solution:** Reduce context sizes in `.env`:

```
CONTEXT_TRANSCRIPT_MAX_MESSAGES=10
RING_BUFFER_MAX_MESSAGES_PER_CHANNEL=100
```

</details>

---

## 🔐 Privacy & Data

<details>
<summary><strong>What data does Sage store?</strong></summary>

| Data Type | Description | Can Disable? |
|:----------|:------------|:-------------|
| **User Profiles** | AI-generated summaries of user preferences | No (core feature) |
| **Channel Summaries** | Rolling conversation summaries | Set `LOGGING_ENABLED=false` |
| **Messages** | Recent messages for context | Set `MESSAGE_DB_STORAGE_ENABLED=false` |
| **Voice Sessions** | Join/leave times | Set `LOGGING_ENABLED=false` |
| **Relationships** | User interaction patterns | Automatic |
| **Traces** | Processing logs for debugging | Set `TRACE_ENABLED=false` |

</details>

<details>
<summary><strong>How do I delete stored data?</strong></summary>

There's no built-in purge command yet. To delete data:

1. Stop Sage
2. Connect to your database:

   ```bash
   npm run db:studio
   ```

3. Delete records from desired tables
4. Restart Sage

Or reset everything:

```bash
docker compose down -v
docker compose up -d db
npm run db:migrate
```

</details>

<details>
<summary><strong>Is my data sent to third parties?</strong></summary>

When generating responses, Sage sends conversation context to **Pollinations.ai** for AI processing. This includes:

- The current message
- Recent conversation history (if logging enabled)
- User/channel summaries

Pollinations.ai's privacy policy applies to data they process. Sage does not send data anywhere else.
</details>

<details>
<summary><strong>How do I disable all logging?</strong></summary>

Add to `.env`:

```
LOGGING_ENABLED=false
MESSAGE_DB_STORAGE_ENABLED=false
TRACE_ENABLED=false
```

This disables:

- Message storage
- Voice session tracking
- Processing traces

Note: User profiles and summaries are core features and cannot be fully disabled.
</details>

---

## 🤝 Contributing

<details>
<summary><strong>How can I contribute to Sage?</strong></summary>

We welcome contributions! Here's how:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Submit a pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for detailed guidelines.
</details>

<details>
<summary><strong>I found a bug, where do I report it?</strong></summary>

Open an issue on GitHub: [github.com/BokX1/Sage/issues](https://github.com/BokX1/Sage/issues)

Include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Relevant error messages
- Your Node.js version and OS

</details>

---

## 📞 Still Need Help?

- **Run diagnostics:** `npm run doctor`
- **Check logs:** Look at the terminal output for errors
- **GitHub Issues:** [Open a new issue](https://github.com/BokX1/Sage/issues)

# Frequently Asked Questions

Find answers to common questions about Sage.

---

## 🌟 First Timer Questions

<details>
<summary><strong>I'm not technical — can I still use Sage?</strong></summary>

**Absolutely!** We've created a [5-Minute Quick Start Guide](QUICKSTART.md) specifically for people who just want to get Sage running without diving into technical details. You'll copy and paste a few commands, and that's it!

</details>

<details>
<summary><strong>Will this cost me money?</strong></summary>

**Sage is designed to be free.**

- **Software:** Free & Open Source.
- **AI Credits:** Uses the **Bring Your Own Pollen (BYOP)** model.
  - Server Admins get a free API key from [Pollinations.ai](https://pollinations.ai).
  - This key provides free, unlimited AI usage for their server.
- **Hosting:** If you self-host, you only pay for your own server costs (if any).

</details>

<details>
<summary><strong>Is this safe for my Discord server?</strong></summary>

**Yes!** Here's why:

- 🔒 **You control everything** — Sage runs on your computer or server
- 🔐 **No data sold** — We don't collect or sell any information
- 👁️ **Open source** — Anyone can review the code
- ⚙️ **Privacy settings** — You can disable logging if you prefer

See [Security & Privacy](security_privacy.md) for complete details.

</details>

<details>
<summary><strong>What if I get stuck during setup?</strong></summary>

Don't worry! Here are your options:

1. **Run the doctor:** `npm run doctor` checks your setup
2. **Check the troubleshooting section** below
3. **Open an issue on GitHub** — we're happy to help!

Most problems are fixed by re-running the onboarding wizard: `npm run onboard`

</details>

---

## 📖 About Sage

<details>
<summary><strong>What is Sage?</strong></summary>

Sage is a Fully Agentic AI companion. Unlike simple chatbots, Sage is designed to be a friendly member of your community who **listens and evolves alongside you**.

- 🧠 **Personalized Touch**: Remembers past conversations to provide helpful context.
- 👥 **Socially Aware**: Understands the unique relationships and "vibe" of your server.
- 📄 **Knowledgeable**: Can ingest files and discuss them with the community.

It feels like a helpful community member, not just a command bot.
</details>

<details>
<summary><strong>Is Sage free to use?</strong></summary>

**Yes!** Sage is completely free and open source. It uses [Pollinations.ai](https://pollinations.ai) for AI capabilities, which offers free API access. You only need to cover your own hosting costs (which can be $0 if self-hosting).
</details>

<details>
<summary><strong>What AI models does Sage use?</strong></summary>

Sage uses an intelligent multi-model pipeline:

- **Router:** Gemini-Fast (Gemini 2.5 Flash Lite) for high-precision context analysis.
- **Chat:** Gemini (default), or any model available on Pollinations.
- **Analysis:** DeepSeek for user profile analysis.
- **Summaries:** OpenAI-Large for channel summaries.
- **Formatting:** Qwen-Coder for structured JSON output.

</details>

<details>
<summary><strong>Can Sage read files?</strong></summary>

**Yes!** Sage supports **File Ingestion**. You can share:

- **Code files** (.ts, .js, .py, etc.)
- **Text documents** (.txt, .md)

Sage will "read" the file and use its contents to help you answer questions or provide code reviews. *Note: PDF support is coming in a future update.*
</details>

<details>
<summary><strong>Can Sage see images?</strong></summary>

**Yes!** When you share an image and mention Sage, it can analyze and discuss the image using vision-capable models.
</details>

<details>
<summary><strong>Does Sage work with voice chat?</strong></summary>

Sage has **Voice Awareness** — it understands who's hanging out in voice channels and translates session tracking into natural language insights. You can ask:

- "Sage, who's in voice right now?"
- "Sage, how long has @user been in voice today?"

Sage does not listen to or transcribe voice conversations.
</details>

---

## 🔧 Setup & Configuration

<details>
<summary><strong>How do I change Sage's wake word?</strong></summary>

Edit `.env` and change:

```env
WAKE_WORDS=sage
```

Restart Sage for changes to take effect.
</details>

<details>
<summary><strong>How do I make Sage respond without being mentioned?</strong></summary>

Change `AUTOPILOT_MODE` in your `.env`:

| Mode | Behavior | API Usage |
|:-----|:---------|:----------|
| `manual` | Only responds when wake word/@mentioned or Replied to (default) | 🟢 Low |
| `reserved` | Occasionally joins relevant conversations autonomously | 🟡 Medium |
| `talkative` | Actively participates in discussions without prompts | 🔴 High |

Example:

```env
AUTOPILOT_MODE=manual
```

</details>

---

## 💬 Using Sage

<details>
<summary><strong>How do I talk to Sage?</strong></summary>

You can talk to Sage in three ways:

1. **Prefix**: Start your message with "**Sage**" (e.g., "Sage, what's the weather like?")
2. **Mention**: Tag the bot anywhere in your message (**@Sage**)
3. **Reply**: Simply **reply** to any of Sage's messages.

</details>

<details>
<summary><strong>What commands are available?</strong></summary>

**Public Commands:**

- `/ping`: Check connectivity.
- `/sage whoiswho @user`: See relationship info.

**Admin Commands:**

- `/sage key login/set`: Manage API keys.
- `/sage admin trace`: View recent routing reasoning and expertise.
- `/sage admin stats`: View bot statistics.

</details>

---

## 🔴 Troubleshooting

<details>
<summary><strong>Sage is slow to respond</strong></summary>

**Causes:**

- High-precision routing (resolving pronouns across history).
- Large context ingestion (if you shared a long file).
- Pollinations API load.

**Solutions:**

- Be patient — complex reasoning takes a few seconds.
- Ensure your `POLLINATIONS_API_KEY` is set for faster priority.

</details>

---

## 🔐 Privacy & Data

<details>
<summary><strong>What data does Sage store?</strong></summary>

| Data Type | Description |
|:----------|:------------|
| **User Profiles** | Agentic summaries of your preferences (Throttled for efficiency). |
| **Relationship Tiers** | Interaction-based tiers (e.g., "Best Friend") with emojis. |
| **Traces** | Routing `reasoningText` to explain why Sage responded the way it did. |

</details>

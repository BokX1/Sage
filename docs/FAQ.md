# ❓ Frequently Asked Questions

Common questions about Sage, setup, and behavior.

---

## 🧭 Quick navigation

- [🌟 First-Timer Questions](#first-timer-questions)
- [📖 About Sage](#about-sage)
- [🔧 Setup & Configuration](#setup-configuration)
- [💬 Using Sage](#using-sage)
- [🔴 Troubleshooting](#troubleshooting)
- [🔐 Privacy & Data](#privacy-data)

---

## 🌟 First-Timer Questions

<details>
<summary><strong>I'm not technical — can I still use Sage?</strong></summary>

Yes. Start with the **[⚡ Quick Start Guide](QUICKSTART.md)** for a minimal, copy/paste setup.

</details>

<details>
<summary><strong>Will this cost me money?</strong></summary>

Sage is designed to be **free to run**:

- **Software:** Free & Open Source.
- **AI Credits:** Sage uses **Bring Your Own Pollen (BYOP)**.
  - Server admins generate a key from [Pollinations.ai](https://pollinations.ai).
  - That key is used by the server for Sage’s AI requests.
- **Hosting:** If you self-host, you pay only for your own infrastructure (if any).

</details>

<details>
<summary><strong>Is this safe for my Discord server?</strong></summary>

Sage is built to be transparent and controllable:

- 🔒 **You control settings** (logging, tracing, retention)
- 👁️ **Open source** — behavior is reviewable
- ⚙️ **Privacy controls** — you can disable ingestion/logging

See **[Security &amp; Privacy](security_privacy.md)** for concrete details on what’s stored and how to disable it.

</details>

<details>
<summary><strong>What if I get stuck during setup?</strong></summary>

Try these in order:

1. Run `npm run doctor`
2. Check **[Troubleshooting](TROUBLESHOOTING.md)**
3. Re-run the onboarding wizard: `npm run onboard`
4. If still blocked, open a GitHub issue

</details>

---

## 📖 About Sage

<details>
<summary><strong>What is Sage?</strong></summary>

Sage is a fully agentic AI companion. Unlike simple chatbots, Sage aims to behave like a helpful community member who **listens and evolves alongside you**.

- 🧠 **Personalized touch**: Remembers context to respond more helpfully over time.
- 👥 **Socially aware**: Understands relationships and the “vibe” of a server.
- 📄 **Knowledgeable**: Can ingest files and discuss them with the community.

</details>

<details>
<summary><strong>Is Sage free to use?</strong></summary>

Yes — Sage is free and open source. It uses [Pollinations.ai](https://pollinations.ai) for AI capabilities, which offers free API access. If you self-host, you only pay for your own hosting costs (which can be $0).

</details>

<details>
<summary><strong>What AI models does Sage use?</strong></summary>

Sage uses a multi-model pipeline:

- **Router:** Gemini-Fast (Gemini 2.5 Flash Lite) for high-precision context analysis.
- **Chat:** Gemini (default), or any model available on Pollinations.
- **Analysis:** DeepSeek for user profile analysis.
- **Summaries:** OpenAI-Large for channel summaries.
- **Formatting:** Qwen-Coder for structured JSON output.

You can change defaults in **[Configuration](CONFIGURATION.md)**.

</details>

<details>
<summary><strong>Can Sage read files?</strong></summary>

Yes. Sage supports file ingestion for:

- Code files (`.ts`, `.js`, `.py`, etc.)
- Text documents (`.txt`, `.md`)

Sage uses file contents to help answer questions (e.g., code review, explanations). *PDF support is planned for a future update.*

</details>

<details>
<summary><strong>Can Sage see images?</strong></summary>

Yes. If you share an image and trigger Sage, it can analyze the image using vision-capable models.

</details>

<details>
<summary><strong>Does Sage work with voice chat?</strong></summary>

Sage has **Voice Awareness**: it can answer questions like who is in voice and how long someone has been in voice.

Sage does not listen to or transcribe voice conversations.

</details>

---

## 🔧 Setup & Configuration

<details>
<summary><strong>How do I change Sage's wake word?</strong></summary>

Edit `.env`:

```env
WAKE_WORDS=sage
```

Restart Sage after changing `.env`.

</details>

<details>
<summary><strong>How do I make Sage respond without being mentioned?</strong></summary>

Set `AUTOPILOT_MODE`:

| Mode | Behavior | API Usage |
|:-----|:---------|:----------|
| `manual` | Only responds on wake word/@mention/reply (default) | 🟢 Low |
| `reserved` | Occasionally joins relevant conversations | 🟡 Medium |
| `talkative` | Actively participates without prompts | 🔴 High |

Example:

```env
AUTOPILOT_MODE=manual
```

</details>

---

## 💬 Using Sage

<details>
<summary><strong>How do I talk to Sage?</strong></summary>

Use any of these:

1. **Wake word**: start with “Sage” (e.g., “Sage, what’s the weather?”)
2. **Mention**: tag the bot (`@Sage`)
3. **Reply**: reply to one of Sage’s messages

</details>

<details>
<summary><strong>What commands are available?</strong></summary>

See **[Commands Reference](COMMANDS.md)**. Highlights:

**Public:**

- `/ping`
- `/sage whoiswho @user`

**Admin / setup:**

- `/sage key login`, `/sage key set`
- `/sage admin trace`
- `/sage admin stats`

</details>

---

## 🔴 Troubleshooting

<details>
<summary><strong>Sage is slow to respond</strong></summary>

Possible causes:

- High-precision routing (resolving context across history)
- Large context ingestion (e.g., long files)
- Provider load

Things to try:

- Wait a few seconds (complex requests take longer)
- Ensure a BYOP key is set for higher limits / priority

</details>

---

## 🔐 Privacy & Data

<details>
<summary><strong>What data does Sage store?</strong></summary>

| Data Type | Description |
|:----------|:------------|
| **User Profiles** | LLM-generated long-term summary of a user (throttled for efficiency). |
| **Relationship Tiers** | Interaction-based tiers (e.g., “Best Friend”) with emojis. |
| **Traces** | Router `reasoningText` and related metadata to explain why Sage responded the way it did. |

For a full breakdown (tables, retention, and deletion), see **[Security &amp; Privacy](security_privacy.md)**.

</details>
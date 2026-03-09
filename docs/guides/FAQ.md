# ❓ Frequently Asked Questions

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20FAQ-2d5016?style=for-the-badge&labelColor=4a7c23" alt="FAQ" />
</p>

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

<a id="first-timer-questions"></a>

## 🌟 First-Timer Questions

<details>
<summary><strong>I'm not technical — can I still use Sage?</strong></summary>

Yes. If someone already hosts Sage for your community, start with the **[⚡ Quick Start Guide](QUICKSTART.md)**. If you need to run it yourself, **[📖 Getting Started](GETTING_STARTED.md)** walks through the full setup from source.

</details>

<details>
<summary><strong>Will this cost me money?</strong></summary>

Sage is released under the **MIT License**.

- **Software licensing:** Sage is available under `LICENSE` with MIT terms.
- **AI credits / providers:** Sage is provider-flexible when you self-host.
  - The current hosted bot uses **Bring Your Own Pollen (BYOP)** with a server key from [Pollinations.ai](https://pollinations.ai).
  - Self-hosted deployments can instead point Sage at any OpenAI-compatible provider with their own provider key/billing model.
- **Hosting:** If you self-host, you also pay your own infrastructure costs (if any).

</details>

<details>
<summary><strong>Is this safe for my Discord server?</strong></summary>

Sage is built to be transparent and controllable:

- 🔒 **You control settings** (logging, tracing, retention)
- 👁️ **Auditable operation** — traces/logging can be reviewed by operators
- ⚙️ **Privacy controls** — you can disable ingestion/logging

See **[Security &amp; Privacy](../security/SECURITY_PRIVACY.md)** for concrete details on what’s stored and how to disable it.

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

<a id="about-sage"></a>

## 📖 About Sage

<details>
<summary><strong>What is Sage?</strong></summary>

Sage is a Discord-native AI runtime built around one tool-enabled chat loop.

- 🧠 **Context-aware**: Uses recent transcript history, user profiles, channel summaries, and attachment cache data.
- 🌐 **Research-capable**: Can search the web, read pages, and pull in external sources when needed.
- 🛠️ **Action-capable**: Can perform approval-gated Discord admin actions for authorized users.

</details>

<details>
<summary><strong>Is Sage free to use?</strong></summary>

Yes. Sage is MIT-licensed. Provider costs are separate from Sage's software license; for the hosted bot's current BYOP path, that means Pollinations pricing/tiers, while self-hosted deployments can use any OpenAI-compatible provider you choose.

</details>

<details>
<summary><strong>What AI models does Sage use?</strong></summary>

Sage's main chat loop uses one runtime chat model per turn:

- **Chat turns:** `CHAT_MODEL` (starter default: `kimi`)
- **Profile updates:** `PROFILE_CHAT_MODEL` (starter default: `deepseek`)
- **Channel summaries:** `SUMMARY_MODEL` (starter default: `deepseek`)
- **Guarded search fallback:** Sage can use `gemini-search`, `perplexity-fast`, and `perplexity-reasoning`, with the order varying by search depth (`quick`, `balanced`, `deep`)

There is no route-mapped multi-agent pipeline in the current runtime.

You can change defaults in **[Configuration](../reference/CONFIGURATION.md)**.

</details>

<details>
<summary><strong>Can Sage read files?</strong></summary>

Yes. Sage ingests multiple non-image Discord attachments per message.

- Native text/code extraction first for plain text formats (`.txt`, `.md`, source files, JSON/YAML, logs, etc.), with Tika fallback when needed
- Broad document extraction through Apache Tika (for example PDF and Office documents)

Sage caches extracted non-image file content in channel attachment memory, then retrieves full text on demand. Transcript history stores lightweight cache markers, not full file bodies, so old files do not bloat every prompt.

</details>

<details>
<summary><strong>Can Sage see images?</strong></summary>

Yes. If you attach an image (or reply to one) and trigger Sage, the bot forwards it as a vision input (`image_url`) to the configured OpenAI-compatible vision path. In the current default/hosted integration, that path is Pollinations-backed.

</details>

<details>
<summary><strong>Can Sage generate or edit images?</strong></summary>

Yes.

- **Generate:** `Sage, draw a futuristic city in the rain`
- **Edit:** reply to an image: `Sage, make this more cinematic`

Under the hood, Sage runs an **image_generate tool action** (prompt refinement -> current Pollinations image endpoint) and returns the result as a **Discord attachment**.

</details>

<details>
<summary><strong>Does Sage work with voice chat?</strong></summary>

Sage has **Voice Awareness**: it can answer questions like who is in voice and how long someone has been in voice.

Ask Sage to join or leave voice in normal chat, for example `Sage, join my voice channel` or `Sage, leave voice`.

Optional: if voice transcription is enabled, Sage can transcribe in-channel audio while connected and persist **summary-only** voice session memory when it leaves voice.

</details>

---

<a id="setup-configuration"></a>

## 🔧 Setup & Configuration

<details>
<summary><strong>How do I change Sage's wake word?</strong></summary>

Edit `.env`:

```env
WAKE_WORDS_CSV=sage
```

Restart Sage after changing `.env`.

</details>

<details>
<summary><strong>How do I make Sage respond without being mentioned?</strong></summary>

Set `AUTOPILOT_MODE`:

| Mode | Behavior | API Usage |
| :--- | :--- | :--- |
| `manual` | Only responds on wake word/@mention/reply (default) | 🟢 Low |
| `reserved` | Occasionally joins relevant conversations | 🟡 Medium |
| `talkative` | Actively participates without prompts | 🔴 High |

Example:

```env
AUTOPILOT_MODE=manual
```

</details>

---

<a id="using-sage"></a>

## 💬 Using Sage

<details>
<summary><strong>How do I talk to Sage?</strong></summary>

Use any of these:

1. **Wake word**: start with “Sage” (e.g., “Sage, what’s the weather?”)
2. **Mention**: tag the bot (`@Sage`)
3. **Reply**: reply to one of Sage’s messages

</details>

<details>
<summary><strong>How do I use Sage now?</strong></summary>

Sage is chat-first:

- Mention Sage
- Reply to Sage
- Start a message with `Sage`

Hosted BYOP setup now happens through Sage's setup card buttons and modal, not through slash commands. Voice join/leave is also chat-driven.

</details>

---

<a id="troubleshooting"></a>

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

<a id="privacy-data"></a>

## 🔐 Privacy & Data

<details>
<summary><strong>What data does Sage store?</strong></summary>

| Data Type | Description |
| :--- | :--- |
| **User Profiles** | LLM-generated long-term summary of a user (throttled for efficiency). |
| **Guild Settings / Server Key** | Server-scoped Pollinations BYOP configuration stored in `GuildSettings`. |
| **Server Instructions** | Admin-authored server instructions and their archive history. |
| **Social Graph Edges** | Relationship weights and analytics-derived Dunbar labels such as `intimate`, `close`, `active`, `acquaintance`, and `distant`. |
| **Ingested Attachments** | Cached extracted text from non-image Discord attachments (per-channel). |
| **Channel Summaries** | Rolling LLM-generated summaries of channel conversations. |
| **Traces** | Agent selector `reasoningText`, route metadata, and runtime diagnostics for auditing responses. |

For a full breakdown (tables, retention, and deletion), see **[Security &amp; Privacy](../security/SECURITY_PRIVACY.md)**.

</details>

# ❓ Frequently Asked Questions

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20FAQ-2d5016?style=for-the-badge&labelColor=4a7c23" alt="FAQ" />
</p>

Common questions about Sage, setup, runtime behavior, and data handling.

---

## 🧭 Quick navigation

- [🌟 First-Timer Questions](#first-timer-questions)
- [📖 About Sage](#about-sage)
- [🔧 Setup & Configuration](#setup--configuration)
- [💬 Using Sage](#using-sage)
- [🔐 Privacy & Data](#privacy--data)

---

<a id="first-timer-questions"></a>

## 🌟 First-Timer Questions

<details>
<summary><strong>I’m not technical. Can I still use Sage?</strong></summary>

Yes. If someone else already hosts Sage for your server, start with [⚡ Quick Start](QUICKSTART.md). If you want to self-host it, [📖 Getting Started](GETTING_STARTED.md) walks through the full setup.

</details>

<details>
<summary><strong>Will this cost me money?</strong></summary>

Sage itself is MIT-licensed. Costs depend on the provider and infrastructure you choose:

- self-hosted runtime chat can point at any OpenAI-compatible provider
- the current hosted/server-key path uses Pollinations-specific BYOP
- you may also choose to run optional infrastructure such as PostgreSQL, Tika, SearXNG, Crawl4AI, Memgraph, or the local voice service

</details>

<details>
<summary><strong>Is Sage safe for a real Discord server?</strong></summary>

Sage is designed to be auditable and controllable:

- approval-gated admin and moderation actions
- configurable retention and ingestion controls
- trace and diagnostics surfaces for operators
- provider-neutral runtime configuration for self-hosting

See [🔒 Security &amp; Privacy](../security/SECURITY_PRIVACY.md) for the detailed breakdown.

</details>

---

<a id="about-sage"></a>

## 📖 About Sage

<details>
<summary><strong>What is Sage?</strong></summary>

Sage is a Discord-native AI runtime built around one durable LangGraph loop with:

- layered memory
- live research tools
- approval-gated governance
- image workflows
- optional voice tooling

</details>

<details>
<summary><strong>What models does Sage use?</strong></summary>

Sage uses explicitly configured models:

- `AI_PROVIDER_MAIN_AGENT_MODEL`
- `AI_PROVIDER_PROFILE_AGENT_MODEL`
- `AI_PROVIDER_SUMMARY_AGENT_MODEL`

`AI_PROVIDER_MODEL_PROFILES_JSON` is optional metadata for budget tuning, not a substitute for live compatibility checks. Use `npm run doctor -- --llm-ping` or `npm run ai-provider:probe` to verify Chat Completions tool-calling support.

</details>

<details>
<summary><strong>Can Sage read files and images?</strong></summary>

Yes.

- non-image files can be extracted and cached for later retrieval
- images can be used as vision inputs
- reply-based image editing is supported through the current image provider path

</details>

<details>
<summary><strong>Can Sage work with voice?</strong></summary>

Yes, in two layers:

- voice status/join/leave control
- optional local STT and summary-only voice memory when `VOICE_*` features are enabled

</details>

---

<a id="setup--configuration"></a>

## 🔧 Setup & Configuration

<details>
<summary><strong>What is the fastest setup path?</strong></summary>

Run:

```bash
npm ci
npm run onboard
docker compose -f config/services/core/docker-compose.yml up -d db tika
npm run db:migrate
npm run dev
```

</details>

<details>
<summary><strong>Do I need a host-level provider key?</strong></summary>

Not always.

- if you want a deployment-wide fallback for the configured provider, set `AI_PROVIDER_API_KEY`
- if you want to rely on Sage's current hosted/server-key path, you can activate the guild through the setup card flow instead

</details>

<details>
<summary><strong>How do I change Sage’s wake word?</strong></summary>

Edit:

```env
WAKE_WORDS_CSV=sage
WAKE_WORD_PREFIXES_CSV=
```

Then restart Sage.

</details>

<details>
<summary><strong>How do I make Sage more or less proactive?</strong></summary>

Use `AUTOPILOT_MODE`:

- `manual`
- `reserved`
- `talkative`

</details>

---

<a id="using-sage"></a>

## 💬 Using Sage

<details>
<summary><strong>How do I talk to Sage?</strong></summary>

Use any of these:

1. start a message with `Sage`
2. mention `@Sage`
3. reply to a Sage message

</details>

<details>
<summary><strong>Are slash commands required?</strong></summary>

No. Sage is chat-first. The current UX is wake word, mention, reply, and Sage-authored buttons or modals.

</details>

<details>
<summary><strong>How do admin and moderation actions work?</strong></summary>

Ask in normal chat. Sage prepares the action, then uses approval cards and reviewer routing for higher-impact operations.

</details>

<details>
<summary><strong>Can Sage generate images?</strong></summary>

Yes. Ask directly in chat, for example:

- `Sage, draw a watercolor city at sunrise`
- reply to an image: `Sage, make this more cinematic`

</details>

---

<a id="privacy--data"></a>

## 🔐 Privacy & Data

<details>
<summary><strong>What data does Sage store?</strong></summary>

Potentially:

- user profiles
- guild settings and server-key state
- Sage Persona configuration
- channel messages
- ingested attachment text
- channel summaries
- voice session and voice summary data
- relationship edges
- compact traces and approval/task-run state

The exact stored surface depends on your configuration and which optional features you enable.

</details>

<details>
<summary><strong>Does Sage store raw voice transcripts?</strong></summary>

Not as a normal persisted feature. Live STT utterances stay in memory during the session, and Sage persists summary-only voice memory when configured to do so.

</details>

<details>
<summary><strong>Where can I read the detailed data-handling policy?</strong></summary>

See [🔒 Security &amp; Privacy](../security/SECURITY_PRIVACY.md).

</details>

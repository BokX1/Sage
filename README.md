<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Logo" />
</p>

<h1 align="center">Sage</h1>
<h3 align="center">Governed AI runtime for Discord communities</h3>

<p align="center">
  <a href="https://pollinations.ai"><img src="https://img.shields.io/badge/Built%20with-Pollinations.ai-8a2be2?style=for-the-badge&logo=data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20viewBox%3D%220%200%20124%20124%22%3E%3Ccircle%20cx%3D%2262%22%20cy%3D%2262%22%20r%3D%2262%22%20fill%3D%22%23ffffff%22/%3E%3C/svg%3E&logoColor=white&labelColor=6a0dad" alt="Built with Pollinations" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm%20Strict%201.0.0-red?style=for-the-badge" alt="License" /></a>
  <a href="https://github.com/BokX1/Sage/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BokX1/Sage/ci.yml?style=for-the-badge&label=Build" alt="CI Status" /></a>
  <img src="https://img.shields.io/badge/Version-1.0.0-green?style=for-the-badge" alt="Version" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Discord.js-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
</p>

<p align="center">
  <strong>Sage is a memory-rich, policy-governed AI companion that helps Discord communities make better decisions with less noise.</strong>
</p>

> [!IMPORTANT]
> Sage is source-available under PolyForm Strict 1.0.0. You may run/use Sage for noncommercial purposes only. Redistribution, modification, and derivative works are not allowed under the public license. Commercial/business use requires a separate written license (Ahazihak03@gmail.com). See LICENSE and COPYRIGHT.

<p align="center">
  <strong>🎮 <a href="docs/guides/QUICKSTART.md">I just want to run the bot</a></strong> · <strong>💻 <a href="#developer-quick-start">I'm a developer</a></strong>
</p>

<p align="center">
  <sub>Not another slash-command wrapper: Sage combines community memory, governed tooling, and rollout guardrails.</sub>
</p>

---

## 🧭 Quick Navigation

- [🎯 What is Sage?](#what-is-sage)
- [💎 What Makes Sage Different](#what-makes-sage-different)
- [⚡ 30-Second Snapshot](#30-second-snapshot)
- [🎯 Real Community Use Cases](#real-community-use-cases)
- [🚀 Getting Started](#getting-started)
- [💻 Developer Quick Start](#developer-quick-start)
- [📚 Documentation](#documentation)
- [💚 Why Teams Choose Sage](#why-teams-choose-sage)

---

<a id="what-is-sage"></a>

## 🎯 What Is Sage?

Sage is a Discord-native AI runtime built for real communities—where context matters, decisions have consequences, and “just chat” isn’t enough.

It’s designed to feel like a helpful in-server teammate, while still giving operators the controls they need:

- 🛡️ **Governed runtime:** canary rollout + tenant policy + replay/release gates so changes ship safely.
- 🧠 **Community memory stack:** uses user/channel memory, summaries, and attachment context to keep continuity.
- 🔍 **Verified tooling loop:** route-scoped tools with policy/risk controls, plus critic-driven revision before replies.
- 🔀 **Route-aware execution:** selects `chat`, `coding`, `search`, or `creative` behavior with model policy.
- 🧰 **Operator flexibility:** BYOP (bring your own provider) and local-first tool stack options, with hosted fallback.

**Best fit:** engineering communities, research teams, creator communities, and high-signal servers that need reliable AI support (not vibe-only chat).

---

<a id="30-second-snapshot"></a>

## ⚡ 30-Second Snapshot

- **For server admins:** controlled rollout (canary + replay gates) reduces “bad bot updates” and regressions.
- **For operators/mods:** policy-governed tool execution + critic revision reduces risky or sloppy answers.
- **For members:** memory-aware replies keep continuity across ongoing threads, files, and repeated questions.

---

<a id="what-makes-sage-different"></a>

## 💎 What Makes Sage Different

| Pillar | What Sage does today | Why it matters |
| :--- | :--- | :--- |
| 🛡️ Governed Runtime | Canary-gated agentic path, tenant policy overrides, replay quality gate before promotion | Safer rollouts and fewer silent regressions |
| 🧠 Community Memory Stack | User memory, channel memory, summaries, attachment cache, social graph, voice analytics | Responses reflect server context instead of stateless chat |
| 🔍 Verified Tooling Loop | Route-scoped tools, deterministic risk policy, hard-gate behavior for freshness-sensitive turns, critic-driven revision | Better trust for factual and time-sensitive answers |
| 🧰 Operator Flexibility | BYOP key model, local-first tool stack options, hosted fallback path | Better control over cost, privacy posture, and uptime |

---

<a id="real-community-use-cases"></a>

## 🎯 Real Community Use Cases

If you’re evaluating Sage for your server, pick one scenario and copy/paste the prompt. These are written to surface the *governed runtime + memory + tools* loop quickly.

| If you need to… | Try this prompt in Discord | Sage helps by… | You get… |
| :--- | :--- | :--- | :--- |
| 🧑‍💻 Make a safer decision during incident pressure | `compare prisma migrate options for prod. include rollback risk + a recommended path.` | Routing to `coding`, gathering tool evidence where available, then running critic revision before replying | Clear tradeoffs and a decision you can act on |
| 📄 Turn an uploaded doc into an ops-ready plan | `use the file I uploaded. produce a rollout checklist with gates, monitoring, and rollback steps.` | Using attachment context + channel memory, then structuring an operator-ready checklist | A practical plan instead of a generic summary |
| 🧪 Reduce stale answers on time-sensitive topics | `what changed in AI model pricing this week? include the most important deltas and what to verify.` | Routing to `search`, collecting live findings, applying grounding/quality checks | Lower risk of outdated or ungrounded claims |
| 🛡️ Keep tool use safe in higher-risk turns | `before you run any tools, tell me what you'd run + why. flag anything risky.` | Enforcing route-scoped tools and deterministic risk policy; prompting for confirmation when appropriate | Safer automation without surprise side effects |
| 👥 Communicate clearly in your community’s tone | `draft an announcement for this channel about <topic>. keep it concise and match our tone.` | Blending channel context + social signals to tune phrasing and format | Messages that feel community-aware (not generic) |
| 🚦 Roll out runtime changes with less operational risk | `we're rolling out changes. propose a canary plan and what replay gates to check before promotion.` | Supporting canary policy + tenant overrides + replay-gate workflows in operations | More controlled rollouts, fewer all-or-nothing changes |

**Copy/paste starter prompts**

- `summarize what we decided in this channel this week + list open questions`
- `compare two options and recommend the safer production path`
- `use the file I uploaded earlier and turn it into a checklist`
- `before you use tools, explain what you'll do and what could go wrong`

Tip: goal-first prompts (what you need + constraints) usually work better than open-ended prompts.

<details>
<summary><strong>Version 1 (operator/admin focused)</strong></summary>

| Operator goal | Prompt | Output you should expect |
| :--- | :--- | :--- |
| Canary a change safely | `design a canary rollout for <change>. include % rollout, success metrics, and rollback criteria.` | Phased rollout plan + concrete gates |
| Validate readiness before promotion | `what should we verify in replay before promoting this release? list checks in order.` | Ordered checklist + “stop/continue” criteria |
| Reduce tool risk | `for this task, list allowed tools + disallowed tools. explain the risk tradeoffs.` | A policy lens you can copy into an ops runbook |
| Keep a weekly ops log | `summarize this week in #ops: decisions, incidents, action items, owners.` | Meeting-minutes style recap you can post |

</details>

<details>
<summary><strong>Version 2 (community/member focused)</strong></summary>

| Member goal | Prompt | Output you should expect |
| :--- | :--- | :--- |
| Catch up fast | `i was away—summarize what happened in this channel since monday. include key decisions.` | High-signal recap + next steps |
| Learn from shared docs | `summarize the file we shared and explain the recommendation in plain english.` | Accessible explanation grounded in the doc |
| Get help without re-explaining | `remember my context: i'm working on <project>. ask me only what you need.` | Fewer back-and-forth clarifiers |
| Write better messages | `rewrite this message to be clearer and calmer: <paste>` | A tone-matched rewrite |

</details>

---

<a id="high-level-architecture"></a>

## 🏛️ High-Level Architecture

<details>
<summary><strong>View diagram</strong></summary>

```mermaid
flowchart LR
    classDef user fill:#f96,stroke:#333,stroke-width:2px,color:black
    classDef bot fill:#9d9,stroke:#333,stroke-width:2px,color:black
    classDef route fill:#b9f,stroke:#333,stroke-width:2px,color:black
    classDef provider fill:#fff,stroke:#333,stroke-width:1px,stroke-dasharray: 5 5,color:black
    classDef runtime fill:#ff9,stroke:#333,stroke-width:2px,color:black

    U((User)):::user -->|"Message / reply / mention"| B[Sage Bot]:::bot
    B --> R{Agent Selector}:::route
    R --> C[Canary + Policy]:::runtime

    subgraph ContextProviders
        direction TB
        M[UserMemory]:::provider
        G[SocialGraph]:::provider
        V[VoiceAnalytics]:::provider
        S[ChannelMemory]:::provider
    end

    C -->|agentic path| X[Context Graph Executor]:::runtime
    C -->|fallback path| Y[Provider Runner]:::runtime
    X --> M
    X --> G
    X --> V
    X --> S
    Y --> M
    Y --> G
    Y --> V
    Y --> S

    M --> K[Context Builder]:::runtime
    G --> K
    V --> K
    S --> K

    K --> L[Model Resolver + LLM]:::route
    L --> T{Tool or Verify}:::runtime
    T --> Q[Critic + Revision]:::runtime
    Q --> B
    B -->|"Reply / files"| U
```

</details>
> [!NOTE]
> Chat turns always include `UserMemory` and `ChannelMemory`. `SocialGraph` and `VoiceAnalytics` are optional context enhancers.

---

<a id="capabilities-that-matter"></a>

## ✨ Capabilities That Matter

| Capability | Current behavior | Community value |
| :--- | :--- | :--- |
| 🧠 Long-term memory | Builds user and channel memory over time | Less repeated context, better continuity |
| 📄 Attachment intelligence | Ingests and caches non-image file content for lookup | Better doc-aware discussions in-channel |
| 👁️ Vision + image generation | Understands images and can generate images (and edit where supported) | Better multimodal workflows |
| 🔍 Live search + synthesis | Uses search tools and route-aware search models | More current, decision-ready answers |
| 🤖 Intent routing | Chooses route and model policy per request | Better quality across mixed workloads |
| 🛡️ Tool risk governance | Enforces tool policy and route-scoped tool access | Lower operational risk |
| 🧪 Quality control loop | Critic-driven revisions and replay-based release readiness | Higher answer consistency over time |
| 🎤 Voice awareness | Voice analytics can inform context; voice companion support can be enabled depending on deployment | Better continuity between voice and text interactions |

<p align="center">
  <sub>⚡ Powered by <a href="https://pollinations.ai">Pollinations.ai</a> for high-throughput multi-model access.</sub>
</p>

---

<a id="getting-started"></a>

## 🚀 Getting Started

### Option A: Use the public bot

1. **Invite Sage**  
[**Click here to invite Sage to your server**](https://discord.com/oauth2/authorize?client_id=1462117382398017667&scope=bot%20applications.commands&permissions=8)

2. **Activate BYOP (recommended for higher limits)**  
Run `/sage key login` to get your Pollinations key. Then run `/sage key set <your_key>` to activate Sage for the server.

> [!TIP]
> Prefer least-privilege permissions? Generate a custom invite URL in the Discord Developer Portal (see [Getting Started → Invite Bot](docs/guides/GETTING_STARTED.md#step-6-invite-sage-to-your-server)).

### Option B: Self-host from source

Follow **[📖 Getting Started](docs/guides/GETTING_STARTED.md)** for full setup (Node.js, Docker/Postgres, onboarding, and invite flow).

For local-first tooling (SearXNG/Crawl4AI/Ollama) with hosted fallback, see **[🧰 Self-Hosted Tool Stack](docs/operations/TOOL_STACK.md)**.

---

<a id="developer-quick-start"></a>

## 💻 Developer Quick Start

> [!NOTE]
> Fast path below. For full setup (including Discord app creation), use [Getting Started](docs/guides/GETTING_STARTED.md).

```bash
git clone https://github.com/BokX1/Sage.git
cd Sage
npm ci
npm run onboard
docker compose -f config/ci/docker-compose.yml up -d db tika
npm run db:migrate
npm run check
npm run dev
```

Optional local tool stack:

```bash
docker compose -f config/self-host/docker-compose.tools.yml up -d
```

Essential gates:

```bash
npm run check
npm run build
npm start
```

Advanced release gating, eval pipelines, simulation, and tuning live in:

- `docs/reference/RELEASE.md`
- `docs/operations/RUNBOOK.md`
- `docs/architecture/OVERVIEW.md`

---

<a id="configuration"></a>

## 🛠️ Configuration

Sage is optimized for community interaction out of the box.

```env
# behavior
AUTOPILOT_MODE=manual
PROFILE_UPDATE_INTERVAL=5
TRACE_ENABLED=true
```

See [Configuration Reference](docs/reference/CONFIGURATION.md) for complete settings.

---

<a id="documentation"></a>

## 📚 Documentation

| Document | Description |
| :--- | :--- |
| [📚 Documentation Hub](docs/INDEX.md) | Start here for complete navigation |
| [⚡ Quick Start](docs/guides/QUICKSTART.md) | 5-minute setup for new users |
| [📖 Getting Started](docs/guides/GETTING_STARTED.md) | Full beginner walkthrough |
| [🎮 Commands](docs/guides/COMMANDS.md) | Full slash command reference |
| [❓ FAQ](docs/guides/FAQ.md) | Common questions and answers |
| [🔧 Troubleshooting](docs/guides/TROUBLESHOOTING.md) | Error resolution guide |
| [⚙️ Configuration](docs/reference/CONFIGURATION.md) | All env vars and defaults |
| [🤖 Agentic Architecture](docs/architecture/OVERVIEW.md) | Runtime design and governance |
| [🔍 Search Architecture](docs/architecture/SEARCH.md) | Search behavior and tool flow |
| [🧠 Memory Architecture](docs/architecture/MEMORY.md) | Memory model and context assembly |
| [🔒 Security & Privacy](docs/security/SECURITY_PRIVACY.md) | Data handling and privacy controls |
| [🧰 Self-Hosted Tool Stack](docs/operations/TOOL_STACK.md) | Local SearXNG/Crawl4AI/Ollama stack |
| [📋 Operations Runbook](docs/operations/RUNBOOK.md) | Operational and release procedures |

---

<a id="why-teams-choose-sage"></a>

## 💚 Why Teams Choose Sage

| Category | Typical bot experience | Sage experience |
| :--- | :--- | :--- |
| Context | Mostly stateless chat turns | Memory-aware replies grounded in community context |
| Reliability | Best-effort outputs | Critic loop, tool policy, and governed fallbacks |
| Freshness | Often generic or stale summaries | Route-aware search and source-oriented synthesis |
| Operations | Limited rollout controls | Canary policy, tenant policy, replay-based readiness |
| Team fit | One-size-fits-all behavior | Socially and contextually adaptive responses |

[Learn more about Sage’s runtime architecture →](docs/architecture/OVERVIEW.md)

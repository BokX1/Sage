# 🤖 Agentic Architecture Overview

How Sage processes every message — from raw Discord event to verified, tool-augmented reply.

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Architecture-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Architecture" />
</p>

---

## 🧭 Quick Navigation

- [Design Philosophy](#design-philosophy)
- [Core Components](#core-components)
- [Runtime Overview](#runtime-overview)
- [Tool-Oriented Architecture](#tool-oriented-architecture)
- [Registered Tools](#registered-tools)
- [Reliability Model](#reliability-model)
- [Key Source Files](#key-source-files)
- [Related Documentation](#related-documentation)

---

<a id="design-philosophy"></a>

## 💡 Design Philosophy

Sage is a **single-agent runtime** — not a multi-agent graph. Every message flows through one unified execution path (`runChatTurn`) with an iterative tool loop that fetches context, executes actions, and synthesizes a final reply.

**Why single-agent?**

- **Predictability:** One canonical execution path means deterministic behavior and simpler debugging.
- **Clean context:** Memory, social graph, voice analytics, and file content are fetched **on demand** through tools — not blindly pre-injected into every prompt.
- **Composability:** New capabilities are added as tools, not as new agents or router branches.

---

<a id="core-components"></a>

## 🏗️ Core Components

```mermaid
flowchart TD
    classDef discord fill:#5865f2,stroke:#333,color:white
    classDef runtime fill:#9ECE6A,stroke:#333,color:black
    classDef memory fill:#7AA2F7,stroke:#333,color:black
    classDef tools fill:#BB9AF7,stroke:#333,color:black
    classDef llm fill:#E0AF68,stroke:#333,color:black

    subgraph Discord["Discord Layer"]
        ME[Message Events]:::discord
        VE[Voice Events]:::discord
        SC[Slash Commands]:::discord
    end

    subgraph Runtime["Single-Agent Runtime"]
        CE[Chat Engine]:::runtime
        RT[runChatTurn]:::runtime
        CB[Context Builder]:::runtime
        BG[Context Budgeter]:::runtime
        PC[Prompt Composer]:::runtime
        TL[Tool Call Loop]:::runtime
    end

    subgraph Memory["Memory Layer"]
        PG[(PostgreSQL)]:::memory
        RB[Ring Buffer]:::memory
        MG[(Memgraph)]:::memory
    end

    subgraph Tools["Tool Registry"]
        MT[Memory Tools]:::tools
        ST[Search Tools]:::tools
        DT[Developer Tools]:::tools
        AT[Admin Tools]:::tools
        GT[Generation Tools]:::tools
    end

    ME --> CE --> RT
    VE --> CE
    SC --> CE
    RT --> CB --> BG
    BG --> PC --> LLM[LLM Provider]:::llm
    LLM --> TL
    TL --> MT & ST & DT & AT & GT
    MT --> PG & MG
    TL -->|"Final Answer"| ME
```

| Component | File | Purpose |
|:---|:---|:---|
| **Chat Engine** | `src/features/chat/chat-engine.ts` | Entry point — receives Discord events, orchestrates `runChatTurn` |
| **Agent Runtime** | `src/features/agent-runtime/agentRuntime.ts` | The single `runChatTurn` function: model resolution, prompt assembly, tool loop, trace persistence |
| **Context Builder** | `src/features/agent-runtime/contextBuilder.ts` | Composes prioritized message blocks (system prompt, runtime instructions, optional server instructions/voice context, transcript, reply context) |
| **Context Budgeter** | `src/features/agent-runtime/contextBudgeter.ts` | Token-aware block sizing with configurable per-block budgets |
| **Prompt Composer** | `src/features/agent-runtime/promptComposer.ts` | Assembles the final system prompt with personality, capabilities, and tool protocol |
| **Tool Call Loop** | `src/features/agent-runtime/toolCallLoop.ts` | Iterative tool execution with bounded rounds, parallel read-only optimization, and timeout enforcement |
| **Tool Registry** | `src/features/agent-runtime/toolRegistry.ts` | Zod-validated tool definitions with OpenAI-compatible spec generation |
| **Default Tools** | `src/features/agent-runtime/defaultTools.ts` | All 14 built-in top-level tool definitions |

---

<a id="runtime-overview"></a>

## ⚡ Runtime Overview

```mermaid
sequenceDiagram
    participant U as User
    participant CE as Chat Engine
    participant RT as runChatTurn
    participant LLM as LLM Provider
    participant TL as Tool Loop
    participant T as Tools

    U->>CE: Discord message
    CE->>RT: Invoke with context params
    RT->>RT: Resolve model (CHAT_MODEL → kimi fallback)
    RT->>RT: Build context (system prompt + runtime blocks + transcript + current turn)
    RT->>RT: Budget tokens across blocks
    RT->>LLM: Send prompt + tool specs
    LLM->>RT: Response (text or tool calls)

    alt Tool calls detected
        RT->>TL: Enter iterative tool loop
        loop Up to AGENTIC_TOOL_MAX_ROUNDS
            TL->>T: Execute validated tool calls
            T->>TL: Tool results
            TL->>LLM: Feed results back
            LLM->>TL: Next response
        end
        TL->>RT: Final plain-text answer + attachments
    end

    RT->>RT: Persist trace (if TRACE_ENABLED)
    RT->>CE: Return reply + files
    CE->>U: Discord reply
```

**Key runtime rules:**

1. **Single-agent, single-model** — no route-mapped model selection.
2. **Tool-driven context** — memory, social graph, voice data are fetched through tools, not pre-injected.
3. **Bounded tool loop** — configurable max rounds (`AGENTIC_TOOL_MAX_ROUNDS`) and calls per round (`AGENTIC_TOOL_MAX_CALLS_PER_ROUND`).
4. **Parallel read-only optimization** — read-only tools can execute concurrently within a round.
5. **Trace persistence** — every turn optionally persists route, budget, tool, and quality metadata.

---

<a id="tool-oriented-architecture"></a>

## 🔧 Tool-Oriented Architecture

Tools are the primary extension mechanism. Each tool is defined with:

- A **Zod schema** for input validation
- An **`execute` function** for async execution
- **Metadata** (`readOnly`, `readOnlyPredicate`, `access`) for parallelization and permission control

```typescript
interface ToolDefinition<TArgs> {
  name: string;
  description: string;
  schema: z.ZodType<TArgs>;
  metadata?: {
    readOnly?: boolean;
    readOnlyPredicate?: (args: unknown, ctx: ToolExecutionContext) => boolean;
    access?: 'public' | 'admin';
  };
  execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<unknown>;
}
```

The tool protocol is communicated to the LLM via a structured instruction block, and tool calls are parsed from the model's JSON output.

---

<a id="registered-tools"></a>

## 🧰 Registered Tools (14 Total)

> [!NOTE]
> The runtime currently registers 14 top-level tools. The website/demo may show a larger capability count because it also lists routed Discord actions individually.

### 🧠 Discord Domain Tools (4 tools)

| Tool | Description | Access |
|:---|:---|:---|
| `discord_context` | Profiles, channel summaries, server-instructions reads, and social/voice analytics | Public |
| `discord_messages` | Exact message history, Discord-native delivery, polls, threads, and reactions | Public |
| `discord_files` | Attachment discovery, paged attachment reads, and attachment resend flows | Public |
| `discord_admin` | Admin instruction writes, moderation, channel/role/member admin actions, invite URLs, and raw Discord API fallback | Public (some actions Admin) |

### 🌐 Search & Research (3 tools)

| Tool | Description | Access |
|:---|:---|:---|
| `web` | Unified web tool (actions): `search`, `read`, `read.page`, `extract`, `research` | Public |
| `wikipedia_search` | Wikipedia article lookup | Public |
| `stack_overflow_search` | Stack Overflow Q&A search | Public |

### 💻 Developer (3 tools)

| Tool | Description | Access |
|:---|:---|:---|
| `github` | Unified GitHub tool (actions): repo metadata, code search, file reads (paged/bulk), issues/PRs, commits | Public |
| `npm_info` | npm package metadata lookup | Public |
| `workflow` | Composable workflow tool that chains common multi-hop operations into one call | Public |

### 🎨 Generation (1 tool)

| Tool | Description | Access |
|:---|:---|:---|
| `image_generate` | Generate/edit images via Pollinations | Public |

### 🛡️ Admin & Discord (via routed Discord actions)

Admin-only capabilities are exposed on `discord_admin`:

- `update_server_instructions` (approval-gated)
- `submit_moderation` (approval-gated)
- `api` (admin-only; guild-scoped; `GET` executes immediately, non-`GET` requires approval)
- Typed REST write wrappers (approval-gated): `edit_message`, `delete_message`, `pin_message`, `unpin_message`, `create_channel`, `edit_channel`, `create_role`, `edit_role`, `delete_role`, `add_member_role`, `remove_member_role`

Approval UX:

- Sage posts a requester-facing status message per queued admin action (includes the `Action ID`).
- When an action resolves (approve/reject/execute/fail/expire), Sage edits that status message with the outcome.
- Resolved approval cards auto-delete after ~60 seconds to avoid channel clutter (including after restarts via DB-backed cleanup).

Read-only helpers are also exposed across the routed Discord tools:

- `discord_admin.get_invite_url` (builds a bot invite URL using `DISCORD_APP_ID`)
- `discord_messages.search_with_context` (one-shot match + surrounding messages)
- `discord_messages.search_guild` (guild-wide search; not available in Autopilot)
- `discord_messages.get_user_timeline` (recent activity for a user; not available in Autopilot)
- `discord_files.read_attachment` (paged read of ingested attachment text)
- `discord_context.get_top_relationships` (top social-graph edges for a time window)

### ⚙️ System (3 tools)

| Tool | Description | Access |
|:---|:---|:---|
| `system_time` | Get current date/time with timezone offset | Public |
| `system_tool_stats` | Inspect in-process tool telemetry (latency/caching/failures; in-memory only) | Public |
| `system_plan` | Internal reasoning scratchpad | Public |

---

<a id="reliability-model"></a>

## 🛡️ Reliability Model

| Layer | Mechanism |
|:---|:---|
| **Tool validation** | Zod schema validation + size limits before execution |
| **Bounded execution** | Max rounds, calls per round, and per-tool timeout |
| **Error classification** | Execution-stage kind (`validation`/`execution`/`timeout`) plus actionable categories (HTTP status, rate limit, network error, etc.) surfaced to the LLM |
| **Model health tracking** | Rolling success/failure scores per model with degraded-mode signaling |
| **Trace persistence** | Route, budget, tool, and quality metadata stored per turn |
| **Build/test gates** | `check:trust` runs lint + typecheck + test audit + shuffled test validation |

---

<a id="key-source-files"></a>

## 📂 Key Source Files

```text
src/
├── app/                        # Bootstrap, Discord event wiring, lifecycle hooks
├── features/
│   ├── agent-runtime/          # runChatTurn, tool loop, prompt/context assembly
│   ├── chat/                   # Chat orchestration and rate limiting
│   ├── memory/                 # Profiles and memory update flows
│   ├── summary/                # Channel summarization and compaction
│   ├── social-graph/           # Query/migration/setup logic and analytics
│   ├── voice/                  # Voice presence, sessions, analytics
│   └── ...                     # Awareness, settings, ingest, embeddings, admin
├── platform/                   # Discord, DB, LLM, config, logging, security adapters
├── shared/                     # Pure cross-cutting helpers and error utilities
└── cli/                        # Operational entrypoints and diagnostics
```

---

<a id="related-documentation"></a>

## 🔗 Related Documentation

- [🔀 Runtime Pipeline](PIPELINE.md) — Detailed message flow through the agent loop
- [🔍 Search Architecture](SEARCH.md) — SAG flow, search modes, tool providers
- [🧠 Memory System](MEMORY.md) — How Sage stores, summarizes, and injects memory
- [💾 Database Schema](DATABASE.md) — All PostgreSQL tables and relationships
- [🕸️ Social Graph](SOCIAL_GRAPH.md) — GNN pipeline and Memgraph integration
- [🎤 Voice System](VOICE.md) — Voice awareness and companion
- [⚙️ Configuration](../reference/CONFIGURATION.md) — All environment variables

<p align="right"><a href="#top">⬆️ Back to top</a></p>

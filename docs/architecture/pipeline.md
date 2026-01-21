# Sage Runtime Pipeline (Routing + Orchestration)

This document explains how Sage routes incoming messages, builds context, and executes LLM calls. It reflects the current implementation in `src/core/agentRuntime` and `src/core/orchestration`.

## 1) High-level flow

```
Discord message
  ├─ ingestEvent (log + relationship updates)
  ├─ generateChatReply
  │   ├─ runChatTurn
  │   │   ├─ voice fast-path (simple voice queries)
  │   │   ├─ router → experts → trace start
  │   │   ├─ context builder
  │   │   ├─ LLM call (+ optional tool loop)
  │   │   └─ trace end
  │   └─ profile updater (async)
  └─ channel summary scheduler (async)
```

## 2) Router classification (D9)

**File:** `src/core/orchestration/router.ts`

The router uses deterministic regex heuristics to pick a route and a set of experts:

| Route | When it triggers | Experts | Temperature |
| --- | --- | --- | --- |
| `summarize` | “summarize / recap / what happened” | Summarizer, Memory | 0.3 |
| `voice_analytics` | “who’s in voice / how long in voice” | VoiceAnalytics, Memory | 0.5 |
| `social_graph` | “relationship / social graph / who knows whom” | SocialGraph, Memory | 0.5 |
| `memory` | “what do you know about me” | Memory | 0.6 |
| `admin` | Slash command context or “admin/config” | SocialGraph, VoiceAnalytics, Memory | 0.4 |
| `qa` | Default | Memory | 0.8 |

## 3) Experts (cheap DB lookups)

**File:** `src/core/orchestration/runExperts.ts`

Experts run **only DB or cache lookups**, no LLM calls:
- **Memory** → user profile summary
- **Summarizer** → latest rolling summary
- **VoiceAnalytics** → voice presence + time
- **SocialGraph** → relationship edges

Expert packets are injected into the context as system messages.

## 4) Context building

**File:** `src/core/agentRuntime/contextBuilder.ts`

The context builder composes a single system message with:
- core system prompt + user profile
- channel profile + rolling summary
- relationship hints
- expert packets
- transcript block
- optional reply/context hints

It uses `contextBudgeter` to respect token budgets in `src/config.ts`.

## 5) LLM call + tools

**File:** `src/core/agentRuntime/agentRuntime.ts`

- Provider: **Pollinations** only (`LLM_PROVIDER=pollinations`).
- The router’s temperature is passed to `client.chat`.
- If `allowTools` is true, Sage exposes a **native** `google_search` tool definition to the LLM.
- A separate **custom tool loop** exists, but **no tools are registered by default** (see `globalToolRegistry`).

## 6) Tracing

**File:** `src/core/trace/agentTraceRepo.ts`

When `TRACE_ENABLED=true`, Sage persists:
- router decision + experts (trace start)
- tool metadata + final reply (trace end)

Trace data is stored in the `AgentTrace` table and surfaced via `/sage admin trace`.

## 7) Voice fast-path

Before routing, Sage answers simple voice queries without invoking the LLM:
- “who is in voice”
- “how long in voice today”

This uses `src/core/voice/voiceQueries.ts` to respond quickly when possible.

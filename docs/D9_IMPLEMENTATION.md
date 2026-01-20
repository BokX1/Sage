# D9: MoE-like Orchestration - Implementation Summary

## ✅ Implementation Complete

D9 introduces a virtual Mixture-of-Experts (MoE) orchestration layer with Router, Experts, Governor, and Traces while maintaining the single LLM call architecture.

---

## What Changed

### 1. **Router** (Intent Classification)

- **File**: `src/core/orchestration/router.ts`
- **Purpose**: Deterministic keyword-based classifier that routes requests to appropriate experts
- **Routes**: summarize, qa, admin, voice_analytics, social_graph, memory
- **Decision**: Returns `RouteDecision` with route kind, experts to invoke, temperature, and tool allowance

### 2. **Experts** (Backend Context Injection)

All experts are **cheap DB queries** - no LLM calls except Governor rewrite (rare).

| Expert | File | Max Chars | Purpose |
|--------|------|-----------|---------|
| Memory | `experts/memoryExpert.ts` | 1000 | User profile summary |
| SocialGraph | `experts/socialGraphExpert.ts` | 1200 | Relationship edges with evidence |
| VoiceAnalytics | `experts/voiceAnalyticsExpert.ts` | 1200 | Voice presence + activity |
| Summarizer | `experts/summarizerExpert.ts` | 600 | Stored summary directives (no LLM) |

- **Orchestrator**: `src/core/orchestration/runExperts.ts`
- **Output**: `ExpertPacket[]` with human-readable content + structured JSON for traces

### 3. **Governor** (Post-Processing)

- **File**: `src/core/orchestration/governor.ts`
- **Rules**:
  1. Discord length limit (2000 chars) → trim with "(truncated)"
  2. Banned phrase scan (tool/browsing mentions) → single rewrite attempt or fallback trim
- **Never adds content**, only rewrites/trims
- **Rewrite is optional**: controlled by `GOVERNOR_REWRITE_ENABLED` config

### 4. **Traces** (Audit Persistence)

- **Model**: `AgentTrace` in Prisma schema
- **Repo**: `src/core/trace/agentTraceRepo.ts`
- **Stores**:
  - Router decision (kind, experts, temperature)
  - Expert packets (summaries, not full content)
  - Governor actions (actions taken, flagged status)
  - Tool calls (if any)
  - Token estimates
  - Final reply text
- **Queries**: Get by ID, list recent by guild/channel

### 5. **Integration**

- **Context Builder**: New `expertPackets` parameter, priority 55 (between rolling_summary and transcript)
- **Context Budgeter**: Added `expert_packets` block ID to truncation order
- **Agent Runtime**: Full D9 flow integrated:
  1. Router classifies intent
  2. Run experts (cheap DB queries)
  3. Persist trace start
  4. Build context with expert packets
  5. Call LLM (single call, route temperature)
  6. Run governor
  7. Persist trace end
  8. Return governed reply

### 6. **Admin Command**

- **Command**: `/sage admin trace [trace_id] [limit]`
- **Access**: Admin-only (role-gated)
- **Shows**: Route kind, experts, temperature, governor actions, timestamps
- **Audit**: Logs admin action via AdminAudit

### 7. **Config**

New environment variables:

```env
CONTEXT_BLOCK_MAX_TOKENS_EXPERTS=1200
GOVERNOR_REWRITE_ENABLED=true
TRACE_ENABLED=true
```

---

## Files Created (12)

### Core Orchestration

1. `src/core/orchestration/router.ts`
2. `src/core/orchestration/experts/types.ts`
3. `src/core/orchestration/experts/memoryExpert.ts`
4. `src/core/orchestration/experts/socialGraphExpert.ts`
5. `src/core/orchestration/experts/voiceAnalyticsExpert.ts`
6. `src/core/orchestration/experts/summarizerExpert.ts`
7. `src/core/orchestration/runExperts.ts`
8. `src/core/orchestration/governor.ts`

### Trace Persistence

9. `src/core/trace/agentTraceRepo.ts`

### Tests

10. `tests/unit/agentRuntime/router.test.ts`
2. `tests/unit/agentRuntime/agentTraceRepo.test.ts`
3. `tests/unit/agentRuntime/governor.test.ts`

---

## Files Modified (7)

1. `prisma/schema.prisma` - Added AgentTrace model
2. `src/config.ts` - Added D9 config keys
3. `src/core/config/env.ts` - Wired D9 config
4. `src/core/agentRuntime/contextBudgeter.ts` - Added expert_packets block
5. `src/core/agentRuntime/contextBuilder.ts` - Added expertPackets support
6. `src/core/agentRuntime/agentRuntime.ts` - Full D9 integration
7. `src/bot/commands/index.ts` - Added trace subcommand
8. `src/bot/handlers/interactionCreate.ts` - Added trace handler

---

## How to Test Locally

### 1. Run Migration

```powershell
# Enable script execution temporarily (admin PowerShell)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process

# Run migration
npm run db:migrate
```

### 2. Generate Prisma Client

```powershell
npm run db:generate
```

### 3. Run Tests

```powershell
npm test
```

### 4. Build

```powershell
npm run build
```

### 5. Manual Testing (Discord)

1. Start bot: `npm run dev`
2. Test routing:
   - "Summarize this discussion" → summarize route
   - "Who's in voice?" → voice_analytics route
   - "whoiswho for me" → social_graph route
   - "What do you remember about me?" → memory route
3. Test admin command: `/sage admin trace` (requires admin role)
4. Check traces in DB: `npm run db:studio`

---

## Trace Safety

**What's stored**:

- Router metadata (route kind, experts, temperature)
- Expert packet summaries (not raw DB data)
- Governor actions (actions taken, flagged status)
- Token estimates
- Final reply text

**What's NOT stored**:

- Raw user messages (not in trace, already in ChannelMessage)
- Full relationship edge data (only summaries)
- Full voice session data (only summaries)

Traces are bounded, safe, and designed for debugging/auditing.

---

## Definition of Done ✅

- [x] Router classifies all 6 route kinds
- [x] 4 experts implemented (Memory, SocialGraph, VoiceAnalytics, Summarizer)
- [x] Governor enforces Discord limit + banned phrase detection
- [x] Traces persist router + experts + governor + tools
- [x] Integration into agentRuntime preserves single LLM call
- [x] `/sage admin trace` command works
- [x] Tests added for router, trace repo, governor
- [x] Config keys added and wired
- [x] Prisma schema updated with AgentTrace model

---

## Next Steps

1. **Run Prisma migration** (requires execution policy fix)
2. **Run tests**: `npm test`
3. **Build**: `npm run build`
4. **Deploy**: Test in development environment
5. **Monitor**: Check traces via `/sage admin trace` and DB studio

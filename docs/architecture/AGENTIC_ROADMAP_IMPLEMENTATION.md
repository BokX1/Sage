# Agentic Roadmap â€” Implementation Plan & Execution Guide

Last updated: 2026-02-11
Source: Architecture audit + cutting-edge research survey (2025â€“2026), reorganized for optimal execution order.

## Document Control

| Field | Value |
| :--- | :--- |
| Purpose | Single source of truth for planned phase implementation, gate state, audit evidence, and execution guidance. |
| Owner | Sage maintainers (runtime + operations). |
| Update trigger | Any phase status change, gate threshold change, or release-gate result change. |
| Review cadence | At least once per release candidate and after each major phase PR. |
| Related checks | `npm run agentic:consistency-check`, `npm run release:agentic-check` |
| Audit ref | Architecture audit (2026-02-11) benchmarking against Anthropic, Azure, LangChain, Google Cloud, and OpenAI best practices. |
| Research ref | Cutting-edge agent research survey (2025â€“2026) covering context engineering, GoT reasoning, speculative execution, confidence calibration, agentic RAG, MIRROR self-reflection, and self-evolving benchmarks. |

## Source of Truth Rules

1. This file is the single source of truth for roadmap status and operations playbook guidance.
2. `src/scripts/agentic-consistency-check.ts` is the automated enforcer for roadmap and doc/script alignment.
3. If any mismatch exists, this file plus consistency-check output are authoritative.

---

## Completed Foundation (Phases 0â€“9)

Phases 0â€“9 have been completed and are no longer tracked in this document. They established: baseline metrics, governance correctness, canary truthfulness, deterministic validators, tool policy engine, model-judge evaluation pipeline, distributed runtime state, manager-worker orchestration, rollout hardening, and cross-phase consistency auditing. All evidence is captured in the Evidence Register below.

---

## Status Summary

| Phase | Status | Priority | Notes |
| :--- | :--- | :--- | :--- |
| 0 - Foundation & Baseline | completed | P0 | Baseline metrics, governance, and initial hardening complete. |
| 1 - ReAct Adaptive Reasoning Loop | completed | P0 | ReAct-style reason-act loop integrated and validated. |
| 2 - Persistent Agent Session Memory | completed | P0 | Session memory persistence and retrieval shipped. |
| 3 - Context Engineering and Compaction Engine | completed | P1 | Context compaction and budget controls implemented. |
| 4 - Agentic RAG and Dynamic Retrieval | completed | P1 | Dynamic retrieval and retrieval quality controls landed. |
| 5 - Observability and Tracing Dashboard | completed | P1 | Trace and operational visibility foundation in place. |
| 6 - Adaptive Task Planning | completed | P1 | Planner and execution policy hardening complete. |
| 7 - Safety and Guardrail Hardening | completed | P2 | Safety policy, guards, and gating reinforcement complete. |
| 8 - Confidence Calibration and Abstention | completed | P2 | Confidence/abstention policy integrated and tuned. |
| 9 - Quality Loop Enhancements | in_progress | P2 | Active release-quality hardening and calibration pass. |
| 10 - Deferred / Frontier Follow-ons | pending | P3 | Deferred until Phase 9 completion and release hardening. |

---
## Status Semantics

| Status | Definition | Minimum evidence required |
| :--- | :--- | :--- |
| `pending` | Work not started or explicitly deferred. | Planned scope and blocking condition documented. |
| `in_progress` | Work has started and is actively changing code/docs/tests. | Active owner context plus latest verification output. |
| `completed` | Phase exit criteria met and evidence captured. | Tests/checks passed, artifacts logged, and release/gate impact documented. |

Note: keep status values restricted to `pending`, `in_progress`, or `completed`. Put additional detail (for example, deferred) in Notes.

## Current Execution Position

- Canonical next phase in sequence: **Phase 9**.
- Phase 9 is the active in-progress phase; earlier phases are completed.
- Release promotion remains blocked by replay quality threshold until quality tuning is approved.
- Phase 12 (Metacognitive Self-Improvement) is the frontier capstone â€” must be implemented after all other phases.

---

## Phase 1 â€” ReAct Adaptive Reasoning Loop

**Priority:** P0 (Critical) Â· **Audit ref:** Gap #2
**Industry sources:** Anthropic (Agent loop), Azure (ReAct pattern), OpenAI (Agentic loop)

### Problem Statement

Sage's current flow is a fixed pipeline: route â†’ context â†’ draft â†’ tool loop â†’ critic â†’ reply. The tool call loop in `toolCallLoop.ts` has a bounded 2-round limit and processes tool calls as a batch within a single draft. There is no interleaved "reason about tool results â†’ decide next action â†’ execute â†’ observe â†’ reason again" cycle.

The manager-worker pattern in `taskPlanner.ts` partially addresses this for complex queries, but it pre-plans all tasks upfront using template-based `buildTasksForRoute()` rather than adapting dynamically based on intermediate tool results.

### Goal

Transform the tool call phase from a fixed multi-shot batch into a dynamic ReAct-style inner loop where the agent reasons about each observation before deciding its next action.

### Implementation Plan

#### [MODIFY] [toolCallLoop.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/toolCallLoop.ts)

1. **Add ReAct loop configuration** to `ToolCallLoopParams`:

   ```typescript
   interface ToolCallLoopParams {
     // ... existing fields
     reactConfig?: {
       enabled: boolean;
       maxIterations: number;       // default: 6
       completionCheckModel?: string; // model used for "should I continue?" decision
       goalDescription?: string;     // injected from user query / route
     };
   }
   ```

2. **Implement ReAct inner loop** within `runToolCallLoop`:
   - After each tool execution round, instead of immediately passing results back to the main model for another batch, insert a lightweight LLM call that receives:
     - Original user goal
     - Current observations (tool results from this round)
     - Accumulated observations (from prior rounds)
     - Available tools
   - The LLM returns a structured response:

     ```json
     {
       "thought": "reasoning about what was observed",
       "action": "next_tool_call | final_answer | need_more_info",
       "tool_calls": [...],
       "final_text": "..."
     }
     ```

   - Loop continues until `action === 'final_answer'` or `maxIterations` reached.

3. **Preserve backward compatibility**: when `reactConfig.enabled === false` (default), existing bounded batch behavior is unchanged. The ReAct path activates only when explicitly enabled via tenant policy or route config.

4. **Add observation accumulator**: maintain a `ReActObservation[]` array across iterations:

   ```typescript
   interface ReActObservation {
     iteration: number;
     thought: string;
     toolName: string;
     toolArgs: unknown;
     toolResult: string;
     timestamp: string;
   }
   ```

#### [MODIFY] [agentRuntime.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentRuntime.ts)

1. Wire `reactConfig` into `runChatTurn`:
   - For `search` and `coding` routes, enable ReAct by default with `maxIterations: 6`.
   - For `chat` route, keep disabled by default (simple queries don't benefit).
   - Read `AGENTIC_REACT_ENABLED` env var as global toggle.

2. Pass accumulated `ReActObservation[]` into trace metadata for observability.

#### [MODIFY] [tenantPolicy.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/tenantPolicy.ts)

1. Add `react` section to `TenantAgenticPolicy`:

   ```typescript
   react?: {
     enabled?: boolean;
     maxIterations?: number;
   };
   ```

2. Merge into `ResolvedTenantPolicy` with guild-level overrides.

#### [MODIFY] [toolTelemetry.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/toolTelemetry.ts)

1. Add `reactIterations: number` and `reactThoughts: string[]` to `TraceToolTelemetry`.
2. Parse from `toolJson.react` in `parseTraceToolTelemetry`.

#### [NEW] [tests/unit/agentRuntime/reactLoop.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/agentRuntime/reactLoop.test.ts)

Unit tests covering:

- ReAct disabled â†’ existing behavior unchanged.
- ReAct enabled â†’ iterates through reason-act cycles.
- Max iterations respected.
- Final answer extraction.
- Observation accumulation.
- Graceful degradation on LLM failure mid-loop.

### Exit Criteria

- [ ] ReAct loop functional for `search` and `coding` routes.
- [ ] Existing `chat` route behavior unchanged (regression tests pass).
- [ ] Observations persisted in `AgentTrace.toolJson`.
- [ ] Tenant policy override works per-guild.
- [ ] `npm run check` passes.

---

## Phase 2 â€” Persistent Agent Session Memory

**Priority:** P0 (Critical) Â· **Audit ref:** Gap #1
**Industry sources:** OpenAI (Session memory), Google Cloud (Agent coordination), Anthropic (Multi-turn agents)

### Problem Statement

Sage has excellent user/channel memory (`UserProfile`, `ChannelSummary`, `RelationshipEdge`) but has **zero agent-level session state**. Each turn of `runChatTurn` is fully stateless from the agent's perspective â€” the manager-worker plan is recomputed from scratch, tool results from previous turns are unavailable, and the agent cannot reference its own prior reasoning or decisions.

### Goal

Introduce a persistent `AgentSession` entity that allows the agent to remember its plan, prior tool results, and reasoning across multiple turns of a conversation.

### Implementation Plan

#### [NEW] [src/core/agentRuntime/agentSession.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentSession.ts)

1. **Define `AgentSession` interface**:

   ```typescript
   interface AgentSession {
     id: string;
     channelId: string;
     userId: string;
     createdAt: string;
     updatedAt: string;
     expiresAt: string;          // auto-expire after 30 min inactivity
     turnCount: number;
     plan?: SessionPlan;         // persisted plan state
     toolHistory: SessionToolResult[];
     reasoningTrace: string[];   // compressed reasoning from prior turns
     metadata: Record<string, unknown>;
   }

   interface SessionPlan {
     goal: string;
     steps: SessionPlanStep[];
     currentStepIndex: number;
     status: 'active' | 'completed' | 'abandoned';
   }

   interface SessionPlanStep {
     description: string;
     status: 'pending' | 'completed' | 'failed';
     result?: string;            // compressed result summary
   }

   interface SessionToolResult {
     turnNumber: number;
     toolName: string;
     query: string;              // what was asked
     resultSummary: string;      // compressed result (not full payload)
     timestamp: string;
   }
   ```

2. **Session lifecycle functions**:
   - `getOrCreateSession(channelId, userId)` â€” retrieves active session or creates new.
   - `updateSessionAfterTurn(session, turnResult)` â€” appends tool history, updates plan state, bumps `updatedAt`.
   - `compressSessionContext(session, maxTokens)` â€” summarizes tool history and reasoning to fit within token budget.
   - `expireStaleSession(session)` â€” marks sessions older than `expiresAt` as abandoned.

#### [NEW] [src/core/agentRuntime/agentSessionRepo.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentSessionRepo.ts)

1. Database CRUD functions backed by new Prisma model.
2. Implements `upsertSession`, `getActiveSession`, `expireSessions`.
3. Graceful degradation: if table doesn't exist (pre-migration), falls back to in-memory Map with TTL.

#### [MODIFY] [prisma/schema.prisma](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/prisma/schema.prisma)

1. Add new `AgentSession` model:

   ```prisma
   model AgentSession {
     id             String   @id @default(cuid())
     channelId      String
     userId         String
     turnCount      Int      @default(0)
     planJson       Json?
     toolHistoryJson Json?
     reasoningJson  Json?
     metadataJson   Json?
     expiresAt      DateTime
     createdAt      DateTime @default(now())
     updatedAt      DateTime @updatedAt

     @@index([channelId, userId, updatedAt])
     @@index([expiresAt])
   }
   ```

#### [MODIFY] [contextBuilder.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/contextBuilder.ts)

1. Add `sessionContext?: string | null` to `BuildContextMessagesParams`.
2. Insert as a new `ContextBlock` with priority `52` (between context_packets at 55 and transcript at 50):

   ```typescript
   if (sessionContext) {
     blocks.push({
       id: 'session_memory',
       role: 'system',
       content: sessionContext,
       priority: 52,
       hardMaxTokens: config.contextBlockMaxTokensSessionMemory, // new config
       truncatable: true,
     });
   }
   ```

#### [MODIFY] [agentRuntime.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentRuntime.ts)

1. At the start of `runChatTurn`, call `getOrCreateSession(channelId, userId)`.
2. Call `compressSessionContext(session, tokenBudget)` and pass result to `buildContextMessages`.
3. After the turn completes, call `updateSessionAfterTurn(session, result)` to persist.
4. Gate behind `AGENTIC_SESSION_MEMORY_ENABLED` env var (default: `false` initially).

#### [NEW] [tests/unit/agentRuntime/agentSession.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/agentRuntime/agentSession.test.ts)

Unit tests for session lifecycle, compression, expiry, and context injection.

### Exit Criteria

- [ ] Sessions persist across turns within the same channel+user conversation.
- [ ] Session context injected into LLM prompt within token budget.
- [ ] Sessions auto-expire after 30 min of inactivity.
- [ ] Graceful degradation when DB table doesn't exist.
- [ ] `npm run check` passes.

---

## Phase 3 â€” Context Engineering and Compaction Engine

**Priority:** P1 Â· **Research ref:** Context Engineering Survey (2025â€“2026)
**Industry sources:** Anthropic (Context engineering, Compaction, Scratchpad), LangChain (Context window optimization), Galileo (Context rot prevention)
**Depends on:** Phase 1 (ReAct), Phase 2 (Session Memory)

### Problem Statement

Sage's `contextBuilder.ts` implements a priority-based block system that truncates low-priority blocks when the token budget is exceeded. However, it has no **compaction** mechanism â€” it cannot summarize older context to preserve information density. There is no **scratchpad** for the agent to store intermediate reasoning between tool calls. Long-running ReAct loops (Phase 1) and session memory (Phase 2) will rapidly exhaust the context window without intelligent compression.

Additionally, the current context system treats all tool call results equally. A web search returning 5000 tokens of results occupies the same space as a simple lookup returning 50 tokens. There is no **context editing** to replace verbose tool outputs with condensed summaries after they've been processed.

### Goal

Build a context engineering layer that maximizes information density within the LLM's attention budget through compaction, scratchpad notes, context editing, and sub-agent context isolation.

### Implementation Plan

#### [NEW] [src/core/agentRuntime/contextCompactor.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/contextCompactor.ts)

1. **`compactContext(blocks, maxTokens)`**: when total context exceeds budget, intelligently compress:

   ```typescript
   interface CompactionStrategy {
     type: 'summarize' | 'truncate' | 'drop';
     priority: number;  // blocks with lower priority get compacted first
   }

   interface CompactionResult {
     compactedBlocks: ContextBlock[];
     totalTokens: number;
     compactionLog: {
       blockId: string;
       strategy: CompactionStrategy['type'];
       originalTokens: number;
       compactedTokens: number;
     }[];
   }
   ```

2. **Living summary compaction**: for conversation transcript blocks, maintain a rolling summary that rewrites as the conversation grows. Keep the most recent 3 turns in full; summarize older turns into a compressed narrative.

3. **Tool result compaction**: after a tool result has been processed by the agent (used in reasoning), replace the full output with a condensed placeholder:

   ```typescript
   interface ToolResultPlaceholder {
     toolName: string;
     originalTokenCount: number;
     summary: string;        // LLM-generated 1-2 line summary
     keyFindings: string[];   // extracted key facts
     fullResultAvailable: boolean;  // can re-fetch if needed
   }
   ```

4. **Compaction uses the router model** (small, fast) for summarization â€” zero additional latency cost.

#### [NEW] [src/core/agentRuntime/agentScratchpad.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentScratchpad.ts)

1. **Scratchpad for agent working memory**:

   ```typescript
   interface ScratchpadEntry {
     key: string;           // e.g., 'search_findings', 'hypothesis', 'open_questions'
     content: string;
     createdAt: string;
     updatedAt: string;
     priority: 'high' | 'medium' | 'low';
   }

   interface AgentScratchpad {
     entries: ScratchpadEntry[];
     maxTokenBudget: number;
     addNote(key: string, content: string, priority?: string): void;
     getNote(key: string): string | null;
     removeNote(key: string): void;
     renderForContext(maxTokens: number): string;  // renders as structured text for LLM
   }
   ```

2. Agents can write scratchpad notes between tool calls to preserve key findings, hypotheses, and open questions outside the main context window.
3. Scratchpad is injected as a `ContextBlock` with priority `60` (high â€” agent's own notes are very relevant).

#### [MODIFY] [contextBuilder.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/contextBuilder.ts)

1. Add `compactionEnabled?: boolean` and `scratchpad?: AgentScratchpad` to `BuildContextMessagesParams`.
2. Before final assembly, run `compactContext` if total tokens exceed budget.
3. Insert scratchpad as a new block type.
4. Add `contextEditingEnabled?: boolean` â€” when true, tool results from earlier iterations are auto-replaced with placeholders.

#### [MODIFY] [toolCallLoop.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/toolCallLoop.ts)

1. After each ReAct iteration (Phase 1), pass previous tool results through `compactToolResult` to replace with summaries.
2. Allow the agent's reasoning step to write scratchpad notes (parsed from structured output).

#### [NEW] [tests/unit/agentRuntime/contextCompactor.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/agentRuntime/contextCompactor.test.ts)

Tests for compaction strategies, living summary, tool result replacement, scratchpad lifecycle, and token budget adherence.

### Exit Criteria

- [ ] Context compaction activates when token budget is exceeded.
- [ ] Living summary compresses older transcript turns.
- [ ] Tool results replaced with summaries after processing.
- [ ] Scratchpad notes persisted across ReAct iterations.
- [ ] Context stays within token budget even for long-running sessions.
- [ ] `npm run check` passes.

---

## Phase 4 â€” Agentic RAG and Dynamic Retrieval

**Priority:** P1 Â· **Research ref:** Agentic RAG Survey (2025â€“2026)
**Industry sources:** W&B (Agentic RAG), zBrain (Dynamic retrieval), Anthropic (Retrieval-augmented agents)
**Depends on:** Phase 1 (ReAct), Phase 3 (Context Engineering)

### Problem Statement

Sage's search agents perform **single-shot retrieval** â€” the `web_search` tool is called once with the user's query, and the results are passed directly to the LLM. There is no assessment of retrieval sufficiency, no query reformulation when results are poor, and no iterative refinement. When the first search returns irrelevant or insufficient results, the agent either halluccinates to fill gaps or produces a thin response.

Additionally, there is no **hybrid retrieval** strategy. All searches go through the same `web_search` tool. For different query types (factual lookup vs. comparison vs. how-to), different retrieval strategies would be more effective.

### Goal

Transform Sage's retrieval from single-shot to agentic iterative retrieval with sufficiency assessment, query reformulation, and adaptive source selection.

### Implementation Plan

#### [NEW] [src/core/agentRuntime/agenticRetrieval.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agenticRetrieval.ts)

1. **Retrieval sufficiency assessment**:

   ```typescript
   interface RetrievalAssessment {
     isSufficient: boolean;
     coverage: number;          // 0.0â€“1.0, how much of the query is answered
     gaps: string[];            // specific aspects not covered
     suggestedReformulations: string[];  // alternative queries to try
     sourcesDiverse: boolean;   // are results from multiple domains?
   }
   ```

2. **`assessRetrievalSufficiency(query, results)`**: lightweight LLM call that evaluates whether the retrieved results adequately cover the user's question. Returns gaps and suggested reformulations.

3. **Iterative retrieval loop**:

   ```typescript
   interface AgenticRetrievalConfig {
     maxIterations: number;      // default: 3
     sufficiencyThreshold: number; // default: 0.7
     reformulationStrategy: 'expand' | 'narrow' | 'rephrase' | 'decompose';
   }

   async function agenticRetrieve(
     query: string,
     config: AgenticRetrievalConfig,
     ctx: ToolExecutionContext
   ): Promise<AgenticRetrievalResult> {
     // 1. Initial retrieval
     // 2. Assess sufficiency
     // 3. If insufficient, reformulate query based on gaps
     // 4. Retrieve again with reformulated query
     // 5. Merge results, reassess
     // 6. Repeat until sufficient or maxIterations reached
   }
   ```

4. **Query decomposition for complex queries**: break multi-part questions into sub-queries and retrieve for each independently, then merge results.

#### [NEW] [src/core/agentRuntime/retrievalStrategy.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/retrievalStrategy.ts)

1. **Adaptive source selection**:

   ```typescript
   type RetrievalSource = 'web_search' | 'github_lookup' | 'npm_lookup' | 'wikipedia';

   interface RetrievalPlan {
     sources: { source: RetrievalSource; query: string; priority: number }[];
     strategy: 'sequential' | 'parallel' | 'fallback';
   }

   function planRetrieval(query: string, routeKind: string, context: string): RetrievalPlan;
   ```

2. **Route-aware retrieval**: `coding` queries prioritize GitHub/npm sources; `search` queries prioritize web search; factual queries try Wikipedia first.

3. **Parallel retrieval**: fire multiple sources simultaneously when the query is broad, merge and deduplicate results.

#### [MODIFY] [toolCallLoop.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/toolCallLoop.ts)

1. When a `web_search` tool call returns results, optionally run `assessRetrievalSufficiency`.
2. If insufficient and within iteration budget, automatically trigger a follow-up search with reformulated query.
3. Merge results and provide the combined set to the agent.

#### [MODIFY] [defaultTools.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/defaultTools.ts)

1. Add `agentic_search` meta-tool that wraps the iterative retrieval loop:
   - Accepts the original query and search mode.
   - Returns merged, deduplicated results with sufficiency assessment.
   - Falls back to single `web_search` if agentic retrieval is disabled.

#### [MODIFY] [tenantPolicy.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/tenantPolicy.ts)

1. Add `retrieval` section to `TenantAgenticPolicy`:

   ```typescript
   retrieval?: {
     agenticEnabled?: boolean;
     maxIterations?: number;
     sufficiencyThreshold?: number;
   };
   ```

#### [NEW] [tests/unit/agentRuntime/agenticRetrieval.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/agentRuntime/agenticRetrieval.test.ts)

Tests for sufficiency assessment, query reformulation, iterative retrieval, source selection, and result merging.

### Exit Criteria

- [ ] Retrieval sufficiency assessed after initial search results.
- [ ] Query reformulation triggers when results are insufficient.
- [ ] Iterative retrieval bounded by `maxIterations`.
- [ ] Route-aware source selection active for different query types.
- [ ] Falls back gracefully to single-shot retrieval when disabled.
- [ ] `npm run check` passes.

---

## Phase 5 â€” Observability and Tracing Dashboard

**Priority:** P1 Â· **Audit ref:** Gap #5
**Industry sources:** LangChain (Tracing as #1 must-have), Azure (Agent monitoring)
**Depends on:** Phase 1 (ReAct) â€” to trace ReAct iterations

### Problem Statement

While Sage has excellent trace persistence (`AgentTrace`, `AgentRun` tables, `agent-trace-repo.ts`) and replay evaluation (`replayHarness.ts`), there is no trace visualization, no real-time monitoring, no cost tracking, no latency distribution tracking, and no anomaly detection. The replay harness only produces aggregate scores, not per-trace drill-down. Operators cannot debug agent behavior without directly querying the database.

### Goal

Provide production-grade visibility into agent behavior through both Discord commands and structured reporting.

### Implementation Plan

#### [NEW] [src/core/agentRuntime/traceInspector.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/traceInspector.ts)

1. **`inspectTrace(traceId)`**: fetches `AgentTrace` + `AgentRun` rows, returns structured summary:

   ```typescript
   interface TraceInspection {
     traceId: string;
     routeKind: string;
     createdAt: Date;
     latencyMs: number;
     tokenUsage: { input: number; output: number; estimated_cost_usd: number };
     toolCalls: { name: string; success: boolean; latencyMs: number }[];
     criticAssessments: { score: number; verdict: string; issues: string[] }[];
     reactIterations?: number;
     qualityScore: number;
     riskFlags: string[];
     replyPreview: string;  // first 200 chars
   }
   ```

2. **`generateDashboardReport(params)`**: aggregates recent traces into a report:

   ```typescript
   interface DashboardReport {
     period: { start: Date; end: Date };
     totalTraces: number;
     byRoute: Record<string, {
       count: number;
       avgLatencyMs: number;
       avgQualityScore: number;
       toolCallCount: number;
       toolSuccessRate: number;
       criticHitRate: number;
       estimatedCostUsd: number;
     }>;
     topErrors: { message: string; count: number; lastSeen: Date }[];
     anomalies: { type: string; description: string; severity: 'info' | 'warning' | 'critical' }[];
     trends: {
       qualityTrend: 'improving' | 'stable' | 'degrading';
       latencyTrend: 'improving' | 'stable' | 'degrading';
       costTrend: 'increasing' | 'stable' | 'decreasing';
     };
   }
   ```

3. **`detectAnomalies(traces)`**: flags unusual patterns:
   - Sudden quality score drops (>15% below rolling average).
   - Latency spikes (>2Ïƒ above mean).
   - Tool failure rate exceeding threshold.
   - Critic loop hitting max iterations frequently.

#### [MODIFY] [replayHarness.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/replayHarness.ts)

1. Add per-route independent thresholds to `ReplayEvaluationReport`:

   ```typescript
   routeThresholds: Record<string, {
     minAvgScore: number;
     maxFailureRate: number;
     pass: boolean;
   }>;
   ```

2. Add latency SLO tracking:

   ```typescript
   latency: {
     p50Ms: number;
     p95Ms: number;
     p99Ms: number;
     sloBreaches: number;  // traces exceeding route SLO
   };
   ```

#### [MODIFY] [outcomeScorer.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/outcomeScorer.ts)

1. Add cost estimation to `OutcomeScore`:

   ```typescript
   estimatedCostUsd?: number;
   inputTokens?: number;
   outputTokens?: number;
   ```

2. Parse token counts from `budgetJson` and estimate cost using model-specific rates.

#### [NEW] [Discord admin commands] â€” `/admin trace <traceId>` and `/admin dashboard`

1. `/admin trace <traceId>`: calls `inspectTrace()`, formats as Discord embed with fields for route, latency, tools, quality, cost.
2. `/admin dashboard`: calls `generateDashboardReport()`, formats as paginated Discord embed showing route breakdown, quality trends, cost summary.

#### [NEW] [tests/unit/agentRuntime/traceInspector.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/agentRuntime/traceInspector.test.ts)

Tests for inspection formatting, dashboard aggregation, and anomaly detection.

### Exit Criteria

- [ ] `/admin trace <id>` returns structured trace inspection.
- [ ] `/admin dashboard` returns per-route quality, latency, and cost breakdown.
- [ ] Anomaly detection flags quality degradation.
- [ ] Per-route thresholds in replay harness.
- [ ] `npm run check` passes.

---

## Phase 6 â€” Adaptive Task Planning

**Priority:** P1 Â· **Audit refs:** Gap #6 (static plans), Gap #7 (regex complexity estimation)
**Industry sources:** Anthropic (Orchestrator-workers), Azure (Planning pattern), OpenAI (Planning agents)
**Depends on:** Phase 1 (ReAct), Phase 2 (Session Memory), Phase 5 (Observability)

### Problem Statement

`taskPlanner.ts` uses `buildTasksForRoute()` to create tasks from fixed templates per route (`buildSearchTasks`, `buildCodingTasks`). The plan doesn't adapt based on actual query content, context from prior workers' findings, or quality of intermediate results. Additionally, `estimateComplexity()` uses keyword pattern matching (`/compare|versus|pros.*cons/i`) to determine if the manager-worker path should activate â€” no LLM-driven complexity estimation exists.

### Goal

Replace static template-based planning with LLM-driven dynamic task decomposition, and upgrade complexity estimation from regex to a model call.

### Implementation Plan

#### [MODIFY] [taskPlanner.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/taskPlanner.ts)

1. **Replace `estimateComplexity` with LLM call**:
   - Piggyback on the routing call in `agentSelector.ts` by adding a `complexity` field to the router's JSON output format:

     ```json
     {
       "reasoning": "...",
       "agent": "search",
       "temperature": 0.3,
       "search_mode": "complex",
       "complexity": "simple|moderate|complex|multi_step"
     }
     ```

   - The router already makes an LLM call; adding one field is zero additional latency.
   - Fall back to existing regex heuristic if `complexity` field is missing (backward compat).

2. **Replace `buildTasksForRoute` with LLM-driven decomposition**:
   - When complexity is `complex` or `multi_step`, make a lightweight LLM call with a planning prompt:

     ```text
     Given this user query: "{userText}"
     And this route: {routeKind}

     Decompose into 2-5 specific, actionable tasks.
     Each task should have: objective, type (research|verify|synthesize), and dependencies.

     Return JSON: { "tasks": [...] }
     ```

   - Parse returned tasks into `ManagerWorkerPlan` format.
   - Fall back to template-based planning if LLM decomposition fails.

3. **Add adaptive replanning after worker execution**:
   - After each worker completes, check if its results suggest the plan should change.
   - If a research worker returns "insufficient data" or low confidence, add a follow-up research task.
   - Bounded to 1 replan iteration to prevent unbounded loops.

#### [MODIFY] [agentSelector.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/orchestration/agentSelector.ts)

1. Add `complexity` field to `AGENT_SELECTOR_PROMPT` output format.
2. Parse and normalize in `parseAgentResponse`.
3. Pass through `AgentDecision` to downstream planning.

#### [MODIFY] [workerExecutor.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/workerExecutor.ts)

1. Add post-execution confidence check:
   - If worker result confidence < 0.4 and replan budget allows, emit `replan_suggested` event.
2. Pass accumulated worker results to replanning function.

#### [NEW] [tests/unit/agentRuntime/adaptivePlanner.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/agentRuntime/adaptivePlanner.test.ts)

Tests for LLM complexity estimation, dynamic decomposition, fallback to templates, and replanning.

### Exit Criteria

- [ ] Router includes `complexity` classification (no additional latency).
- [ ] Complex queries get LLM-decomposed plans instead of templates.
- [ ] Replanning triggers on low-confidence worker results.
- [ ] Template fallback works when LLM decomposition fails.
- [ ] `npm run check` passes.

---

## Phase 7 â€” Safety and Guardrail Hardening

**Priority:** P2 Â· **Audit refs:** Gap #3 (human-in-the-loop), Gap #8 (parallel guardrails), Gap #10 (error recovery)
**Industry sources:** LangChain (Human approval), Anthropic (Parallel guardrails, Error recovery), Azure (Safety operations)
**Depends on:** Phase 5 (Observability) â€” to trace safety decisions

### Problem Statement

Three related safety gaps:

1. **No human-in-the-loop checkpoints**: Tool execution proceeds automatically. Even `external_write` and `high_risk` tools are globally enabled/disabled but never pause for human confirmation.
2. **Post-hoc guardrails only**: Response validators in `responseValidators.ts` run *after* the full response is generated. Anthropic recommends running a safety classifier *in parallel* with the main generation.
3. **Limited error recovery**: `toolErrors.ts` defines only 3 error types (`validation`, `execution`, `timeout`). There's no exponential backoff, no graceful degradation when multiple tools fail, and no fallback to alternative tools.

### Implementation Plan

#### Human-in-the-Loop Checkpoints

##### [MODIFY] [toolPolicy.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/toolPolicy.ts)

1. Add `human_approval_required` decision code to `ToolPolicyDecisionCode`:

   ```typescript
   type ToolPolicyDecisionCode =
     | 'allow'
     | 'deny_blocklist'
     | 'deny_risk_class'
     | 'human_approval_required'; // NEW
   ```

2. Add `requireApproval` flag to `ToolPolicyConfig`:

   ```typescript
   interface ToolPolicyConfig {
     // ... existing fields
     requireApprovalForRisk?: ToolRiskClass[];  // e.g. ['external_write', 'high_risk']
   }
   ```

3. When tool risk matches `requireApprovalForRisk` list, return `human_approval_required` decision.

##### [NEW] [src/core/agentRuntime/humanApproval.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/humanApproval.ts)

1. **`requestHumanApproval(params)`**: emits a Discord embed with approve/reject buttons.
2. **`awaitApprovalDecision(requestId, timeoutMs)`**: waits for button interaction or timeout.
3. **Decision recording**: logs all approval decisions in `AgentTrace.toolJson` for auditability.
4. **Configurable default on timeout**: `TenantAgenticPolicy.humanApproval.defaultOnTimeout: 'approve' | 'deny'`.

##### [MODIFY] [toolCallLoop.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/toolCallLoop.ts)

1. When `evaluateToolPolicy` returns `human_approval_required`, pause the tool loop.
2. Call `requestHumanApproval` and `awaitApprovalDecision`.
3. Resume or abort based on decision.

#### Parallel Guardrails

##### [NEW] [src/core/agentRuntime/safetyClassifier.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/safetyClassifier.ts)

1. **`classifyInputSafety(userText)`**: lightweight LLM call (or rules-based) that runs concurrently with the main generation:

   ```typescript
   interface SafetyClassification {
     safe: boolean;
     category?: 'prompt_injection' | 'harmful_content' | 'policy_violation' | 'pii_exposure';
     confidence: number;
     explanation?: string;
   }
   ```

2. Uses a small, fast model (e.g., the router model) to minimize latency.
3. If classification returns `safe: false` with high confidence, the main generation is cancelled and a safe fallback response is returned.

##### [MODIFY] [agentRuntime.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentRuntime.ts)

1. Launch `classifyInputSafety(userText)` in parallel with `buildContextMessages` and the main LLM call using `Promise.allSettled`.
2. If safety check completes before main generation and returns unsafe, abort the main generation via the existing `AbortSignal` mechanism.
3. Gate behind `AGENTIC_PARALLEL_SAFETY_ENABLED` env var.

#### Enhanced Error Recovery

##### [MODIFY] [toolErrors.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/toolErrors.ts)

1. Add new error types:

   ```typescript
   type ToolErrorKind =
     | 'validation'
     | 'execution'
     | 'timeout'
     | 'rate_limited'     // NEW: API rate limit hit
     | 'unavailable'      // NEW: service temporarily unavailable
     | 'partial_failure'; // NEW: some results but incomplete
   ```

##### [MODIFY] [toolCallLoop.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/toolCallLoop.ts)

1. **Exponential backoff**: for `rate_limited` and `unavailable` errors, retry with exponential backoff (100ms â†’ 200ms â†’ 400ms) up to 3 attempts.
2. **Tool fallback chains**: define fallback mappings in tool registry:

   ```typescript
   const TOOL_FALLBACK_CHAINS: Record<string, string[]> = {
     'web_search': ['wikipedia_lookup'],
     'github_file_lookup': ['web_scrape'],
     'web_scrape': ['web_search'],
   };
   ```

   When a tool fails after retries, attempt the first available fallback.
3. **Graceful degradation**: if multiple tools fail, instead of failing the entire turn, compile partial results and inform the user about what couldn't be retrieved.
4. **User-facing error explanation**: format tool failures into a brief, helpful note in the response (e.g., "I wasn't able to access the GitHub repo, but based on available information...").

#### Tests

##### [NEW] Various test files for human approval, safety classifier, and error recovery

### Exit Criteria

- [ ] Human approval gates work for `external_write` and `high_risk` tools via Discord buttons.
- [ ] Parallel safety classifier catches prompt injection attempts.
- [ ] Exponential backoff retries for rate-limited tools.
- [ ] Tool fallback chains activate on persistent failures.
- [ ] Approval decisions logged in trace.
- [ ] `npm run check` passes.

---

## Phase 8 â€” Confidence Calibration and Abstention

**Priority:** P2 Â· **Research ref:** Confidence Calibration Survey (2025â€“2026)
**Industry sources:** arXiv HTC (Holistic Trajectory Calibration), ACL MICE (Model-Internal Confidence Estimators), SAUP (Situation-Awareness Uncertainty Propagation)
**Depends on:** Phase 7 (Safety) â€” extends safety with uncertainty estimation

### Problem Statement

Sage's agent has no mechanism for estimating its confidence in a response. The critic loop in `criticAgent.ts` scores quality but doesn't estimate whether the agent "knows" its answer is correct. LLMs are notoriously overconfident â€” they express high certainty even when incorrect. This leads to:

1. **Hallucination without warning**: the agent presents uncertain information with the same confidence as certain information.
2. **No abstention capability**: the agent never says "I don't know" or "I'm not confident enough to answer this."
3. **No uncertainty propagation**: in multi-step ReAct loops, uncertainty compounds but is never tracked.

### Goal

Add confidence estimation, uncertainty propagation, and abstention capabilities so the agent can honestly communicate its confidence level and know when to ask for help or decline.

### Implementation Plan

#### [NEW] [src/core/agentRuntime/confidenceEstimator.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/confidenceEstimator.ts)

1. **Multi-signal confidence scoring**:

   ```typescript
   interface ConfidenceEstimate {
     overall: number;             // 0.0â€“1.0
     signals: {
       sourceQuality: number;     // based on tool result quality/count
       reasoningCoherence: number; // self-consistency across iterations
       knowledgeCoverage: number;  // does the response cover all user queries?
       criticAlignment: number;   // critic score correlation
     };
     shouldAbstain: boolean;       // true if overall < abstentionThreshold
     uncertaintyFlags: string[];   // e.g., 'no_sources_found', 'conflicting_data'
   }
   ```

2. **`estimateConfidence(params)`**: analyzes the agent's response alongside its reasoning trace:
   - **Source quality**: how many tool calls succeeded? Are sources diverse or single-source?
   - **Reasoning coherence**: in ReAct loops, are the reasoning steps consistent? Any contradictions?
   - **Knowledge coverage**: does the response address all parts of the user's query?
   - **Critic alignment**: does the critic score match the confidence estimate?

3. **Uncertainty propagation for multi-step reasoning** (SAUP-inspired):
   - Track per-step confidence in ReAct loop.
   - Compound uncertainty: overall confidence decays with each uncertain step.
   - Flag chains of reasoning built on uncertain intermediate results.

#### [NEW] [src/core/agentRuntime/abstentionPolicy.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/abstentionPolicy.ts)

1. **Abstention decision logic**:

   ```typescript
   interface AbstentionDecision {
     shouldAbstain: boolean;
     reason?: 'low_confidence' | 'no_sources' | 'conflicting_data' | 'out_of_scope';
     alternativeAction?: 'ask_clarification' | 'partial_answer' | 'suggest_resources';
     confidenceThreshold: number;  // configurable, default: 0.3
   }
   ```

2. When `shouldAbstain === true`, instead of returning a potentially hallucinated answer:
   - Return a transparent response explaining what was found and what's uncertain.
   - Suggest next steps or ask the user for clarification.
   - Log the abstention in the trace for quality tracking.

3. **Configurable thresholds** via tenant policy and env var `AGENTIC_ABSTENTION_THRESHOLD`.

#### [MODIFY] [agentRuntime.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentRuntime.ts)

1. After draft generation (and optional critic loop), run `estimateConfidence`.
2. If `shouldAbstain === true`, replace the draft with a honest uncertainty response.
3. Include confidence metadata in `AgentTrace` for quality analysis.
4. Gate behind `AGENTIC_CONFIDENCE_ENABLED` env var (default: `false`).

#### [MODIFY] [outcomeScorer.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/outcomeScorer.ts)

1. Add `confidenceEstimate?: ConfidenceEstimate` to `OutcomeScore`.
2. Reward honest abstention (abstaining when sources are absent) and penalize overconfident hallucination.

#### [NEW] [tests/unit/agentRuntime/confidenceEstimator.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/agentRuntime/confidenceEstimator.test.ts)

Tests for multi-signal confidence scoring, uncertainty propagation, abstention decisions, and trace logging.

### Exit Criteria

- [ ] Confidence estimated for every agent response.
- [ ] Agent abstains (with honest explanation) when confidence is below threshold.
- [ ] Uncertainty compounds across multi-step ReAct reasoning.
- [ ] Abstention decisions logged in trace data.
- [ ] Outcome scorer rewards honest abstention.
- [ ] `npm run check` passes.

---

## Phase 9 â€” Quality Loop Enhancements

**Priority:** P2 Â· **Audit refs:** Gap #11 (voting/ensemble), Gap #12 (prompt chaining), Gap #13 (critic progress tracking), Gap #14 (streaming), Gap #15 (cost-aware routing)
**Industry sources:** Anthropic (Voting, Prompt chaining), OpenAI (Cost-aware routing)
**Depends on:** Phase 6 (Adaptive Planning) â€” uses complexity classification

### Problem Statement

Five related quality and efficiency improvements:

1. **No voting/ensemble**: The multi-judge pipeline uses voting for *evaluation* but never for *generation*. High-stakes drafts are single-shot.
2. **No progressive critic tracking**: The critic loop doesn't verify if revisions actually improve the score. Revision 2 might be worse than revision 1.
3. **No prompt chaining for code**: Complex coding tasks generate the entire response in one LLM call.
4. **No streaming feedback**: Users see no progress during long generation cycles.
5. **No cost-aware routing**: Model selection doesn't factor in token cost.

### Implementation Plan

#### Voting/Ensemble for High-Stakes Routes

##### [NEW] [src/core/agentRuntime/ensembleGenerator.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/ensembleGenerator.ts)

1. **`generateEnsemble(params)`**: for `coding` and complex `search` routes, generate 2â€“3 candidate drafts using different models or temperatures.
2. **`selectBestDraft(candidates, userText)`**: use a lightweight LLM call (or the critic model) to select the best candidate.
3. Gate behind `AGENTIC_ENSEMBLE_ENABLED` env var and route-specific config.
4. Bounded cost: only for routes where `complexity >= complex` (from Phase 6).

#### Progressive Critic Tracking

##### [MODIFY] [criticAgent.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/criticAgent.ts)

1. Track scores across revision iterations:

   ```typescript
   interface CriticProgressTracker {
     iterations: { draft: string; score: number; issues: string[] }[];
     bestDraftIndex: number;    // index of highest-scoring draft
     isImproving: boolean;      // score trend is positive
   }
   ```

2. After each critic pass, compare score to previous iteration:
   - If score improved â†’ continue with revised draft.
   - If score declined â†’ revert to the previous (higher-scoring) draft and stop.
   - If scores are within 0.05 â†’ stop (diminishing returns).

3. Persist progress data in `AgentTrace.qualityJson` for tracking.

#### Prompt Chaining for Coding

##### [MODIFY] [agentRuntime.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentRuntime.ts)

1. For `coding` route with complexity `complex`+:
   - Step 1: Generate outline/approach (short LLM call).
   - Step 2: Validate outline against user requirements.
   - Step 3: Generate full implementation using outline as context.
   - Step 4: Run through critic loop.
2. Gate behind `AGENTIC_CODE_CHAINING_ENABLED` env var.

#### Streaming Progress Indicators

##### [MODIFY] [agentRuntime.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentRuntime.ts)

1. Emit Discord typing indicators during long operations.
2. For tool-heavy turns, send a brief "Working on it..." message that gets edited with the final response.
3. Progress stages: ðŸ” Searching â†’ âœï¸ Drafting â†’ ðŸ”„ Refining â†’ âœ… Done.

#### Cost-Aware Model Selection

##### [MODIFY] Model resolver (relevant model selection files)

1. Add `costPerMillionTokens: { input: number; output: number }` to model capability metadata.
2. For `simple` complexity routes, prefer the cheapest capable model.
3. For `complex`+ routes, prefer the most capable model regardless of cost.
4. Track estimated cost per turn in `AgentTrace.budgetJson`.

### Exit Criteria

- [ ] Ensemble generation produces 2â€“3 candidates for complex coding queries.
- [ ] Critic reverts to best draft when quality degrades.
- [ ] Coding prompt chaining produces outline â†’ implementation.
- [ ] Progress indicators show during long operations.
- [ ] Cost tracking visible in trace data.
- [ ] `npm run check` passes.

---

## Phase 10 â€” Agent Capability Registry and A2A Protocol

**Priority:** P3 Â· **Audit ref:** Gap #4
**Industry sources:** Google Cloud (A2A protocol), Azure (Multi-agent networks), OpenAI (Agent handoffs)
**Depends on:** Phase 6 (Adaptive Planning) â€” replaces hardcoded task assignment

### Problem Statement

The manager-worker system uses hardcoded worker types (`research`, `verification`, `synthesis` in `workers/`) with no protocol for dynamic agent discovery, capability advertisement, or inter-agent message passing beyond the fixed plan â†’ result pipeline. Adding new worker specializations requires code changes to `taskPlanner.ts`.

### Goal

Define a capability-based agent registry that allows dynamic worker discovery and structured inter-agent communication, setting the foundation for future external agent integration.

### Implementation Plan

#### [NEW] [src/core/agentRuntime/agentCapabilityRegistry.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/agentCapabilityRegistry.ts)

1. **Define capability protocol**:

   ```typescript
   interface AgentCapability {
     id: string;
     name: string;
     description: string;
     inputSchema: z.ZodType;
     outputSchema: z.ZodType;
     supportedRoutes: AgentKind[];
     costEstimate: 'low' | 'medium' | 'high';
     latencyEstimate: 'fast' | 'medium' | 'slow';
   }

   interface RegisteredAgent {
     agentName: AgentName;
     capabilities: AgentCapability[];
     status: 'available' | 'degraded' | 'unavailable';
     healthScore: number;
   }

   class AgentCapabilityRegistry {
     register(agent: RegisteredAgent): void;
     findByCapability(capabilityId: string): RegisteredAgent[];
     findForRoute(routeKind: AgentKind): RegisteredAgent[];
     getBestAgent(params: { capability: string; route: AgentKind; costBudget?: string }): RegisteredAgent | null;
   }
   ```

2. **Migrate existing workers** to register capabilities:
   - `researchWorker` â†’ capabilities: `['web_research', 'document_analysis']`
   - `verificationWorker` â†’ capabilities: `['fact_checking', 'source_verification']`
   - `synthesisWorker` â†’ capabilities: `['summarization', 'answer_composition']`

#### [MODIFY] [taskPlanner.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/taskPlanner.ts)

1. Instead of `buildTasksForRoute`, query the capability registry:

   ```typescript
   const availableAgents = registry.findForRoute(routeKind);
   const plan = decomposeTasks(userText, availableAgents);
   ```

2. Task assignment uses capability matching instead of hardcoded type mapping.

#### [MODIFY] [blackboard.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/agentRuntime/blackboard.ts)

1. Add typed inter-agent message channel to `BlackboardState`:

   ```typescript
   messages: AgentMessage[];

   interface AgentMessage {
     id: string;
     fromAgent: AgentName;
     toAgent: AgentName | '*';  // broadcast
     type: 'data' | 'request' | 'status';
     content: unknown;
     timestamp: string;
   }
   ```

2. Workers can read messages from the blackboard to coordinate.

#### [NEW] [tests/unit/agentRuntime/agentCapabilityRegistry.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/agentRuntime/agentCapabilityRegistry.test.ts)

Tests for registration, capability lookup, route matching, and health-based selection.

### Exit Criteria

- [ ] Existing workers register capabilities on startup.
- [ ] Task planner queries registry instead of hardcoded types.
- [ ] Blackboard supports inter-agent messages.
- [ ] Adding a new worker requires only registration, not planner code changes.
- [ ] `npm run check` passes.

---

## Phase 11 â€” Comprehensive Fine-Tuning and Calibration

**Priority:** P-Final (Must be last) Â· **Research ref:** Evaluation & Calibration Survey (2025â€“2026)
**Industry sources:** Anthropic (Threshold tuning), OpenAI (Model evaluation), AgentBench (Multi-dimensional scoring)
**Depends on:** All prior phases (1â€“10) â€” requires all subsystems to be implemented and stable

### Problem Statement

After implementing all prior phases, the system will have numerous configurable thresholds, parameters, and policies that interact in complex ways. These include:

- ReAct iteration limits and completion check thresholds
- Context compaction aggressiveness and scratchpad token budgets
- Retrieval sufficiency thresholds and reformulation strategies
- Confidence calibration thresholds and abstention triggers
- Critic score thresholds and revision limits
- Cost-quality tradeoff parameters across model selection
- Replay quality gate thresholds (`minAvgScore`)
- Ensemble generation count and selection criteria
- Safety classifier confidence thresholds

Currently, `avgScore=0.6468` falls below `minAvgScore=0.6500`, blocking release promotion. Fine-tuning these parameters requires **hundreds to thousands of API calls** to systematically explore the parameter space and find optimal values â€” this is why it must be the final phase.

### Goal

Systematically calibrate all configurable parameters across the entire agentic pipeline to maximize quality, minimize cost, and unblock release promotion. This is the only phase that intentionally makes many API calls.

### Implementation Plan

#### [NEW] [src/scripts/parameter-sweep.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/scripts/parameter-sweep.ts)

1. **Systematic parameter sweep framework**:

   ```typescript
   interface SweepConfig {
     parameter: string;           // e.g., 'AGENTIC_REACT_MAX_ITERATIONS'
     range: { min: number; max: number; step: number };
     metric: 'avgScore' | 'latencyMs' | 'costUsd' | 'passRate';
     evalSamples: number;         // default: 50 per parameter value
     concurrency: number;         // default: 3
   }

   interface SweepResult {
     parameter: string;
     bestValue: number;
     bestMetric: number;
     allResults: { value: number; metric: number; samples: number }[];
     recommendation: string;
   }
   ```

2. **`runParameterSweep(config)`**: iterates through parameter values, runs eval pipeline for each, collects metrics, recommends optimal value.

3. **Multi-parameter optimization**: run sweeps sequentially (one parameter at a time, holding others at best-known values) to avoid combinatorial explosion.

#### Calibration Targets

| Parameter | Current Value | Sweep Range | Primary Metric |
| :--- | :--- | :--- | :--- |
| `AGENTIC_REACT_MAX_ITERATIONS` | 6 | 3â€“10 | avgScore |
| `AGENTIC_CRITIC_MIN_SCORE` | 0.82 | 0.70â€“0.90 | avgScore vs. latency |
| `AGENTIC_ABSTENTION_THRESHOLD` | 0.3 | 0.2â€“0.5 | false-positive abstention rate |
| `retrieval.sufficiencyThreshold` | 0.7 | 0.5â€“0.9 | retrieval quality |
| `compaction.recentTurnsToKeep` | 3 | 2â€“5 | context quality |
| `replay-gate minAvgScore` | 0.6500 | 0.6000â€“0.7000 | release gate pass rate |
| Ensemble candidate count | 3 | 2â€“5 | quality vs. cost |
| Safety classifier threshold | 0.8 | 0.6â€“0.95 | false-positive rate |

#### [NEW] [src/scripts/calibration-report.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/scripts/calibration-report.ts)

1. **Generate comprehensive calibration report**:
   - Per-parameter optimal values with confidence intervals.
   - Cost impact analysis (total API cost of calibration).
   - Quality impact: projected `avgScore` after applying optimal parameters.
   - Regression risk assessment: which parameter changes have the highest regression risk.

2. **Add `npm run calibrate` script** to `package.json`:
   - Runs the full calibration pipeline.
   - Outputs report to `docs/architecture/CALIBRATION_REPORT.md`.
   - Can be run incrementally (resume from last checkpoint).

#### [MODIFY] [package.json](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/package.json)

1. Add scripts:

   ```json
   {
     "calibrate": "tsx src/scripts/parameter-sweep.ts",
     "calibrate:report": "tsx src/scripts/calibration-report.ts"
   }
   ```

#### Cross-Phase Integration Testing

1. **End-to-end scenario tests**: run representative queries through the full pipeline with all phases enabled:
   - Simple chat query â†’ should use minimal resources.
   - Complex search query â†’ should trigger ReAct + agentic RAG + context compaction.
   - Multi-turn conversation â†’ should use session memory + compaction.
   - Uncertain query â†’ should trigger abstention.
   - High-risk tool call â†’ should trigger human approval.

2. **Regression sweep**: after applying optimal parameters, re-run the full replay evaluation to confirm `avgScore >= minAvgScore`.

3. **Cost audit**: calculate total API cost of the calibration process and document.

#### [NEW] [tests/integration/fullPipeline.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/integration/fullPipeline.test.ts)

Integration tests validating cross-phase interactions with all features enabled.

### Exit Criteria

- [ ] Parameter sweep completed for all calibration targets.
- [ ] Calibration report generated with optimal values and confidence intervals.
- [ ] `avgScore >= minAvgScore` after applying optimal parameters (release gate unblocked).
- [ ] Full replay evaluation passes with all phases enabled.
- [ ] Cross-phase integration tests pass.
- [ ] Cost of calibration documented.
- [ ] `npm run check` passes.
- [ ] `npm run release:agentic-check` passes.

---

## Phase 12 â€” Environmentally-Enacted Metacognitive Self-Improvement Engine

**Priority:** P-Frontier (Capstone) Â· **Research ref:** 4E Cognition, Metacognitive Learning, Continuous Agent Improvement
**Scientific foundations:** 4E Cognition (Varela, Thompson & Rosch), Piaget (Constructivism), Vygotsky (Social Constructivism), Gibson (Ecological Psychology), arXiv:2506.05109 (Intrinsic Metacognitive Learning)
**Industry sources:** OpenAI (recursive self-improvement), Anthropic (context engineering), DeepMind (continuous learning), Microsoft (PromptWizard)

### Problem Statement

Sage processes every conversation as an isolated event. The agent starts each interaction with the same prompts, the same thresholds, the same strategies. It never learns from its own successes or failures. Conversation #10,000 is answered with the exact same cognitive blueprint as conversation #1.

This mirrors a fundamental gap that neuroscience identified decades ago: **intelligence is not brain-bound â€” it is environmentally enacted**. The human brain does not compute in isolation; it is shaped by, embedded in, and extended through its environment. A child raised in a musical household develops different cognitive patterns than one raised in a mathematical household â€” not because of different brains, but because of different environments. The environment doesn't just provide input; it *sculpts the cognitive architecture itself*.

Sage lives in a Discord environment â€” a rich social ecosystem with community culture, conversational norms, topic preferences, expertise domains, temporal patterns, and collective knowledge. Yet it treats this environment as a dumb I/O pipe: messages in, messages out. It has no awareness of the community it serves, no memory of what works in this specific context, no ability to adapt its cognitive patterns to its environment.

**The breakthrough insight**: Discord is not just Sage's deployment target â€” it is Sage's *embodied environment*. Just as the human mind is shaped by its world, Sage should be shaped by its community. This is the path to the first truly environment-aware, self-improving AI agent.

### Theoretical Foundation: How the Human Brain Does This

This phase is grounded in five pillars of cognitive science:

#### 1. 4E Cognition (Embodied, Embedded, Extended, Enacted)

The dominant framework in modern cognitive science (Varela, Thompson & Rosch, 1991; extended by many). It posits that cognition is:

- **Embodied**: shaped by the physical form that interacts with the world. For Sage, the Discord API is its "body" â€” defining what it can perceive (messages, reactions, threads, user roles) and how it can act (replies, embeds, tool calls).
- **Embedded**: situated in and constrained by the environment. Sage's cognition should be constrained and enhanced by the specific server's culture, rules, topic distribution, and interaction patterns.
- **Extended**: cognitive processes extend beyond the brain into environmental tools. Sage's conversation history, user profiles, and server knowledge base are extensions of its cognition â€” not just data sources.
- **Enacted**: the agent doesn't passively process a pre-given world but actively "brings forth" its world through interaction. Sage's understanding of its community should emerge from its history of interactions, not from a static prompt.

#### 2. Piaget's Constructivism â€” Learning Through Environment Interaction

Jean Piaget showed that intelligence develops through **schemas** (mental structures) that are continuously modified via:

- **Assimilation**: incorporating new experiences into existing schemas ("this question is like others I've handled well")
- **Accommodation**: modifying schemas when existing ones fail ("my usual approach failed for this type of question â€” I need a new strategy")

For Sage: every conversation is an opportunity for schema construction. Successful interactions reinforce existing strategies; failures trigger accommodation â€” the creation of new, better strategies.

#### 3. Vygotsky's Social Constructivism â€” Learning Through Community

Lev Vygotsky demonstrated that cognition is fundamentally social â€” knowledge is constructed through interaction with others, mediated by cultural tools (especially language). His **Zone of Proximal Development (ZPD)** concept shows that growth happens at the boundary between what an agent can do alone and what it can do with guidance.

For Sage: the Discord community IS the social context. User feedback (explicit reactions, follow-up questions, re-asks) provides the social signal. The community's collective expertise defines Sage's ZPD â€” areas where it should push to improve.

#### 4. Gibson's Ecological Psychology â€” Environmental Affordances

James Gibson showed that environments offer **affordances** â€” possibilities for action that are directly perceivable. The environment is never neutral; it shapes what actions are possible and useful.

For Sage: a coding-focused Discord server affords different cognitive patterns than a creative writing server. The server's channel structure, topic distribution, user expertise levels, and interaction patterns are all affordances that should shape how Sage thinks and responds.

#### 5. Intrinsic Metacognitive Learning (arXiv:2506.05109, 2025)

Liu & van der Schaar formalized what human metacognition does computationally:

- **Metacognitive Knowledge**: the agent's understanding of its own capabilities ("I excel at factual queries but struggle with comparison queries")
- **Metacognitive Planning**: deciding what and how to learn ("I should focus on improving multi-source synthesis")
- **Metacognitive Evaluation**: reflecting on learning outcomes to improve future learning ("my last prompt revision improved coding but degraded chat â€” revert chat changes")

### Goal

Build a continuous, autonomous self-improvement engine where Sage:

1. **Perceives** its environment (community patterns, user behavior, conversation outcomes)
2. **Reflects** on its own performance (metacognitive analysis of success/failure patterns)
3. **Adapts** its cognitive architecture (evolves prompts, strategies, and thresholds)
4. **Evaluates** the impact of adaptations (A/B testing, quality tracking)
5. **Develops** environment-shaped cognitive patterns (community-aware personality and expertise)

This creates the first agent that gets measurably better with every batch of conversations â€” not through retraining, but through environmentally-enacted metacognitive self-improvement.

### Implementation Plan

#### [NEW] [src/agentic/metacognition/experienceBuffer.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/agentic/metacognition/experienceBuffer.ts)

1. **Experience trace capture**: extend `AgentTrace` to include outcome classification:

   ```typescript
   interface ExperienceTrace {
     traceId: string;
     timestamp: Date;
     guildId: string;                    // environment identifier
     channelId: string;
     routeKind: string;
     userQuery: string;
     strategyUsed: {
       toolSequence: string[];
       reactIterations: number;
       retrievalReformulations: number;
       criticRevisions: number;
     };
     outcome: {
       qualityScore: number;              // from outcomeScorer
       confidenceEstimate: number;        // from Phase 8
       latencyMs: number;
       costUsd: number;
       userSignal?: 'positive' | 'negative' | 'neutral' | 'reasked';
     };
     failureSignals?: {
       category: 'hallucination' | 'insufficient_retrieval' | 'wrong_tool' |
                 'over_verbose' | 'missed_intent' | 'abstention_error' |
                 'context_exhaustion' | 'wrong_tone';
       evidence: string;
     };
   }
   ```

2. **Experience persistence**: store traces in a structured SQLite table (or Prisma model) with indexed queries by `guildId`, `routeKind`, `qualityScore`, and `timestamp`.

3. **Configurable retention**: `AGENTIC_EXPERIENCE_BUFFER_SIZE` (default: 10000, env var) â€” circular buffer with quality-weighted sampling for analysis.

#### [NEW] [src/agentic/metacognition/environmentModel.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/agentic/metacognition/environmentModel.ts)

1. **Community profile construction** â€” the agent's "embodied understanding" of its environment:

   ```typescript
   interface EnvironmentModel {
     guildId: string;
     communityProfile: {
       dominantTopics: { topic: string; frequency: number }[];
       expertiseDistribution: { domain: string; depth: 'beginner' | 'intermediate' | 'expert' }[];
       conversationStyle: {
         avgMessageLength: number;
         formalityLevel: number;          // 0.0 casual â†” 1.0 formal
         technicalDepth: number;          // 0.0 surface â†” 1.0 deep-dive
         humorTolerance: number;          // 0.0 strictly factual â†” 1.0 playful
       };
       peakActivityWindows: { dayOfWeek: number; hour: number; volume: number }[];
       topContributors: { userId: string; interactionCount: number; satisfactionTrend: number }[];
     };
     affordances: {
       availableTools: string[];
       channelPurposes: { channelId: string; inferredPurpose: string }[];
       commonWorkflows: string[];        // e.g., "search â†’ code â†’ explain" patterns
     };
     lastUpdated: Date;
   }
   ```

2. **Incremental update**: every N conversations (configurable), rebuild the community profile from the experience buffer. This is Piaget's **assimilation** â€” incorporating new experiences into the environment model.

3. **Drift detection**: when the community profile changes significantly (topic shift, new users, style change), trigger **accommodation** â€” flag that existing strategies may need revision.

#### [NEW] [src/agentic/metacognition/metacognitiveAnalyzer.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/agentic/metacognition/metacognitiveAnalyzer.ts)

The core breakthrough â€” the "prefrontal cortex" of the system:

1. **Metacognitive Knowledge** â€” self-assessment of capabilities:

   ```typescript
   interface MetacognitiveKnowledge {
     capabilityMap: {
       routeKind: string;
       avgQualityScore: number;
       sampleSize: number;
       trend: 'improving' | 'stable' | 'degrading';
       knownWeaknesses: string[];
     }[];
     strategyEffectiveness: {
       strategy: string;                 // e.g., "multi-source-synthesis"
       avgScore: number;
       conditions: string[];             // when this strategy works best
     }[];
     environmentFit: {
       dimension: string;                // e.g., "technical-depth"
       communityExpectation: number;
       currentPerformance: number;
       gap: number;
     }[];
   }
   ```

2. **Metacognitive Planning** â€” deciding what to improve:

   ```typescript
   interface ImprovementPlan {
     priority: number;
     target: string;                     // what to improve
     hypothesizedCause: string;          // why it's underperforming
     proposedIntervention: {
       type: 'prompt_revision' | 'strategy_change' | 'threshold_adjustment' | 'style_adaptation';
       description: string;
       expectedImpact: number;
     };
     evidence: string[];                 // trace IDs supporting the hypothesis
   }
   ```

3. **Metacognitive Evaluation** â€” reflecting on whether improvements worked:

   ```typescript
   interface ImprovementEvaluation {
     planId: string;
     interventionApplied: Date;
     preInterventionScore: number;
     postInterventionScore: number;
     sampleSize: number;
     statisticallySignificant: boolean;
     verdict: 'promote' | 'reject' | 'extend_trial';
     lessonLearned: string;             // meta-meta-learning: what did we learn about learning?
   }
   ```

4. **Analysis cadence**: configurable via `AGENTIC_METACOG_ANALYSIS_INTERVAL` (default: every 100 conversations or once daily, whichever comes first). This is the agent's "sleep cycle" â€” the consolidation phase where experience becomes knowledge.

#### [NEW] [src/agentic/metacognition/promptEvolutionEngine.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/agentic/metacognition/promptEvolutionEngine.ts)

Safe, auditable self-improvement at the prompt level:

1. **Prompt version control**:

   ```typescript
   interface PromptEvolution {
     promptId: string;                   // which prompt (system, agent, critic, etc.)
     version: number;
     content: string;
     parentVersion: number;
     changeReason: string;               // links to MetacognitiveKnowledge insight
     environmentContext: string;         // which guild/community this was evolved for
     abTestResults?: {
       controlScore: number;
       candidateScore: number;
       sampleSize: number;
       pValue: number;
       significant: boolean;
     };
     status: 'candidate' | 'testing' | 'promoted' | 'rejected' | 'rolled_back';
   }
   ```

2. **Community-aware prompt adaptation**: the system prompt can include dynamically injected "community context" based on the environment model:
   - Technical communities get more precise, detailed responses.
   - Casual communities get warmer, more conversational responses.
   - Expert communities get deeper analysis with less hand-holding.
   - This is Gibson's **affordances** in action â€” the environment shapes the cognitive response.

3. **A/B testing on replay**: before any prompt change goes to production, test it against the existing replay harness. Only promote changes that show statistically significant improvement (p < 0.05).

4. **Rollback safety**: every prompt change has a `parentVersion` pointer. If quality degrades after promotion, automatic rollback to the parent version within one analysis cycle.

#### [NEW] [src/agentic/metacognition/environmentalAdaptation.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/agentic/metacognition/environmentalAdaptation.ts)

The Vygotskian social learning layer:

1. **Community feedback interpretation**: infer user satisfaction from natural signals:
   - **Positive signals**: reactions (ðŸ‘, âœ…, â¤ï¸), thread resolved, no follow-up needed
   - **Negative signals**: re-ask of same question, explicit correction, ðŸ‘Ž reactions, message deletion
   - **Neutral signals**: conversation continuation without explicit feedback

2. **Zone of Proximal Development tracking**: identify areas where the agent is close to competence but needs improvement:

   ```typescript
   interface ZPDAnalysis {
     domain: string;
     currentCompetence: number;          // 0.0 to 1.0
     communityDemand: number;            // how often this domain is requested
     zpd: number;                        // gap between competence and demand
     learningPriority: number;           // zpd * demand frequency
   }
   ```

3. **Cultural schema adaptation**: over time, the agent develops environment-specific schemas (Piaget's cognitive structures) that encode:
   - "In this server, users prefer concise code snippets over explanations"
   - "This community values sourced citations for factual claims"
   - "Users here respond well to analogies and metaphors"
   - These schemas are stored as structured data, not hidden in weights â€” fully transparent and auditable.

#### [MODIFY] [src/core/orchestration/agentRuntime.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/orchestration/agentRuntime.ts)

1. After each conversation completion, emit an `ExperienceTrace` to the experience buffer.
2. Before generating a response, inject `EnvironmentModel` context into the system prompt if `AGENTIC_METACOG_ENABLED=true`.
3. At startup, initialize the metacognitive analysis scheduler.

#### [MODIFY] [src/core/orchestration/contextBuilder.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/core/orchestration/contextBuilder.ts)

1. Add optional `communityContext` section to the context assembly pipeline.
2. When `AGENTIC_METACOG_ENABLED=true`, prepend environment-aware instructions based on the `EnvironmentModel`.

#### [MODIFY] [src/data/schema.prisma](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/src/data/schema.prisma)

1. Add `ExperienceTrace` model for persistent storage.
2. Add `PromptEvolution` model for version-controlled prompt history.
3. Add `EnvironmentModel` model for per-guild community profiles.

#### [MODIFY] [.env.example](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/.env.example)

1. Add environment variables:

   ```bash
   AGENTIC_METACOG_ENABLED=false              # Master toggle for metacognitive self-improvement
   AGENTIC_EXPERIENCE_BUFFER_SIZE=10000       # Max traces to retain per guild
   AGENTIC_METACOG_ANALYSIS_INTERVAL=100      # Conversations between analysis cycles
   AGENTIC_METACOG_AB_MIN_SAMPLES=50          # Minimum samples for A/B test significance
   AGENTIC_METACOG_AUTO_PROMOTE=false          # Auto-promote significant improvements (vs. human review)
   ```

#### [NEW] [tests/unit/metacognition/metacognitiveAnalyzer.test.ts](file:///c:/Users/ahazi/OneDrive/Desktop/Github/Sage/tests/unit/metacognition/metacognitiveAnalyzer.test.ts)

Unit tests covering:

1. Experience trace capture and storage.
2. Community profile construction from experience buffer.
3. Metacognitive knowledge generation (capability map, strategy effectiveness).
4. Improvement plan generation from metacognitive analysis.
5. A/B test evaluation with statistical significance checking.
6. Prompt rollback on quality degradation.
7. Environment model drift detection.

### The Cognitive Loop Visualized

```text
  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
  â”‚                     SAGE'S COGNITIVE LOOP                          â”‚
  â”‚                   (inspired by human metacognition)                â”‚
  â”‚                                                                    â”‚
  â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”‚
  â”‚  â”‚ PERCEIVE   â”‚    â”‚ EXPERIENCE     â”‚    â”‚ ENVIRONMENT      â”‚      â”‚
  â”‚  â”‚ (Discord   â”‚â”€â”€â”€â–¶â”‚ BUFFER         â”‚â”€â”€â”€â–¶â”‚ MODEL            â”‚      â”‚
  â”‚  â”‚ interactions)   â”‚ (traces, scores)â”‚   â”‚ (community       â”‚      â”‚
  â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â”‚  profile,        â”‚      â”‚
  â”‚                                          â”‚  affordances)    â”‚      â”‚
  â”‚                                          â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â”‚
  â”‚       â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜               â”‚
  â”‚       â–¼                                                            â”‚
  â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚
  â”‚  â”‚ METACOGNITIVE  â”‚    â”‚ IMPROVEMENT    â”‚    â”‚ PROMPT          â”‚   â”‚
  â”‚  â”‚ ANALYZER       â”‚â”€â”€â”€â–¶â”‚ PLAN           â”‚â”€â”€â”€â–¶â”‚ EVOLUTION       â”‚   â”‚
  â”‚  â”‚ (knowledge,    â”‚    â”‚ (hypotheses,   â”‚    â”‚ ENGINE          â”‚   â”‚
  â”‚  â”‚  planning,     â”‚    â”‚  interventions)â”‚    â”‚ (A/B test,      â”‚   â”‚
  â”‚  â”‚  evaluation)   â”‚    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â”‚  promote/reject)â”‚   â”‚
  â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜                          â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚
  â”‚          â”‚                                            â”‚            â”‚
  â”‚          â””â”€â”€â”€â”€ meta-meta-learning â—€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜            â”‚
  â”‚                (learn from learning attempts)                      â”‚
  â”‚                                                                    â”‚
  â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”‚
  â”‚  â”‚                   ENACTION CYCLE                           â”‚    â”‚
  â”‚  â”‚  The agent doesn't just USE the environment â€”              â”‚    â”‚
  â”‚  â”‚  it CO-CREATES its cognitive world through interaction.    â”‚    â”‚
  â”‚  â”‚  Each conversation shapes the agent. The agent shapes      â”‚    â”‚
  â”‚  â”‚  the community experience. Both evolve together.           â”‚    â”‚
  â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â”‚
  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Why This Is a Breakthrough on the Road to AGI

| AGI Property | How Phase 12 Addresses It |
| :--- | :--- |
| **Continuous learning** | Agent improves with every batch of conversations without retraining |
| **Environmental awareness** | Agent perceives and adapts to its social environment |
| **Self-awareness** | Agent knows what it's good at and where it fails (metacognitive knowledge) |
| **Autonomous goal-setting** | Agent identifies its own improvement priorities (metacognitive planning) |
| **Self-correction** | Agent evaluates its own improvements and rolls back failures |
| **Social intelligence** | Agent adapts to community norms, humor, expertise levels |
| **Personality emergence** | Cognitive patterns shaped by environment, not hardcoded |
| **Meta-meta-learning** | Agent learns how to learn better from its own learning attempts |

### Exit Criteria

- [ ] Experience buffer captures traces for all conversations with outcome classification.
- [ ] Environment model built and updated for at least one guild.
- [ ] Metacognitive analyzer generates capability map and improvement plans.
- [ ] At least one prompt evolution cycle completed (candidate â†’ A/B test â†’ promote or reject).
- [ ] Community-aware context injection produces measurably different responses for different server profiles.
- [ ] Quality scores show statistically significant improvement after 3+ analysis cycles.
- [ ] All prompt changes have version history with rollback capability.
- [ ] Feature fully gated behind `AGENTIC_METACOG_ENABLED=false` default.
- [ ] `npm run check` passes.
- [ ] `npm run release:agentic-check` passes.

---

## Research-Driven Enhancements

The following enhancements are derived from the cutting-edge research survey and should be incorporated when implementing the corresponding phases:

| Phase | Enhancement | Research Source |
| :--- | :--- | :--- |
| 1 (ReAct) | **Graph-of-Thought option**: for multi-source synthesis, model reasoning as a DAG where branches can merge and loop rather than linear chain | GoT papers (2024â€“2025) |
| 1 (ReAct) | **Speculative execution**: predict likely next tool calls using router model, execute in parallel, validate after | Speculative execution for agents (2025) |
| 2 (Session) | **Initializer/coding agent pattern**: on first turn, create structured progress files; subsequent turns read and update them | Anthropic (2025) |
| 2 (Session) | **File-based hierarchical memory**: treat session state like git history â€” structured, version-controllable, transparent | Anthropic (2025) |
| 5 (Observability) | **HTC trajectory analysis**: extract process-level features across the agent's full operational trajectory for reliability analysis | arXiv HTC (2025) |
| 6 (Planning) | **Speculative parallel task execution**: optimistically execute likely-needed tasks in parallel, discard if plan changes | Speculative execution (2025) |
| 7 (Safety) | **SAUP uncertainty propagation**: propagate uncertainty through multi-step reasoning to identify fragile reasoning chains | ACL SAUP (2025) |
| 9 (Quality) | **MIRROR self-reflection**: add modular inner monologue manager for parallel reasoning and systematic self-review | arXiv MIRROR (2025) |
| 9 (Quality) | **Self-evolving benchmarks**: dynamically generate new eval instances to prevent benchmark saturation | ACL Benchmark Self-Evolving (2025) |
| 10 (A2A) | **MCP protocol support**: standardize agent-tool communication using Model Context Protocol for interoperability | Anthropic MCP (2025) |
| 12 (Metacognition) | **Community personality divergence**: allow different Discord servers to develop distinct agent personalities through environmental adaptation | 4E Cognition, Vygotsky (Social Constructivism) |
| 12 (Metacognition) | **Predictive cognitive loading**: pre-compute likely needed strategies based on time-of-day, channel, and recent conversation patterns | Gibson (Affordances), Ecological Psychology |

---

## Operational Playbook

### Operating Rules

- Evaluation method: model-as-judge only (no human-reviewed benchmark dependency).
- Cost policy: surgical live tests are allowed for pipeline health checks; broad sweeps deferred to Phase 11 (Fine-Tuning).
- Release policy: never bypass `npm run release:agentic-check`.
- Consistency policy: any roadmap or release wiring change must pass `npm run agentic:consistency-check`.

### Phase Execution Policies

- Each phase is independent and can be started without completing prior phases (unless a dependency is listed).
- Recommended execution order follows the phase numbering (1 â†’ 11).
- Each phase must pass `npm run check` before merge.
- Phases with new env vars default to disabled (`false`) for safe rollout.
- Rollout order for feature enablement: `search â†’ coding â†’ chat â†’ creative`.

---

## Gate State Snapshot (Audit)

| Gate | Command | Current result | Key outcome |
| :--- | :--- | :--- | :--- |
| Structural checks | `npm run check` | pass | `69` test files, `355` tests passed. |
| Cross-phase consistency | `npm run agentic:consistency-check` | pass | Foundation phases complete, Phase 1 pending. |
| Replay quality | `node dist/scripts/replay-gate.js` | fail | `avgScore=0.6468` below `minAvgScore=0.6500`. |
| Judge eval quality | `npm run eval:gate` | pass | `total=1`, `avgScore=0.953`, `passRate=1.0`, `disagreementRate=0.0`. |
| Full release gate | `npm run release:agentic-check` | fail | Blocked by replay gate avg-score threshold. |

---

## Evidence Register

| Evidence ID | Date | Command | Result summary | Artifact/Reference |
| :--- | :--- | :--- | :--- | :--- |
| E-001 | 2026-02-11 | `npm run check` | Pass (`69` files, `355` tests). | Terminal output. |
| E-002 | 2026-02-11 | `npm run agentic:consistency-check` | Pass. | Consistency script output. |
| E-003 | 2026-02-11 | `npm run release:agentic-check` | Fail due replay avg-score threshold. | Replay report (`avgScore=0.6468`). |
| E-004 | 2026-02-11 | `npm run eval:run` | Surgical live smoke pass; one row persisted. | `.agent/simulations/eval_smoke_20260211.json` |
| E-005 | 2026-02-11 | `npm run eval:gate` | Strict eval gate pass after smoke row. | Eval gate report. |
| E-006 | 2026-02-11 | Architecture audit | 15 gaps identified against industry best practices. | `sage_agentic_architecture_audit.md` |
| E-007 | 2026-02-11 | Research survey | 12 web searches covering cutting-edge agent research (2025â€“2026). | `cutting_edge_research_findings.md` |

## Phase-to-Artifact Traceability

| Phase | Primary implementation artifacts | Primary verification artifacts |
| :--- | :--- | :--- |
| P1 | `toolCallLoop.ts`, `tenantPolicy.ts`, `toolTelemetry.ts` | `reactLoop.test.ts` |
| P2 | `agentSession.ts`, `agentSessionRepo.ts`, `contextBuilder.ts`, `schema.prisma` | `agentSession.test.ts` |
| P3 | `contextCompactor.ts`, `agentScratchpad.ts`, `contextBuilder.ts`, `toolCallLoop.ts` | `contextCompactor.test.ts` |
| P4 | `agenticRetrieval.ts`, `retrievalStrategy.ts`, `defaultTools.ts`, `toolCallLoop.ts` | `agenticRetrieval.test.ts` |
| P5 | `traceInspector.ts`, `replayHarness.ts`, `outcomeScorer.ts` | `traceInspector.test.ts` |
| P6 | `taskPlanner.ts`, `agentSelector.ts`, `workerExecutor.ts` | `adaptivePlanner.test.ts` |
| P7 | `toolPolicy.ts`, `humanApproval.ts`, `safetyClassifier.ts`, `toolErrors.ts`, `toolCallLoop.ts` | `humanApproval.test.ts`, `safetyClassifier.test.ts` |
| P8 | `confidenceEstimator.ts`, `abstentionPolicy.ts`, `agentRuntime.ts`, `outcomeScorer.ts` | `confidenceEstimator.test.ts` |
| P9 | `ensembleGenerator.ts`, `criticAgent.ts`, `agentRuntime.ts` | `ensembleGenerator.test.ts` |
| P10 | `agentCapabilityRegistry.ts`, `taskPlanner.ts`, `blackboard.ts` | `agentCapabilityRegistry.test.ts` |
| P11 | `parameter-sweep.ts`, `calibration-report.ts`, `package.json` | `fullPipeline.test.ts` |
| P12 | `experienceBuffer.ts`, `environmentModel.ts`, `metacognitiveAnalyzer.ts`, `promptEvolutionEngine.ts`, `environmentalAdaptation.ts`, `agentRuntime.ts`, `contextBuilder.ts`, `schema.prisma` | `metacognitiveAnalyzer.test.ts` |

---

## Audit Update Procedure (Required)

1. Run and capture outputs from:
   - `npm run check`
   - `npm run agentic:consistency-check`
   - `npm run release:agentic-check`
2. If evaluating Phase 5 plumbing, run only surgical live smoke by default:
   - `npm run eval:run` with `EVAL_RUN_LIMIT=1` and `EVAL_RUN_CONCURRENCY=1`
   - `npm run eval:gate`
3. Update:
   - Status Summary
   - Gate State Snapshot
   - Evidence Register
4. Re-run `npm run agentic:consistency-check` before merge.

## Maintainer Handoff Checklist

- [ ] Canonical status table is current and parser-compatible.
- [ ] Evidence register has latest check/consistency/release outputs.
- [ ] Any threshold changes are documented with reason and date.
- [ ] `npm run agentic:consistency-check` output is attached to PR.

## Locked Decisions

- Model-as-judge evaluation remains the benchmark strategy; no human-reviewed benchmark dependency.
- Cost policy remains strict: surgical live checks only until Phase 11 (Fine-Tuning) is explicitly approved.
- Eval pipeline defaults are fail-closed (`EVAL_RUN_REQUIRE_DATA=1`, `EVAL_RUN_FAIL_ON_ERROR=1`, `EVAL_GATE_REQUIRE_DATA=1`, `EVAL_GATE_MIN_TOTAL=1`).
- Runtime remains quality-first with `AGENTIC_CRITIC_MIN_SCORE=0.82`.
- All new features default to disabled via env vars for safe, incremental rollout.

## Open Risks and Next Action

| Risk | Current impact | Mitigation owner | Next action |
| :--- | :--- | :--- | :--- |
| Replay avg-score below threshold | Blocks release promotion. | Runtime maintainers | Address via Phase 1 (ReAct) and Phase 6 (Adaptive Planning) to improve quality; final calibration in Phase 11. |
| Eval sample size is minimal | Eval gate currently based on low sample count. | Runtime maintainers | Increase coverage gradually with scoped low-cost eval runs before threshold hardening. |
| No session memory across turns | Limits multi-turn workflows. | Runtime maintainers | Phase 2 implementation. |
| Context window exhaustion | Long ReAct loops and sessions exhaust context. | Runtime maintainers | Phase 3 context compaction. |
| Single-shot retrieval | Poor search results not improved iteratively. | Runtime maintainers | Phase 4 agentic RAG. |
| No production observability | Cannot debug agent behavior without DB queries. | Runtime maintainers | Phase 5 implementation. |
| Static task planning | Complex queries get generic template plans. | Runtime maintainers | Phase 6 implementation. |
| No human approval for high-risk actions | All tool execution is automated. | Runtime maintainers | Phase 7 implementation. |
| Agent overconfidence / hallucination | No confidence estimation or abstention capability. | Runtime maintainers | Phase 8 confidence calibration. |
| Single-shot generation for high-stakes | No diversity in draft candidates. | Runtime maintainers | Phase 9 implementation. |
| Hardcoded worker types | Cannot add new specializations without code changes. | Runtime maintainers | Phase 10 implementation. |
| Uncalibrated parameters | All threshold values are best-guesses, not optimized. | Runtime maintainers | Phase 11 fine-tuning. |
| No self-improvement loop | Agent never learns from its own successes or failures. | Runtime maintainers | Phase 12 metacognitive engine. |
| Environment-blind responses | Agent gives identical responses regardless of community context. | Runtime maintainers | Phase 12 environment model. |
| Static prompts | System prompts never evolve based on outcome data. | Runtime maintainers | Phase 12 prompt evolution engine. |

---

## Recommended Execution Order

```text
Phase 1 (ReAct) â”€â”€â”
                   â”œâ”€â”€â–¶ Phase 3 (Context) â”€â”€â–¶ Phase 4 (Agentic RAG)
Phase 2 (Session) â”€â”˜         â”‚
                              â–¼
                    Phase 5 (Observability)
                              â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â–¼               â–¼               â–¼
    Phase 6 (Planning)   Phase 7 (Safety)  Phase 8 (Confidence)
              â”‚               â”‚
              â–¼               â–¼
    Phase 9 (Quality)    Phase 10 (A2A Registry)
              â”‚
              â–¼
    Phase 11 (Fine-Tuning)
              â”‚
              â–¼
    Phase 12 (Metacognitive Self-Improvement) â—€â”€â”€ FRONTIER CAPSTONE
```

Phases 1 and 2 can run in parallel as they modify different subsystems. Phase 3 (Context Engineering) prevents context exhaustion from Phases 1 and 2. Phase 4 (Agentic RAG) enhances search quality. Phase 5 (Observability) provides visibility into all prior phases. Phases 6â€“10 can proceed in any order based on priority. Phase 11 (Fine-Tuning) calibrates all parameters. **Phase 12 (Metacognitive Self-Improvement) must be last** â€” it requires all subsystems to be implemented so it can learn from the complete pipeline. It is the frontier capstone that makes the entire system continuously self-improving.

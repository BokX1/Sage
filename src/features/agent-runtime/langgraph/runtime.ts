import { Annotation, Command, END, START, StateGraph, interrupt, MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { LLMChatMessage } from '../../../platform/llm/llm-types';
import { getLLMClient } from '../../../platform/llm';
import { config as appConfig } from '../../../platform/config/env';
import { logger } from '../../../platform/logging/logger';
import type { ToolResult } from '../toolCallExecution';
import type { ToolExecutionContext } from '../toolRegistry';
import { ToolResultCache } from '../toolCache';
import { buildScopedToolRegistry } from '../scopedToolRegistry';
import {
  createOrReuseApprovalReviewRequestFromSignal,
  executeApprovedReviewRequest,
} from '../../admin/adminActionService';
import { buildAgentGraphConfig, type AgentGraphConfig } from './config';
import { buildGraphChatRequest } from './modelAdapter';
import {
  decodeGraphFiles,
  executeToolCallStep,
} from './toolRound';
import type {
  AgentGraphState,
  ApprovalResumeInput,
  SerializedToolResult,
  ToolCallFinalizationEvent,
  GraphTurnTerminationReason,
} from './types';

const overwrite = <T>(_: T, right: T): T => right;
const overwriteNullable = <T>(_: T | null, right: T | null): T | null => right;

const AgentGraphStateAnnotation = Annotation.Root({
  traceId: Annotation<string>({ reducer: overwrite, default: () => '' }),
  originTraceId: Annotation<string>({ reducer: overwrite, default: () => '' }),
  threadId: Annotation<string>({ reducer: overwrite, default: () => '' }),
  userId: Annotation<string>({ reducer: overwrite, default: () => '' }),
  channelId: Annotation<string>({ reducer: overwrite, default: () => '' }),
  guildId: Annotation<string | null>({ reducer: overwriteNullable, default: () => null }),
  apiKey: Annotation<string | undefined>({ reducer: overwrite, default: () => undefined }),
  model: Annotation<string | undefined>({ reducer: overwrite, default: () => undefined }),
  temperature: Annotation<number>({ reducer: overwrite, default: () => 0.6 }),
  timeoutMs: Annotation<number | undefined>({ reducer: overwrite, default: () => undefined }),
  maxTokens: Annotation<number | undefined>({ reducer: overwrite, default: () => undefined }),
  invokedBy: Annotation<AgentGraphState['invokedBy']>({ reducer: overwrite, default: () => 'mention' }),
  invokerIsAdmin: Annotation<boolean | undefined>({ reducer: overwrite, default: () => undefined }),
  messages: Annotation<LLMChatMessage[]>({ reducer: overwrite, default: () => [] }),
  activeToolNames: Annotation<string[]>({ reducer: overwrite, default: () => [] }),
  routeKind: Annotation<string>({ reducer: overwrite, default: () => 'single' }),
  toolExecutionProfile: Annotation<AgentGraphState['toolExecutionProfile']>({
    reducer: overwrite,
    default: () => 'default',
  }),
  currentTurn: Annotation<unknown>({ reducer: overwrite, default: () => null }),
  replyTarget: Annotation<unknown>({ reducer: overwrite, default: () => null }),
  pendingToolCalls: Annotation<AgentGraphState['pendingToolCalls']>({ reducer: overwrite, default: () => [] }),
  pendingAssistantText: Annotation<string>({ reducer: overwrite, default: () => '' }),
  replyText: Annotation<string>({ reducer: overwrite, default: () => '' }),
  toolResults: Annotation<SerializedToolResult[]>({ reducer: overwrite, default: () => [] }),
  files: Annotation<AgentGraphState['files']>({ reducer: overwrite, default: () => [] }),
  roundsCompleted: Annotation<number>({ reducer: overwrite, default: () => 0 }),
  deduplicatedCallCount: Annotation<number>({ reducer: overwrite, default: () => 0 }),
  truncatedCallCount: Annotation<number>({ reducer: overwrite, default: () => 0 }),
  guardrailBlockedCallCount: Annotation<number>({ reducer: overwrite, default: () => 0 }),
  cancellationCount: Annotation<number>({ reducer: overwrite, default: () => 0 }),
  roundEvents: Annotation<AgentGraphState['roundEvents']>({ reducer: overwrite, default: () => [] }),
  finalization: Annotation<ToolCallFinalizationEvent>({
    reducer: overwrite,
    default: () => ({
      attempted: false,
      succeeded: true,
      fallbackUsed: false,
      returnedToolCallCount: 0,
      completedAt: new Date().toISOString(),
      terminationReason: 'assistant_reply',
    }),
  }),
  terminationReason: Annotation<GraphTurnTerminationReason>({
    reducer: overwrite,
    default: () => 'assistant_reply',
  }),
  previousExecutedBatchFingerprint: Annotation<string | null>({
    reducer: overwriteNullable,
    default: () => null,
  }),
  previousSuccessfulReadObservationFingerprint: Annotation<string | null>({
    reducer: overwriteNullable,
    default: () => null,
  }),
  pendingApprovalResultsByFingerprint: Annotation<Record<string, SerializedToolResult>>({
    reducer: overwrite,
    default: () => ({}),
  }),
  callAttemptLedger: Annotation<AgentGraphState['callAttemptLedger']>({
    reducer: overwrite,
    default: () => ({}),
  }),
  sideEffectExecutedInLoop: Annotation<boolean>({ reducer: overwrite, default: () => false }),
  graphStatus: Annotation<AgentGraphState['graphStatus']>({ reducer: overwrite, default: () => 'running' }),
  startedAtEpochMs: Annotation<number>({ reducer: overwrite, default: () => Date.now() }),
  approvalInterrupt: Annotation<AgentGraphState['approvalInterrupt']>({
    reducer: overwriteNullable,
    default: () => null,
  }),
  traceEvents: Annotation<Record<string, unknown>[]>({ reducer: overwrite, default: () => [] }),
});

export interface StartAgentGraphTurnParams {
  traceId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  apiKey?: string;
  model?: string;
  temperature: number;
  timeoutMs?: number;
  maxTokens?: number;
  messages: LLMChatMessage[];
  activeToolNames: string[];
  routeKind: string;
  toolExecutionProfile: 'default' | 'search_high';
  currentTurn: unknown;
  replyTarget: unknown;
  invokedBy?: AgentGraphState['invokedBy'];
  invokerIsAdmin?: boolean;
}

export interface ResumeAgentGraphTurnParams {
  threadId: string;
  decision: ApprovalResumeInput['status'];
  reviewerId?: string | null;
  decisionReasonText?: string | null;
  resumeTraceId?: string | null;
}

export interface AgentGraphTurnResult {
  replyText: string;
  toolResults: ToolResult[];
  files: Array<{ attachment: Buffer; name: string }>;
  roundsCompleted: number;
  deduplicatedCallCount: number;
  truncatedCallCount: number;
  guardrailBlockedCallCount: number;
  cancellationCount: number;
  roundEvents: AgentGraphState['roundEvents'];
  finalization: ToolCallFinalizationEvent;
  terminationReason: GraphTurnTerminationReason;
  graphStatus: AgentGraphState['graphStatus'];
  approvalInterrupt: AgentGraphState['approvalInterrupt'];
  traceEvents: Record<string, unknown>[];
}

interface AgentGraphRuntime {
  graph: ReturnType<typeof createCompiledAgentGraph>;
  checkpointer: PostgresSaver | MemorySaver;
  config: AgentGraphConfig;
}

let runtimePromise: Promise<AgentGraphRuntime> | null = null;
let runtimeInstance: AgentGraphRuntime | null = null;

function buildToolSpecs(activeToolNames: string[]) {
  const scopedRegistry = buildScopedToolRegistry(activeToolNames);
  const specs = scopedRegistry.listOpenAIToolSpecs().map((tool) => ({
    type: tool.type,
    function: {
      ...tool.function,
      parameters: tool.function.parameters as Record<string, unknown>,
    },
  }));
  return specs.length > 0 ? specs : undefined;
}

function buildToolContext(state: AgentGraphState, graphRunKind: 'turn' | 'approval_resume'): ToolExecutionContext {
  return {
    traceId: state.traceId,
    graphThreadId: state.threadId,
    graphRunKind,
    graphStep: state.roundsCompleted + 1,
    approvalRequestId: state.approvalInterrupt?.requestId ?? null,
    userId: state.userId,
    channelId: state.channelId,
    guildId: state.guildId,
    apiKey: state.apiKey,
    invokerIsAdmin: state.invokerIsAdmin,
    invokedBy: state.invokedBy,
    routeKind: state.routeKind,
    toolExecutionProfile: state.toolExecutionProfile,
    currentTurn: state.currentTurn as ToolExecutionContext['currentTurn'],
    replyTarget: state.replyTarget as ToolExecutionContext['replyTarget'],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildRunnableConfig(threadId: string, recursionLimit: number): RunnableConfig {
  return {
    configurable: {
      thread_id: threadId,
    },
    recursionLimit,
  };
}

function deserializeToolResults(results: SerializedToolResult[]): ToolResult[] {
  return results.map((result) => ({
    ...result,
    attachments: undefined,
  }));
}

function normalizeGraphResult(state: AgentGraphState): AgentGraphTurnResult {
  return {
    replyText: state.replyText,
    toolResults: deserializeToolResults(state.toolResults),
    files: decodeGraphFiles(state.files),
    roundsCompleted: state.roundsCompleted,
    deduplicatedCallCount: state.deduplicatedCallCount,
    truncatedCallCount: state.truncatedCallCount,
    guardrailBlockedCallCount: state.guardrailBlockedCallCount,
    cancellationCount: state.cancellationCount,
    roundEvents: state.roundEvents,
    finalization: state.finalization,
    terminationReason: state.terminationReason,
    graphStatus: state.graphStatus,
    approvalInterrupt: state.approvalInterrupt,
    traceEvents: state.traceEvents,
  };
}

function createCompiledAgentGraph(checkpointer: PostgresSaver | MemorySaver, graphConfig: AgentGraphConfig) {
  const client = getLLMClient();
  const roundCacheByThread = new Map<string, ToolResultCache>();

  const callModelNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    const elapsedMs = Date.now() - state.startedAtEpochMs;
    if (elapsedMs >= graphConfig.maxDurationMs && state.toolResults.length > 0) {
      return {
        terminationReason: 'graph_timeout',
        traceEvents: [
          ...state.traceEvents,
          {
            type: 'graph_timeout',
            timestamp: nowIso(),
            details: {
              elapsedMs,
              maxDurationMs: graphConfig.maxDurationMs,
            },
          },
        ],
      };
    }

    const toolSpecs = buildToolSpecs(state.activeToolNames);
    const prepared = buildGraphChatRequest({
      messages: state.messages,
      model: state.model,
      apiKey: state.apiKey,
      temperature: state.temperature,
      timeoutMs: state.timeoutMs,
      maxTokens: state.maxTokens,
      tools: toolSpecs,
      toolChoice: toolSpecs ? 'auto' : undefined,
    });
    const response = await client.chat(prepared.request);
    const toolCalls = response.toolCalls ?? [];

    return {
      pendingToolCalls: toolCalls,
      pendingAssistantText: response.text,
      replyText: toolCalls.length === 0 ? response.text : state.replyText,
      terminationReason: toolCalls.length === 0 ? 'assistant_reply' : state.terminationReason,
      traceEvents: [
        ...state.traceEvents,
        {
          type: 'call_model',
          timestamp: nowIso(),
          details: {
            rebudgeting: prepared.rebudgeting,
            toolCallCount: toolCalls.length,
          },
        },
      ],
    };
  };

  const executeToolsNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    const scopedRegistry = buildScopedToolRegistry(state.activeToolNames);
    const roundCache =
      roundCacheByThread.get(state.threadId) ??
      (() => {
        const cache = new ToolResultCache(50);
        roundCacheByThread.set(state.threadId, cache);
        return cache;
      })();
    const result = await executeToolCallStep({
      state,
      toolCalls: state.pendingToolCalls,
      registry: scopedRegistry,
      toolCtx: buildToolContext(state, 'turn'),
      config: graphConfig,
      cache: roundCache,
    });

    const nextState: Partial<AgentGraphState> = {
      ...result.nextState,
      pendingToolCalls: [],
      pendingAssistantText: '',
      traceEvents: [
        ...state.traceEvents,
        {
          type: 'execute_tools',
          timestamp: nowIso(),
          details: {
            requestedCallCount: state.pendingToolCalls.length,
          },
        },
      ],
    };

    if (result.approvalSignal) {
      const materialized = await createOrReuseApprovalReviewRequestFromSignal({
        threadId: state.threadId,
        originTraceId: state.originTraceId,
        signal: result.approvalSignal,
      });
      return {
        ...nextState,
        replyText:
          result.approvalSignal.payload.visibleReplyText?.trim() ||
          (materialized.coalesced
            ? 'That request is already awaiting review.'
            : 'I queued that for approval.'),
        graphStatus: 'interrupted',
        terminationReason: 'approval_interrupt',
        approvalInterrupt: {
          payload: result.approvalSignal.payload,
          requestId: materialized.request.id,
          coalesced: materialized.coalesced,
          expiresAtIso: materialized.request.expiresAt.toISOString(),
        },
      };
    }

    const latestRound = result.nextState.roundEvents?.[result.nextState.roundEvents.length - 1];
    const elapsedMs = Date.now() - state.startedAtEpochMs;
    const stepLimitReached = (result.nextState.roundsCompleted ?? state.roundsCompleted) >= graphConfig.maxSteps;
    const timedOut = elapsedMs >= graphConfig.maxDurationMs;
    const stagnationTriggered = latestRound?.stagnation?.triggered === true;

    return {
      ...nextState,
      terminationReason:
        stagnationTriggered
          ? 'stagnation'
          : timedOut
            ? 'graph_timeout'
            : stepLimitReached
              ? 'step_limit'
              : state.terminationReason,
    };
  };

  const forcedFinalizeNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    let replyText =
      'I could not finalize a plain-text answer after tool execution. Please try again.';
    const finalization: ToolCallFinalizationEvent = {
      attempted: true,
      succeeded: true,
      fallbackUsed: false,
      returnedToolCallCount: 0,
      completedAt: nowIso(),
      terminationReason: state.terminationReason,
    };

    try {
      const prepared = buildGraphChatRequest({
        messages: [
          ...state.messages,
          {
            role: 'system',
            content:
              'Tool-call steps are exhausted. Do not call tools. ' +
              'Return one final plain-text answer grounded only in prior tool results and context.',
          },
        ],
        model: state.model,
        apiKey: state.apiKey,
        temperature: Math.max(0, state.temperature - 0.1),
        timeoutMs: state.timeoutMs,
        maxTokens: state.maxTokens,
        tools: undefined,
        toolChoice: undefined,
      });
      const response = await client.chat(prepared.request);
      finalization.rebudgeting = prepared.rebudgeting;
      finalization.returnedToolCallCount = response.toolCalls?.length ?? 0;
      finalization.completedAt = nowIso();
      if ((response.toolCalls?.length ?? 0) > 0) {
        finalization.succeeded = false;
        finalization.fallbackUsed = true;
      } else {
        replyText = response.text;
      }
    } catch (error) {
      logger.warn({ error, traceId: state.traceId }, 'Agent graph forced finalization failed');
      finalization.succeeded = false;
      finalization.fallbackUsed = true;
      finalization.completedAt = nowIso();
    }

    return {
      replyText,
      finalization,
      traceEvents: [
        ...state.traceEvents,
        {
          type: 'forced_finalize',
          timestamp: nowIso(),
          details: finalization,
        },
      ],
    };
  };

  const approvalFinalizeNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    if (!state.approvalInterrupt?.requestId) {
      return {};
    }

    const resume = interrupt({
      requestId: state.approvalInterrupt.requestId,
      kind: state.approvalInterrupt.payload.kind,
      coalesced: state.approvalInterrupt.coalesced,
      expiresAtIso: state.approvalInterrupt.expiresAtIso,
    }) as ApprovalResumeInput;

    if (resume.status === 'approved') {
      await executeApprovedReviewRequest({
        requestId: state.approvalInterrupt.requestId,
        reviewerId: resume.reviewerId ?? null,
        decisionReasonText: resume.decisionReasonText ?? null,
        resumeTraceId: resume.resumeTraceId ?? null,
      });
    }

    return {
      graphStatus: 'running',
      traceId: resume.resumeTraceId?.trim() || state.traceId,
      approvalInterrupt: null,
      traceEvents: [
        ...state.traceEvents,
        {
          type: 'approval_finalize',
          timestamp: nowIso(),
          details: {
            requestId: state.approvalInterrupt.requestId,
            decision: resume.status,
            reviewerId: resume.reviewerId ?? null,
          },
        },
      ],
    };
  };

  const finalizeTurnNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    roundCacheByThread.delete(state.threadId);
    return {
      graphStatus: state.graphStatus === 'failed' ? 'failed' : 'completed',
      pendingToolCalls: [],
      pendingAssistantText: '',
    };
  };

  return new StateGraph(AgentGraphStateAnnotation)
    .addNode('call_model', callModelNode)
    .addNode('execute_tools', executeToolsNode)
    .addNode('forced_finalize', forcedFinalizeNode)
    .addNode('approval_finalize', approvalFinalizeNode)
    .addNode('finalize_turn', finalizeTurnNode)
    .addEdge(START, 'call_model')
    .addConditionalEdges('call_model', (state) => {
      if (state.pendingToolCalls.length > 0) {
        return 'execute_tools';
      }
      if (
        state.terminationReason === 'graph_timeout' ||
        state.terminationReason === 'step_limit' ||
        state.terminationReason === 'stagnation'
      ) {
        return 'forced_finalize';
      }
      return 'finalize_turn';
    })
    .addConditionalEdges('execute_tools', (state) => {
      if (state.approvalInterrupt?.requestId) {
        return 'approval_finalize';
      }
      if (
        state.terminationReason === 'graph_timeout' ||
        state.terminationReason === 'step_limit' ||
        state.terminationReason === 'stagnation'
      ) {
        return 'forced_finalize';
      }
      return 'call_model';
    })
    .addEdge('forced_finalize', 'finalize_turn')
    .addEdge('approval_finalize', 'finalize_turn')
    .addEdge('finalize_turn', END)
    .compile({
      checkpointer,
      name: 'sage_agent_graph',
      description: 'Sage custom LangGraph runtime for model/tool execution and approval interrupts.',
    });
}

async function createRuntime(): Promise<AgentGraphRuntime> {
  const checkpointer =
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined
      ? new MemorySaver()
      : PostgresSaver.fromConnString(appConfig.DATABASE_URL, {
          schema: 'langgraph',
        });
  if ('setup' in checkpointer && typeof checkpointer.setup === 'function') {
    await checkpointer.setup();
  }
  const config = buildAgentGraphConfig();
  return {
    graph: createCompiledAgentGraph(checkpointer, config),
    checkpointer,
    config,
  };
}

async function getRuntime(): Promise<AgentGraphRuntime> {
  if (runtimeInstance) {
    return runtimeInstance;
  }
  if (!runtimePromise) {
    runtimePromise = createRuntime()
      .then((runtime) => {
        runtimeInstance = runtime;
        return runtime;
      })
      .catch((error) => {
        runtimePromise = null;
        throw error;
      });
  }
  return runtimePromise;
}

export async function initializeAgentGraphRuntime(): Promise<void> {
  await getRuntime();
}

export async function shutdownAgentGraphRuntime(): Promise<void> {
  const runtime = runtimeInstance;
  runtimeInstance = null;
  runtimePromise = null;
  if (runtime && 'end' in runtime.checkpointer && typeof runtime.checkpointer.end === 'function') {
    await runtime.checkpointer.end();
  }
}

export async function runAgentGraphTurn(params: StartAgentGraphTurnParams): Promise<AgentGraphTurnResult> {
  const runtime = await getRuntime();
  const initialState: AgentGraphState = {
    traceId: params.traceId,
    originTraceId: params.traceId,
    threadId: params.traceId,
    userId: params.userId,
    channelId: params.channelId,
    guildId: params.guildId,
    apiKey: params.apiKey,
    model: params.model,
    temperature: params.temperature,
    timeoutMs: params.timeoutMs,
    maxTokens: params.maxTokens,
    invokedBy: params.invokedBy,
    invokerIsAdmin: params.invokerIsAdmin,
    messages: [...params.messages],
    activeToolNames: [...params.activeToolNames],
    routeKind: params.routeKind,
    toolExecutionProfile: params.toolExecutionProfile,
    currentTurn: params.currentTurn,
    replyTarget: params.replyTarget,
    pendingToolCalls: [],
    pendingAssistantText: '',
    replyText: '',
    toolResults: [],
    files: [],
    roundsCompleted: 0,
    deduplicatedCallCount: 0,
    truncatedCallCount: 0,
    guardrailBlockedCallCount: 0,
    cancellationCount: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      fallbackUsed: false,
      returnedToolCallCount: 0,
      completedAt: nowIso(),
      terminationReason: 'assistant_reply',
    },
    terminationReason: 'assistant_reply',
    previousExecutedBatchFingerprint: null,
    previousSuccessfulReadObservationFingerprint: null,
    pendingApprovalResultsByFingerprint: {},
    callAttemptLedger: {},
    sideEffectExecutedInLoop: false,
    graphStatus: 'running',
    startedAtEpochMs: Date.now(),
    approvalInterrupt: null,
    traceEvents: [],
  };
  const output = await runtime.graph.invoke(
    initialState as unknown as Parameters<typeof runtime.graph.invoke>[0],
    buildRunnableConfig(params.traceId, runtime.config.recursionLimit),
  ) as unknown as AgentGraphState;
  return normalizeGraphResult(output);
}

export async function resumeAgentGraphTurn(
  params: ResumeAgentGraphTurnParams,
): Promise<AgentGraphTurnResult> {
  const runtime = await getRuntime();
  const output = await runtime.graph.invoke(
    new Command({
      resume: {
        status: params.decision,
        reviewerId: params.reviewerId ?? null,
        decisionReasonText: params.decisionReasonText ?? null,
        resumeTraceId: params.resumeTraceId ?? null,
      } satisfies ApprovalResumeInput,
    }),
    buildRunnableConfig(params.threadId, runtime.config.recursionLimit),
  ) as unknown as AgentGraphState;
  return normalizeGraphResult(output);
}

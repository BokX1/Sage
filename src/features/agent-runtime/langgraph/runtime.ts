import crypto from 'crypto';
import {
  Command,
  END,
  GraphRecursionError,
  MemorySaver,
  MessagesValue,
  ReducedValue,
  START,
  StateGraph,
  StateSchema,
  getConfig,
  interrupt,
  isInterrupted,
  task,
} from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { getModelBudgetConfig } from '../../../platform/llm/model-budget-config';
import { estimateMessagesTokens, planBudget } from '../../../platform/llm/context-budgeter';
import { AiProviderChatModel } from '../../../platform/llm/ai-provider-chat-model';
import {
  extractMessageText,
  getLastAiToolCalls,
  toLangChainMessages,
  toLlmMessages,
} from '../../../platform/llm/langchain-interop';
import type { LLMChatMessage } from '../../../platform/llm/llm-types';
import { config as appConfig } from '../../../platform/config/env';
import { logger } from '../../../platform/logging/logger';
import { createOrReuseApprovalReviewRequestFromSignal } from '../../admin/adminActionService';
import {
  consumeGraphContinuationSession,
  createGraphContinuationSession,
  GRAPH_CONTINUATION_MAX_WINDOWS,
} from '../graphContinuationRepo';
import { scrubFinalReplyText } from '../finalReplyScrubber';
import type { ToolResult } from '../toolCallExecution';
import type { ToolExecutionContext } from '../toolRegistry';
import { ApprovalRequiredSignal } from '../toolControlSignals';
import { createAgentRunTelemetry } from '../observability/langsmith';
import { buildContinuationUnavailableReply } from '../visibleReply';
import { buildToolCacheKey } from '../toolCache';
import { globalToolRegistry } from '../toolRegistry';
import { buildAgentGraphConfig, type AgentGraphConfig } from './config';
import {
  buildActiveToolCatalog,
  executeApprovedReviewTask,
  executeDurableToolTask,
  isReadOnlyToolCall,
  prepareToolApprovalInterrupt,
  type GraphToolCallDescriptor,
} from './nativeTools';
import type {
  GraphCompletionKind,
  GraphContextFrame,
  GraphDeliveryDisposition,
  AgentGraphPersistedContext,
  AgentGraphRuntimeContext,
  AgentGraphState,
  ApprovalResumeDecision,
  GraphStopReason,
  GraphToolDeliveryState,
  GraphResumeInput,
  GraphRebudgetEvent,
  SerializedToolResult,
  ToolCallFinalizationEvent,
  ToolCallRoundEvent,
} from './types';

const GraphToolCallDescriptorSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  args: z.unknown(),
});

const GraphToolFileSchema = z.object({
  name: z.string(),
  dataBase64: z.string(),
  mimetype: z.string().optional(),
});

const SerializedToolResultSchema = z.object({
  name: z.string(),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  errorType: z.string().optional(),
  latencyMs: z.number(),
  attachmentsMeta: z
    .array(
      z.object({
        filename: z.string(),
        mimetype: z.string().optional(),
        byteLength: z.number(),
      }),
    )
    .optional(),
});

const ApprovalInterruptRequestStateSchema = z.object({
  requestId: z.string(),
  call: GraphToolCallDescriptorSchema,
  payload: z.unknown(),
  coalesced: z.boolean().optional(),
  expiresAtIso: z.string().optional(),
});

const GraphRebudgetEventSchema = z.object({
  beforeCount: z.number(),
  afterCount: z.number(),
  estimatedTokensBefore: z.number(),
  estimatedTokensAfter: z.number(),
  availableInputTokens: z.number(),
  reservedOutputTokens: z.number(),
  notes: z.array(z.string()),
  trimmed: z.boolean(),
});

const ToolCallRoundEventSchema = z.object({
  round: z.number(),
  requestedCallCount: z.number(),
  executedCallCount: z.number(),
  deduplicatedCallCount: z.number(),
  uniqueCallCount: z.number(),
  skippedDuplicateCallCount: z.number(),
  overLimitCallCount: z.number(),
  completedAt: z.string(),
  guardReason: z.enum(['too_many_tool_calls', 'repeated_identical_batch', 'recursion_limit']).optional(),
  rebudgeting: GraphRebudgetEventSchema.optional(),
});

const ToolCallFinalizationEventSchema = z.object({
  attempted: z.boolean(),
  succeeded: z.boolean(),
  completedAt: z.string(),
  stopReason: z.enum([
    'verified_closeout',
    'approval_interrupt',
    'step_window_exhausted',
    'graph_timeout',
    'max_windows_reached',
    'continuation_expired',
    'loop_guard',
    'protocol_violation',
  ]),
  completionKind: z.enum([
    'final_answer',
    'clarification_question',
    'delivered_via_tool',
    'pause_handoff',
    'approval_handoff',
    'loop_guard',
  ]),
  deliveryDisposition: z.enum([
    'chat_reply',
    'tool_delivered',
    'approval_governance_only',
    'chat_reply_with_continue',
  ]),
  protocolRepairCount: z.number(),
  toolDeliveredFinal: z.boolean(),
  contextFrame: z
    .object({
      objective: z.string(),
      verifiedFacts: z.array(z.string()),
      completedActions: z.array(z.string()),
      openQuestions: z.array(z.string()),
      pendingApprovals: z.array(z.string()),
      deliveryState: z.enum(['none', 'final_message', 'governance_only']),
      nextAction: z.string(),
    })
    .optional(),
  rebudgeting: GraphRebudgetEventSchema.optional(),
});

const GraphToolDeliveryStateSchema = z.object({
  toolName: z.string(),
  effectKind: z.enum(['final_message', 'governance_only']),
  visibleSummary: z.string().optional(),
});

const GraphContextFrameSchema = z.object({
  objective: z.string(),
  verifiedFacts: z.array(z.string()).default([]),
  completedActions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  pendingApprovals: z.array(z.string()).default([]),
  deliveryState: z.enum(['none', 'final_message', 'governance_only']).default('none'),
  nextAction: z.string(),
});

const ApprovalInterruptStateSchema = z.object({
  kind: z.literal('approval_review'),
  requestId: z.string(),
  batchId: z.string(),
  requests: z.array(ApprovalInterruptRequestStateSchema).min(1),
});

const ContinuePromptInterruptStateSchema = z.object({
  kind: z.literal('continue_prompt'),
  continuationId: z.string(),
  pauseReason: z.enum(['graph_timeout', 'step_window_exhausted']),
  requestedByUserId: z.string(),
  channelId: z.string(),
  guildId: z.string().nullable(),
  summaryText: z.string(),
  completedWindows: z.number(),
  maxWindows: z.number(),
  expiresAtIso: z.string(),
  resumeNode: z.enum(['tool_call_turn', 'route_tool_phase']),
});

const ApprovalResolutionStateSchema = z.object({
  kind: z.literal('approval_review'),
  requestId: z.string(),
  decision: z.enum(['approved', 'rejected', 'expired']),
  status: z.enum(['approved', 'rejected', 'expired', 'executed', 'failed']),
  reviewerId: z.string().nullable().optional(),
  decisionReasonText: z.string().nullable().optional(),
  errorText: z.string().nullable().optional(),
});

const ApprovalBatchResolutionStateSchema = z.object({
  kind: z.literal('approval_review_batch'),
  batchId: z.string(),
  resolutions: z.array(ApprovalResolutionStateSchema).min(1),
});

const ContinuePromptResolutionStateSchema = z.object({
  kind: z.literal('continue_prompt'),
  continuationId: z.string(),
  decision: z.enum(['continue', 'expired']),
  resumedByUserId: z.string().nullable().optional(),
});

const AgentGraphRuntimeSnapshotSchema = z.object({
  traceId: z.string(),
  originTraceId: z.string(),
  threadId: z.string(),
  userId: z.string(),
  channelId: z.string(),
  guildId: z.string().nullable(),
  model: z.string().optional(),
  temperature: z.number(),
  timeoutMs: z.number().optional(),
  maxTokens: z.number().optional(),
  invokedBy: z.enum(['mention', 'reply', 'wakeword', 'autopilot', 'component']).optional(),
  invokerIsAdmin: z.boolean().optional(),
  invokerCanModerate: z.boolean().optional(),
  activeToolNames: z.array(z.string()),
  routeKind: z.string(),
  currentTurn: z.unknown(),
  replyTarget: z.unknown().nullable(),
});

const AgentGraphConfigurableSchema = z
  .object({
    traceId: z.string().optional(),
    originTraceId: z.string().optional(),
    threadId: z.string().optional(),
    userId: z.string().optional(),
    channelId: z.string().optional(),
    guildId: z.string().nullable().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().optional(),
    timeoutMs: z.number().optional(),
    maxTokens: z.number().optional(),
    invokedBy: z.enum(['mention', 'reply', 'wakeword', 'autopilot', 'component']).optional(),
    invokerIsAdmin: z.boolean().optional(),
    invokerCanModerate: z.boolean().optional(),
    activeToolNames: z.array(z.string()).optional(),
    routeKind: z.string().optional(),
    currentTurn: z.unknown().optional(),
    replyTarget: z.unknown().optional(),
  })
  .strip();

const AgentGraphStateSchema = new StateSchema({
  messages: MessagesValue,
  resumeContext: AgentGraphRuntimeSnapshotSchema,
  pendingReadCalls: z.array(GraphToolCallDescriptorSchema).default([]),
  pendingReadExecutionCalls: z.array(GraphToolCallDescriptorSchema).default([]),
  pendingWriteCalls: z.array(GraphToolCallDescriptorSchema).default([]),
  replyText: z.string().default(''),
  toolResults: new ReducedValue(z.array(SerializedToolResultSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  files: new ReducedValue(z.array(GraphToolFileSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  roundsCompleted: z.number().default(0),
  completedWindows: z.number().default(0),
  totalRoundsCompleted: z.number().default(0),
  deduplicatedCallCount: new ReducedValue(z.number().default(0), {
    reducer: (left, right) => left + right,
  }),
  lastToolBatchFingerprint: z.string().nullable().default(null),
  consecutiveIdenticalToolBatches: z.number().default(0),
  loopGuardRecoveries: z.number().default(0),
  roundEvents: new ReducedValue(z.array(ToolCallRoundEventSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  finalization: ToolCallFinalizationEventSchema.default({
    attempted: false,
    succeeded: true,
    completedAt: new Date(0).toISOString(),
    stopReason: 'verified_closeout',
    completionKind: 'final_answer',
    deliveryDisposition: 'chat_reply',
    protocolRepairCount: 0,
    toolDeliveredFinal: false,
  }),
  completionKind: z
    .enum([
      'final_answer',
      'clarification_question',
      'delivered_via_tool',
      'pause_handoff',
      'approval_handoff',
      'loop_guard',
    ])
    .nullable()
    .default(null),
  stopReason: z
    .enum([
      'verified_closeout',
      'approval_interrupt',
      'step_window_exhausted',
      'graph_timeout',
      'max_windows_reached',
      'continuation_expired',
      'loop_guard',
      'protocol_violation',
    ])
    .default('verified_closeout'),
  deliveryDisposition: z
    .enum([
      'chat_reply',
      'tool_delivered',
      'approval_governance_only',
      'chat_reply_with_continue',
    ])
    .default('chat_reply'),
  protocolRepairCount: z.number().default(0),
  finalToolDelivery: z.union([GraphToolDeliveryStateSchema, z.null()]).default(null),
  contextFrame: GraphContextFrameSchema.default({
    objective: 'Finish the current user request cleanly.',
    verifiedFacts: [],
    completedActions: [],
    openQuestions: [],
    pendingApprovals: [],
    deliveryState: 'none',
    nextAction: 'Decide the next best step.',
  }),
  graphStatus: z.enum(['running', 'interrupted', 'completed', 'failed']).default('running'),
  activeWindowDurationMs: z.number().default(0),
  pendingInterrupt: z
    .union([ApprovalInterruptStateSchema, ContinuePromptInterruptStateSchema, z.null()])
    .default(null),
  interruptResolution: z
    .union([ApprovalResolutionStateSchema, ApprovalBatchResolutionStateSchema, ContinuePromptResolutionStateSchema, z.null()])
    .default(null),
});

type GraphNodeName =
  | 'decide_turn'
  | 'tool_call_turn'
  | 'route_tool_phase'
  | 'execute_read_tools'
  | 'approval_gate'
  | 'closeout_turn'
  | 'pause_for_continue'
  | 'resume_interrupt'
  | 'finalize_turn';

const EMPTY_RUNTIME_CONTEXT: AgentGraphRuntimeContext = {
  traceId: '',
  originTraceId: '',
  threadId: '',
  userId: '',
  channelId: '',
  guildId: null,
  apiKey: undefined,
  model: undefined,
  temperature: 0.6,
  timeoutMs: undefined,
  maxTokens: undefined,
  invokedBy: 'mention',
  invokerIsAdmin: undefined,
  activeToolNames: [],
  routeKind: 'single',
  currentTurn: null,
  replyTarget: null,
};

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
  messages: BaseMessage[];
  activeToolNames: string[];
  routeKind: string;
  currentTurn: unknown;
  replyTarget: unknown;
  invokedBy?: AgentGraphRuntimeContext['invokedBy'];
  invokerIsAdmin?: boolean;
  invokerCanModerate?: boolean;
}

export interface ResumeAgentGraphTurnParams {
  threadId: string;
  resume: GraphResumeInput;
  context?: Partial<AgentGraphRuntimeContext>;
}

export interface AgentGraphTurnResult {
  replyText: string;
  toolResults: ToolResult[];
  files: Array<{ attachment: Buffer; name: string }>;
  roundsCompleted: number;
  completedWindows: number;
  totalRoundsCompleted: number;
  deduplicatedCallCount: number;
  roundEvents: ToolCallRoundEvent[];
  finalization: ToolCallFinalizationEvent;
  completionKind: GraphCompletionKind | null;
  stopReason: GraphStopReason;
  deliveryDisposition: GraphDeliveryDisposition;
  protocolRepairCount: number;
  toolDeliveredFinal: boolean;
  contextFrame: GraphContextFrame;
  graphStatus: AgentGraphState['graphStatus'];
  pendingInterrupt: AgentGraphState['pendingInterrupt'];
  interruptResolution: AgentGraphState['interruptResolution'];
  langSmithRunId: string | null;
  langSmithTraceId: string | null;
}

interface AgentGraphRuntime {
  graph: ReturnType<typeof createCompiledAgentGraph>;
  checkpointer: PostgresSaver | MemorySaver;
  config: AgentGraphConfig;
}

let runtimePromise: Promise<AgentGraphRuntime> | null = null;
let runtimeInstance: AgentGraphRuntime | null = null;

function findLatestAssistantText(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!AIMessage.isInstance(message)) {
      continue;
    }
    const text = extractMessageText(message).trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function buildDefaultFinalization(): ToolCallFinalizationEvent {
  return {
    attempted: false,
    succeeded: true,
    completedAt: new Date(0).toISOString(),
    stopReason: 'verified_closeout',
    completionKind: 'final_answer',
    deliveryDisposition: 'chat_reply',
    protocolRepairCount: 0,
    toolDeliveredFinal: false,
  };
}

function buildDefaultContextFrame(): GraphContextFrame {
  return {
    objective: 'Finish the current user request cleanly.',
    verifiedFacts: [],
    completedActions: [],
    openQuestions: [],
    pendingApprovals: [],
    deliveryState: 'none',
    nextAction: 'Decide the next best step.',
  };
}

function buildToolNameRollup(results: Array<Pick<SerializedToolResult, 'name'>>): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    counts.set(result.name, (counts.get(result.name) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
    .join(', ');
}

function buildDeterministicRuntimeSummary(
  state: Pick<AgentGraphState, 'toolResults' | 'messages' | 'replyText'>,
  options?: {
    paused?: boolean;
    continuationLimitReached?: boolean;
  },
): string {
  const parts: string[] = [];
  const successful = state.toolResults.filter((result) => result.success);
  const failed = state.toolResults.filter((result) => !result.success);
  const latestAssistantText = scrubFinalReplyText({
    replyText: findLatestAssistantText(state.messages as BaseMessage[]),
  });
  const cleanedReplyText = scrubFinalReplyText({
    replyText: state.replyText,
  });

  if (options?.continuationLimitReached) {
    parts.push('I hit the continuation limit for this request.');
    parts.push('Next: send a new message if you want me to keep going from this state.');
  } else if (options?.paused) {
    parts.push('I need another continuation window to keep going from this state.');
    parts.push('Next: press Continue below if you want me to keep going from the current state.');
  }

  if (successful.length > 0) {
    parts.push(
      `Completed so far: ${successful.length} tool call${successful.length === 1 ? '' : 's'} (${buildToolNameRollup(successful)}).`,
    );
  }
  if (failed.length > 0) {
    parts.push(
      `Problems encountered: ${failed.length} tool call${failed.length === 1 ? '' : 's'} (${buildToolNameRollup(failed)}).`,
    );
  }
  if (latestAssistantText) {
    parts.push(`Latest assistant draft: ${latestAssistantText}`);
  } else if (cleanedReplyText) {
    parts.push(cleanedReplyText);
  }
  if (parts.length === 0) {
    parts.push(
      options?.paused
        ? 'I need another continuation window to keep going from this state.'
        : 'I completed part of the request but do not have enough structured output to finalize cleanly.',
    );
  }

  return parts.join('\n\n').trim();
}

const WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS = 320;
const WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS = 12_000;
const WINDOW_CLOSEOUT_TEMPERATURE = 0.2;

function buildWindowCloseoutPromptMessages(params: {
  state: AgentGraphState;
  runtimeContext: AgentGraphRuntimeContext;
}): LLMChatMessage[] {
  const prepared = buildRebudgetingEvent(
    params.state.messages as BaseMessage[],
    params.runtimeContext.model,
    Math.min(
      params.runtimeContext.maxTokens ?? WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS,
      WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS,
    ),
  );

  return [
    ...toLlmMessages(prepared.trimmedMessages),
    {
      role: 'user',
      content:
        'Write a short user-visible progress update for Sage before this run pauses. ' +
        'Summarize the most important concrete progress so far and what remains next. ' +
        'Do not mention tools, tool counts, steps, windows, budgets, prompts, retries, or internal runtime details. ' +
        'Do not mention buttons or next-step instructions. ' +
        'Tools are unavailable for this response.',
    },
  ];
}

function wrapWindowCloseoutReply(params: {
  summaryBody: string;
  continuationLimitReached?: boolean;
}): string {
  const parts = [params.summaryBody.trim()].filter((part) => part.length > 0);
  if (params.continuationLimitReached) {
    parts.push('I hit the continuation limit for this request.');
    parts.push('Next: send a new message if you want me to keep going from this state.');
  } else {
    parts.push('Next: press Continue below if you want me to keep going from the current state.');
  }
  return parts.join('\n\n').trim();
}

async function buildWindowCloseoutSummary(params: {
  state: AgentGraphState;
  runtimeContext: AgentGraphRuntimeContext;
  toolContext: ToolExecutionContext;
  graphConfig: AgentGraphConfig;
  pauseReason: 'graph_timeout' | 'step_window_exhausted';
  continuationLimitReached?: boolean;
}): Promise<{
  text: string;
  usedModel: boolean;
  latencyMs: number;
}> {
  const deterministic = buildDeterministicRuntimeSummary(
    params.state,
    params.continuationLimitReached
      ? { continuationLimitReached: true }
      : { paused: true },
  );
  if (params.pauseReason === 'graph_timeout') {
    return { text: deterministic, usedModel: false, latencyMs: 0 };
  }

  try {
    const response = await invokeAgentModelTask({
      messages: buildWindowCloseoutPromptMessages({
        state: params.state,
        runtimeContext: params.runtimeContext,
      }),
      activeToolNames: [],
      toolContext: params.toolContext,
      timeoutMs: params.graphConfig.toolTimeoutMs,
      model: params.runtimeContext.model,
      apiKey: params.runtimeContext.apiKey,
      temperature: WINDOW_CLOSEOUT_TEMPERATURE,
      requestTimeoutMs: Math.min(
        params.runtimeContext.timeoutMs ?? WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS,
        WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS,
      ),
      maxTokens: Math.min(
        params.runtimeContext.maxTokens ?? params.graphConfig.maxOutputTokens,
        WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS,
      ),
    });
    const [aiMessageCandidate] = toLangChainMessages([response.message]);
    const aiMessage = AIMessage.isInstance(aiMessageCandidate)
      ? aiMessageCandidate
      : new AIMessage({ content: extractMessageText(aiMessageCandidate as BaseMessage) });
    const summaryBody = scrubFinalReplyText({
      replyText: extractMessageText(aiMessage),
    });
    if (summaryBody) {
      return {
        text: wrapWindowCloseoutReply({
          summaryBody,
          continuationLimitReached: params.continuationLimitReached,
        }),
        usedModel: true,
        latencyMs: response.latencyMs,
      };
    }
  } catch (error) {
    logger.warn(
      {
        error,
        traceId: params.runtimeContext.traceId,
        threadId: params.runtimeContext.threadId,
        continuationLimitReached: params.continuationLimitReached ?? false,
      },
      'Window closeout summary model call failed; using deterministic summary fallback',
    );
  }

  return { text: deterministic, usedModel: false, latencyMs: 0 };
}

function createRuntimeContext(params: StartAgentGraphTurnParams): AgentGraphRuntimeContext {
  return {
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
    invokerCanModerate: params.invokerCanModerate,
    activeToolNames: [...params.activeToolNames],
    routeKind: params.routeKind,
    currentTurn: params.currentTurn,
    replyTarget: params.replyTarget ?? null,
  };
}

function snapshotRuntimeContext(runtimeContext: AgentGraphRuntimeContext): AgentGraphPersistedContext {
  const { apiKey, ...persisted } = runtimeContext;
  void apiKey;
  return persisted;
}

function buildRunnableConfig(params: {
  threadId: string;
  recursionLimit: number;
  runId: string;
  runName: string;
  context?: Partial<AgentGraphRuntimeContext>;
  callbacks?: RunnableConfig['callbacks'];
  tags?: string[];
  metadata?: Record<string, unknown>;
}): RunnableConfig {
  return {
    configurable: {
      thread_id: params.threadId,
      ...(params.context ?? {}),
    },
    callbacks: params.callbacks,
    tags: params.tags,
    metadata: params.metadata,
    runId: params.runId,
    runName: params.runName,
    recursionLimit: params.recursionLimit,
    durability: 'sync',
  } as RunnableConfig;
}

function resolveRuntimeContext(state: AgentGraphState, config: RunnableConfig): AgentGraphRuntimeContext {
  const configured = AgentGraphConfigurableSchema.parse(config.configurable ?? {});
  return {
    ...EMPTY_RUNTIME_CONTEXT,
    ...state.resumeContext,
    ...Object.fromEntries(Object.entries(configured).filter(([, value]) => value !== undefined)),
  } as AgentGraphRuntimeContext;
}

function deserializeToolResults(results: SerializedToolResult[]): ToolResult[] {
  return results.map((result) => ({
    ...result,
    attachments: undefined,
  }));
}

function decodeGraphFiles(files: AgentGraphState['files']): Array<{ attachment: Buffer; name: string }> {
  return files.map((file) => ({
    attachment: Buffer.from(file.dataBase64, 'base64'),
    name: file.name,
  }));
}

function normalizeGraphResult(
  state: AgentGraphState,
  langSmith: { langSmithRunId: string | null; langSmithTraceId: string | null },
): AgentGraphTurnResult {
  return {
    replyText: state.replyText,
    toolResults: deserializeToolResults(state.toolResults),
    files: decodeGraphFiles(state.files),
    roundsCompleted: state.roundsCompleted,
    completedWindows: state.completedWindows,
    totalRoundsCompleted: state.totalRoundsCompleted,
    deduplicatedCallCount: state.deduplicatedCallCount,
    roundEvents: state.roundEvents,
    finalization: state.finalization,
    completionKind: state.completionKind,
    stopReason: state.stopReason,
    deliveryDisposition: state.deliveryDisposition,
    protocolRepairCount: state.protocolRepairCount,
    toolDeliveredFinal: state.finalization.toolDeliveredFinal,
    contextFrame: state.contextFrame,
    graphStatus: state.graphStatus,
    pendingInterrupt: state.pendingInterrupt,
    interruptResolution: state.interruptResolution,
    langSmithRunId: langSmith.langSmithRunId,
    langSmithTraceId: langSmith.langSmithTraceId,
  };
}

function buildRebudgetingEvent(
  messages: BaseMessage[],
  model: string | undefined,
  maxTokens: number | undefined,
): { trimmedMessages: BaseMessage[]; rebudgeting: GraphRebudgetEvent } {
  const preparedMessages = toLlmMessages(messages);
  const modelConfig = getModelBudgetConfig(resolveGraphModelId(model));
  const budgetPlan = planBudget(modelConfig, {
    reservedOutputTokens: maxTokens ?? modelConfig.maxOutputTokens,
  });
  const estimatedTokens = estimateMessagesTokens(preparedMessages, modelConfig.estimation);

  return {
    trimmedMessages: toLangChainMessages(preparedMessages),
    rebudgeting: {
      beforeCount: preparedMessages.length,
      afterCount: preparedMessages.length,
      estimatedTokensBefore: estimatedTokens,
      estimatedTokensAfter: estimatedTokens,
      availableInputTokens: budgetPlan.availableInputTokens,
      reservedOutputTokens: budgetPlan.reservedOutputTokens,
      notes:
        estimatedTokens > budgetPlan.availableInputTokens
          ? ['Sage no longer re-budgets graph messages before provider calls; overflow is deferred to the provider/runtime boundary.']
          : [],
      trimmed: false,
    },
  };
}

function resolveGraphModelId(model: string | undefined): string {
  const resolvedModel = model?.trim() || appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
  if (!resolvedModel) {
    throw new Error('AI_PROVIDER_MAIN_AGENT_MODEL must be configured before the agent graph can run.');
  }
  return resolvedModel;
}

function shouldRetryModelInvokeError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  if (
    /401|403|404|unauthorized|forbidden|authentication required|invalid api key|unknown api key|model .*not found|unknown model|unsupported model|validation failed|invalid request|bad request/i.test(
      text,
    )
  ) {
    return false;
  }

  return /408|409|425|429|500|502|503|504|timeout|timed out|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|socket hang up|rate limit|provider offline|provider unavailable|upstream/i.test(
    text,
  );
}

const MODEL_INVOKE_RETRY_POLICY = {
  maxAttempts: 2,
  initialInterval: 250,
  backoffFactor: 2,
  maxInterval: 1_000,
  jitter: true,
  retryOn: shouldRetryModelInvokeError,
  logWarning: true,
} as const;

function createGraphChatModel(params: {
  model?: string;
  apiKey?: string;
  temperature: number;
  timeoutMs?: number;
  maxTokens?: number;
}): AiProviderChatModel {
  const model = resolveGraphModelId(params.model);

  return new AiProviderChatModel({
    baseUrl: appConfig.AI_PROVIDER_BASE_URL,
    model,
    apiKey: params.apiKey ?? appConfig.AI_PROVIDER_API_KEY,
    temperature: params.temperature,
    timeout: params.timeoutMs,
    maxTokens: params.maxTokens,
  });
}

interface DurableModelInvokeInput {
  messages: LLMChatMessage[];
  activeToolNames: string[];
  toolContext: ToolExecutionContext;
  timeoutMs: number;
  model?: string;
  apiKey?: string;
  temperature: number;
  requestTimeoutMs?: number;
  maxTokens?: number;
}

interface DurableModelInvokeOutput {
  message: LLMChatMessage;
  latencyMs: number;
}

interface DurableApprovalMaterializationOutput {
  requestId: string;
  threadId: string;
  coalesced: boolean;
  expiresAtIso: string;
}

interface DurableContinuationInterruptOutput {
  id: string;
  pauseReason: 'graph_timeout' | 'step_window_exhausted';
  requestedByUserId: string;
  channelId: string;
  guildId: string | null;
  summaryText: string;
  completedWindows: number;
  maxWindows: number;
  expiresAtIso: string;
  resumeNode: 'tool_call_turn' | 'route_tool_phase';
}

interface DurableGraphTimestampOutput {
  iso: string;
}

const TURN_CLOSEOUT_TOOL_NAME = 'sage_finish_turn';
const TURN_PROTOCOL_MAX_REPAIRS = 1;

const TurnCloseoutSchema = z.object({
  kind: z.enum(['final_answer', 'clarification_question', 'delivered_via_tool']),
  message: z.string().optional(),
});

function buildTurnCloseoutTool(): DynamicStructuredTool {
  return tool(
    async () => 'This internal tool is intercepted by the Sage runtime.',
    {
      name: TURN_CLOSEOUT_TOOL_NAME,
      description:
        'Close the turn. Use final_answer with a user-visible message, clarification_question with one short question, or delivered_via_tool after a final-delivery tool already posted the answer.',
      schema: TurnCloseoutSchema,
    },
  ) as DynamicStructuredTool;
}

function buildAssistantTurnProtocolMessage(): LLMChatMessage {
  return {
    role: 'system',
    content: [
      'Assistant turn protocol:',
      `- Use provider-native tool calls only.`,
      `- Use external tools to gather evidence or take actions.`,
      `- Use ${TURN_CLOSEOUT_TOOL_NAME} to close the turn with final_answer, clarification_question, or delivered_via_tool.`,
      '- Do not send a plain assistant answer without a tool call.',
      '- Do not mix external tools with the closeout tool in the same assistant response.',
    ].join('\n'),
  };
}

function buildProtocolViolationReply(params: {
  detail: string;
  state: Pick<AgentGraphState, 'toolResults' | 'messages' | 'replyText'>;
}): string {
  const summary = buildDeterministicRuntimeSummary(params.state);
  return [
    'I stopped here because the model did not follow Sage\'s Chat Completions tool-calling protocol.',
    params.detail,
    summary,
    `Next: ask me to continue with a narrower follow-up if you want me to recover from this point.`,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}

const invokeAgentModelTask = task(
  {
    name: 'sage_invoke_agent_model',
    retry: MODEL_INVOKE_RETRY_POLICY,
  },
  async (input: DurableModelInvokeInput): Promise<DurableModelInvokeOutput> => {
    const startedAt = Date.now();
    const baseModel = createGraphChatModel({
      model: input.model,
      apiKey: input.apiKey,
      temperature: input.temperature,
      timeoutMs: input.requestTimeoutMs,
      maxTokens: input.maxTokens,
    });
    const catalog =
      input.activeToolNames.length > 0
        ? buildActiveToolCatalog({
            activeToolNames: input.activeToolNames,
            context: input.toolContext,
            timeoutMs: input.timeoutMs,
          })
        : null;
    const runnable = baseModel.bindTools(
      [...(catalog?.allTools ?? []), buildTurnCloseoutTool()],
      { tool_choice: 'auto' },
    );
    const taskConfig = getConfig();
    const responseMessage = await runnable.invoke(toLangChainMessages(input.messages), {
      callbacks: taskConfig?.callbacks,
      tags: taskConfig?.tags,
      metadata: taskConfig?.metadata,
      signal: taskConfig?.signal,
    });
    const aiMessage = AIMessage.isInstance(responseMessage)
      ? responseMessage
      : new AIMessage({ content: extractMessageText(responseMessage as BaseMessage) });
    const [message] = toLlmMessages([aiMessage]);
    return {
      message: message ?? {
        role: 'assistant',
        content: extractMessageText(aiMessage),
      },
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  },
);

const captureGraphTimestampTask = task(
  { name: 'sage_capture_graph_timestamp' },
  async (): Promise<DurableGraphTimestampOutput> => ({
    iso: new Date().toISOString(),
  }),
);

const materializeApprovalInterruptTask = task(
  { name: 'sage_materialize_approval_interrupt' },
  async (input: {
    threadId: string;
    originTraceId: string;
    payload: ConstructorParameters<typeof ApprovalRequiredSignal>[0];
  }): Promise<DurableApprovalMaterializationOutput> => {
    const materialized = await createOrReuseApprovalReviewRequestFromSignal({
      threadId: input.threadId,
      originTraceId: input.originTraceId,
      signal: new ApprovalRequiredSignal(input.payload),
    });
    return {
      requestId: materialized.request.id,
      threadId: materialized.request.threadId,
      coalesced: materialized.coalesced,
      expiresAtIso: materialized.request.expiresAt.toISOString(),
    };
  },
);

const createContinuationInterruptTask = task(
  { name: 'sage_create_continuation_interrupt' },
  async (input: {
    threadId: string;
    originTraceId: string;
    latestTraceId: string;
    guildId: string | null;
    channelId: string;
    requestedByUserId: string;
    pauseKind: 'graph_timeout' | 'step_window_exhausted';
    completedWindows: number;
    maxWindows: number;
    summaryText: string;
    resumeNode: 'tool_call_turn' | 'route_tool_phase';
  }): Promise<DurableContinuationInterruptOutput> => {
    const continuation = await createGraphContinuationSession({
      threadId: input.threadId,
      originTraceId: input.originTraceId,
      latestTraceId: input.latestTraceId,
      guildId: input.guildId,
      channelId: input.channelId,
      requestedByUserId: input.requestedByUserId,
      pauseKind: input.pauseKind,
      completedWindows: input.completedWindows,
      maxWindows: input.maxWindows,
      summaryText: input.summaryText,
      resumeNode: input.resumeNode,
    });
    return {
      id: continuation.id,
      pauseReason: input.pauseKind,
      requestedByUserId: continuation.requestedByUserId,
      channelId: continuation.channelId,
      guildId: continuation.guildId,
      summaryText: continuation.summaryText,
      completedWindows: continuation.completedWindows,
      maxWindows: continuation.maxWindows,
      expiresAtIso: continuation.expiresAt.toISOString(),
      resumeNode: continuation.resumeNode as 'tool_call_turn' | 'route_tool_phase',
    };
  },
);

const consumeContinuationInterruptTask = task(
  { name: 'sage_consume_continuation_interrupt' },
  async (input: {
    continuationId: string;
    latestTraceId: string;
  }): Promise<{ continuationId: string } | null> => {
    const consumed = await consumeGraphContinuationSession({
      id: input.continuationId,
      latestTraceId: input.latestTraceId,
    });
    return consumed ? { continuationId: consumed.id } : null;
  },
);

function normalizeResolvedApprovalStatus(params: {
  decision: 'approved' | 'rejected' | 'expired';
  actionStatus?: string | null;
  errorText?: string | null;
}) {
  if (params.errorText?.trim()) return 'failed';
  if (params.actionStatus === 'executed') return 'executed';
  if (params.actionStatus === 'failed') return 'failed';
  if (params.actionStatus === 'rejected') return 'rejected';
  if (params.actionStatus === 'expired') return 'expired';
  if (params.actionStatus === 'approved') return 'approved';
  return params.decision;
}

function buildToolContext(
  state: AgentGraphState,
  runtimeContext: AgentGraphRuntimeContext,
  graphRunKind: 'turn' | 'approval_resume',
  config?: RunnableConfig,
): ToolExecutionContext {
  const metadataStep =
    typeof config?.metadata === 'object' && config.metadata
      ? (config.metadata as Record<string, unknown>).langgraph_step
      : undefined;
  const currentGraphTurn =
    typeof metadataStep === 'number' && Number.isFinite(metadataStep)
      ? Math.max(1, Math.trunc(metadataStep))
      : typeof metadataStep === 'string' && /^\d+$/.test(metadataStep)
        ? Math.max(1, Number.parseInt(metadataStep, 10))
        : Math.max(1, state.roundsCompleted);
  return {
    traceId: runtimeContext.traceId,
    graphThreadId: runtimeContext.threadId,
    graphRunKind,
    graphStep: currentGraphTurn,
    approvalRequestId:
      state.pendingInterrupt?.kind === 'approval_review' ? state.pendingInterrupt.requestId : null,
    userId: runtimeContext.userId,
    channelId: runtimeContext.channelId,
    guildId: runtimeContext.guildId,
    apiKey: runtimeContext.apiKey,
    invokerIsAdmin: runtimeContext.invokerIsAdmin,
    invokerCanModerate: runtimeContext.invokerCanModerate,
    invokedBy: runtimeContext.invokedBy,
    routeKind: runtimeContext.routeKind,
    currentTurn: runtimeContext.currentTurn as ToolExecutionContext['currentTurn'],
    replyTarget: runtimeContext.replyTarget as ToolExecutionContext['replyTarget'],
  };
}

function isTimedOut(state: AgentGraphState, graphConfig: AgentGraphConfig): boolean {
  return state.activeWindowDurationMs >= graphConfig.maxDurationMs;
}

async function buildExecutionEvent(
  state: AgentGraphState,
  details: Omit<ToolCallRoundEvent, 'round' | 'completedAt'>,
): Promise<ToolCallRoundEvent> {
  const timestamp = await captureGraphTimestampTask();
  return {
    round: Math.max(1, state.roundsCompleted),
    completedAt: timestamp.iso,
    ...details,
  };
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function resolveToolCallFingerprint(
  call: GraphToolCallDescriptor,
  context: ToolExecutionContext,
): Promise<string> {
  const fallback = buildToolCacheKey(call.name, call.args);

  try {
    const resolved = await globalToolRegistry.resolveActionPolicy(call, context);
    const idempotencyKey = resolved?.policy.idempotencyKey;
    let candidate: string | null | undefined;

    if (typeof idempotencyKey === 'string') {
      candidate = idempotencyKey;
    } else if (typeof idempotencyKey === 'function' && resolved) {
      candidate = idempotencyKey(resolved.args, context);
    }

    const normalized = candidate?.trim();
    if (normalized) {
      return `${call.name}::${normalized}`;
    }
  } catch {
    // Fall back to the stable semantic cache key when policy resolution is unavailable.
  }

  return fallback;
}

function buildToolBatchFingerprint(
  calls: Array<{
    readOnly: boolean;
    fingerprint: string;
  }>,
): string | null {
  if (calls.length === 0) {
    return null;
  }

  return safeJsonStringify(
    calls.map((call) => ({
      mode: call.readOnly ? 'read' : 'write',
      fingerprint: call.fingerprint,
    })),
  );
}

function buildLoopGuardContent(params: {
  reason: NonNullable<ToolCallRoundEvent['guardReason']>;
  detail: string;
  requestedCallCount: number;
  uniqueCallCount: number;
  skippedDuplicateCallCount: number;
  overLimitCallCount: number;
  repairable: boolean;
}): string {
  return (
    safeJsonStringify({
      ok: false,
      errorType: 'loop_guard',
      reason: params.reason,
      detail: params.detail,
      requestedCallCount: params.requestedCallCount,
      uniqueCallCount: params.uniqueCallCount,
      skippedDuplicateCallCount: params.skippedDuplicateCallCount,
      overLimitCallCount: params.overLimitCallCount,
      repairable: params.repairable,
    }) ?? params.detail
  );
}

function buildLoopGuardToolMessages(params: {
  calls: GraphToolCallDescriptor[];
  reason: NonNullable<ToolCallRoundEvent['guardReason']>;
  detail: string;
  requestedCallCount: number;
  uniqueCallCount: number;
  skippedDuplicateCallCount: number;
  overLimitCallCount: number;
  repairable: boolean;
}): {
  messages: ToolMessage[];
  results: SerializedToolResult[];
} {
  return params.calls.reduce<{
    messages: ToolMessage[];
    results: SerializedToolResult[];
  }>(
    (accumulator, call) => {
      const result: SerializedToolResult = {
        name: call.name,
        success: false,
        error: params.detail,
        errorType: 'execution',
        latencyMs: 0,
      };
      accumulator.messages.push(
        buildToolMessageFromOutcome({
          toolName: call.name,
          callId: call.id,
          content: buildLoopGuardContent({
            reason: params.reason,
            detail: params.detail,
            requestedCallCount: params.requestedCallCount,
            uniqueCallCount: params.uniqueCallCount,
            skippedDuplicateCallCount: params.skippedDuplicateCallCount,
            overLimitCallCount: params.overLimitCallCount,
            repairable: params.repairable,
          }),
          result,
          files: [],
          status: 'error',
        }),
      );
      accumulator.results.push(result);
      return accumulator;
    },
    { messages: [], results: [] },
  );
}

function buildLoopGuardReply(params: {
  reason: NonNullable<ToolCallRoundEvent['guardReason']>;
  state: Pick<AgentGraphState, 'toolResults' | 'messages' | 'replyText'>;
}): string {
  const explanation =
    params.reason === 'too_many_tool_calls'
      ? 'I stopped here because the agent planned too many tool calls in one round to execute safely.'
      : params.reason === 'repeated_identical_batch'
        ? 'I stopped here because the agent kept repeating the same tool plan instead of making progress.'
        : 'I stopped here because the agent hit the LangGraph recursion safety limit before it could finish safely.';
  const nextStep =
    params.reason === 'too_many_tool_calls'
      ? 'Next: ask me to handle a smaller subset of the work, or tell me which calls to prioritize first.'
      : params.reason === 'repeated_identical_batch'
        ? 'Next: clarify the desired outcome or narrow the next step so I can replan cleanly.'
        : 'Next: ask me to continue with a smaller scoped follow-up so I can resume from a safer checkpoint.';
  const summary = buildDeterministicRuntimeSummary(params.state);
  return [explanation, summary, nextStep].filter((part) => part.trim().length > 0).join('\n\n');
}

function resolveFinalToolDelivery(
  current: GraphToolDeliveryState | null,
  results: SerializedToolResult[],
  toolNames?: string[],
): GraphToolDeliveryState | null {
  if (current) {
    return current;
  }

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const effect = result?.success ? result.deliveryEffect : undefined;
    if (!result?.success || !effect) {
      continue;
    }

    return {
      toolName: toolNames?.[index] ?? result.name,
      effectKind: effect.kind,
      visibleSummary: effect.visibleSummary,
    };
  }

  return null;
}

function buildContextFrame(state: Pick<
  AgentGraphState,
  'messages' | 'toolResults' | 'replyText' | 'pendingInterrupt' | 'finalToolDelivery' | 'contextFrame'
>): GraphContextFrame {
  const latestAssistantText = scrubFinalReplyText({
    replyText: state.replyText || findLatestAssistantText(state.messages as BaseMessage[]),
  });
  const successfulResults = state.toolResults.filter((result) => result.success);
  const failedResults = state.toolResults.filter((result) => !result.success);
  const objective =
    state.contextFrame?.objective?.trim() ||
    extractMessageText((state.messages.find((message) => message.getType?.() === 'human') as BaseMessage | undefined) ?? new HumanMessage({ content: 'Finish the request.' })) ||
    'Finish the current user request cleanly.';

  const completedActions = successfulResults
    .slice(-4)
    .map((result) => `${result.name}${result.cacheHit ? ' (cache)' : ''}`);
  const verifiedFacts = [
    ...state.contextFrame.verifiedFacts,
    ...successfulResults
      .slice(-3)
      .map((result) => `${result.name} succeeded`),
  ].slice(-6);
  const openQuestions = [
    ...state.contextFrame.openQuestions,
    ...(failedResults.length > 0 ? failedResults.slice(-2).map((result) => result.error ?? `${result.name} failed`) : []),
  ].slice(-4);
  const pendingApprovals =
    state.pendingInterrupt?.kind === 'approval_review'
      ? state.pendingInterrupt.requests.map((request) => `${request.call.name}:${request.requestId}`)
      : [];
  const deliveryState =
    state.finalToolDelivery?.effectKind === 'final_message'
      ? 'final_message'
      : state.finalToolDelivery?.effectKind === 'governance_only'
        ? 'governance_only'
        : 'none';
  const nextAction =
    pendingApprovals.length > 0
      ? 'Wait for approval resolution.'
      : state.finalToolDelivery?.effectKind === 'final_message'
        ? `Close the turn with ${TURN_CLOSEOUT_TOOL_NAME}(kind="delivered_via_tool").`
        : successfulResults.length > 0
          ? `Use the latest tool results to decide whether to call more tools or close with ${TURN_CLOSEOUT_TOOL_NAME}.`
          : latestAssistantText
            ? `Repair the last assistant response so it uses tool calls or ${TURN_CLOSEOUT_TOOL_NAME}.`
            : `Choose the next tool call or close the turn with ${TURN_CLOSEOUT_TOOL_NAME}.`;

  return {
    objective: objective.trim() || 'Finish the current user request cleanly.',
    verifiedFacts,
    completedActions,
    openQuestions,
    pendingApprovals,
    deliveryState,
    nextAction,
  };
}

function buildContextFramePrompt(frame: GraphContextFrame): string {
  return [
    '<agent_working_state>',
    `Objective: ${frame.objective}`,
    `Verified facts: ${frame.verifiedFacts.join(' | ') || '(none)'}`,
    `Completed actions: ${frame.completedActions.join(' | ') || '(none)'}`,
    `Open questions: ${frame.openQuestions.join(' | ') || '(none)'}`,
    `Pending approvals: ${frame.pendingApprovals.join(' | ') || '(none)'}`,
    `Delivery state: ${frame.deliveryState}`,
    `Next action: ${frame.nextAction}`,
    '</agent_working_state>',
  ].join('\n');
}

function buildAssistantTurnMessages(params: {
  state: AgentGraphState;
  runtimeContext: AgentGraphRuntimeContext;
}): LLMChatMessage[] {
  const prepared = buildRebudgetingEvent(
    params.state.messages as BaseMessage[],
    params.runtimeContext.model,
    params.runtimeContext.maxTokens,
  );
  const frame = buildContextFrame(params.state);
  const preparedMessages = toLlmMessages(prepared.trimmedMessages);
  const recentMessages = preparedMessages.slice(-8);
  return [
    {
      role: 'system',
      content: buildContextFramePrompt(frame),
    },
    buildAssistantTurnProtocolMessage(),
    ...recentMessages,
  ];
}

function buildProtocolRepairMessage(detail: string): HumanMessage {
  return new HumanMessage({
    content: [
      'Runtime protocol repair:',
      detail,
      `Reply with provider-native tool calls only. Use external tools for work, or use ${TURN_CLOSEOUT_TOOL_NAME} to close the turn.`,
      'Do not send plain assistant text without a tool call.',
    ].join('\n'),
  });
}

function buildProtocolViolationOutcome(params: {
  state: AgentGraphState;
  detail: string;
  runtimeContext: AgentGraphRuntimeContext;
  messages?: BaseMessage[];
}): Command<unknown, Partial<AgentGraphState>, GraphNodeName> {
  if (params.state.protocolRepairCount < TURN_PROTOCOL_MAX_REPAIRS) {
    return new Command({
      goto: 'tool_call_turn',
      update: {
        messages: [...(params.messages ?? []), buildProtocolRepairMessage(params.detail)],
        protocolRepairCount: params.state.protocolRepairCount + 1,
        contextFrame: buildContextFrame(params.state),
        resumeContext: snapshotRuntimeContext(params.runtimeContext),
      },
    });
  }

  return new Command({
    goto: 'closeout_turn',
    update: {
      messages: params.messages ?? [],
      replyText: buildProtocolViolationReply({
        detail: params.detail,
        state: params.state,
      }),
      completionKind: 'loop_guard',
      stopReason: 'protocol_violation',
      deliveryDisposition: 'chat_reply',
      protocolRepairCount: params.state.protocolRepairCount,
      contextFrame: buildContextFrame(params.state),
      resumeContext: snapshotRuntimeContext(params.runtimeContext),
    },
  });
}

function parseCloseoutToolCall(call: GraphToolCallDescriptor): z.infer<typeof TurnCloseoutSchema> | null {
  const parsed = TurnCloseoutSchema.safeParse(call.args);
  return parsed.success ? parsed.data : null;
}

function isGraphRecursionLimitError(error: unknown): boolean {
  return error instanceof GraphRecursionError || (error instanceof Error && error.name === 'GraphRecursionError');
}

function addActiveWindowDuration(
  state: Pick<AgentGraphState, 'activeWindowDurationMs'>,
  ...durationsMs: Array<number | undefined>
): number {
  const baseDuration =
    typeof state.activeWindowDurationMs === 'number' && Number.isFinite(state.activeWindowDurationMs)
      ? state.activeWindowDurationMs
      : 0;
  return durationsMs.reduce<number>((total, value) => {
    const duration = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    return total + duration;
  }, baseDuration);
}

function buildApprovalBatchId(threadId: string, calls: GraphToolCallDescriptor[]): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        threadId,
        calls: calls.map((call) => ({
          id: call.id ?? null,
          name: call.name,
          args: call.args ?? null,
        })),
      }),
    )
    .digest('hex')
    .slice(0, 24);
}

function normalizeApprovalResumeDecisions(
  approvalInterrupt: Extract<AgentGraphState['pendingInterrupt'], { kind: 'approval_review' }>,
  resume: GraphResumeInput,
): ApprovalResumeDecision[] {
  if (resume.interruptKind !== 'approval_review') {
    throw new Error('Approval interrupt resumed with incompatible payload.');
  }

  const knownRequestIds = new Set(approvalInterrupt.requests.map((request) => request.requestId));
  const decisions = approvalInterrupt.requests.map((request) => {
    const decision = resume.decisions.find((entry) => entry.requestId === request.requestId);
    if (!decision) {
      throw new Error(`Approval batch resume is missing a decision for request "${request.requestId}".`);
    }
    if (!knownRequestIds.has(decision.requestId)) {
      throw new Error(`Approval batch resume included an unknown request "${decision.requestId}".`);
    }
    return {
      requestId: request.requestId,
      status: decision.status,
      reviewerId: decision.reviewerId ?? null,
      decisionReasonText: decision.decisionReasonText ?? null,
    };
  });
  if (resume.decisions.length !== decisions.length) {
    throw new Error('Approval batch resume contained an unexpected number of decisions.');
  }
  return decisions;
}

function buildToolMessageFromOutcome(params: {
  toolName: string;
  callId?: string;
  content: string;
  result: SerializedToolResult;
  files: AgentGraphState['files'];
  status?: 'success' | 'error';
  cacheHit?: boolean;
  cacheKind?: 'dedupe';
}): ToolMessage {
  return new ToolMessage({
    content: params.content,
    tool_call_id: params.callId ?? `${params.toolName}-call`,
    artifact: {
      result: params.result,
      files: params.files,
      cacheHit: params.cacheHit,
      cacheKind: params.cacheKind,
    },
    status: params.status,
  });
}

function resolveContinueResumeNode(state: AgentGraphState): 'tool_call_turn' | 'route_tool_phase' {
  const lastMessage = state.messages.at(-1);
  if (lastMessage && AIMessage.isInstance(lastMessage) && (lastMessage.tool_calls?.length ?? 0) > 0) {
    return 'route_tool_phase';
  }
  return 'tool_call_turn';
}

function resolveContinuationStopReason(
  pauseReason: 'graph_timeout' | 'step_window_exhausted',
): GraphStopReason {
  return pauseReason === 'graph_timeout' ? 'graph_timeout' : 'step_window_exhausted';
}

function buildReadToolsNode(graphConfig: AgentGraphConfig) {
  return async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Partial<AgentGraphState>> => {
    if (state.pendingReadCalls.length === 0) {
      return {};
    }
    if (state.pendingReadExecutionCalls.length === 0) {
      return {
        pendingReadCalls: [],
        pendingReadExecutionCalls: [],
      };
    }

    const runtimeContext = resolveRuntimeContext(state, config);
    const toolContext = buildToolContext(state, runtimeContext, 'turn', config);
    const catalog = buildActiveToolCatalog({
      activeToolNames: runtimeContext.activeToolNames,
      context: toolContext,
      timeoutMs: graphConfig.toolTimeoutMs,
    });
    const batchMessage = new AIMessage({
      content: '',
      tool_calls: state.pendingReadExecutionCalls.map((call) => ({
        id: call.id,
        name: call.name,
        args:
          call.args && typeof call.args === 'object' && !Array.isArray(call.args)
            ? (call.args as Record<string, unknown>)
            : {},
        type: 'tool_call',
      })),
    });
    const selectedTools = catalog.readOnlyTools.filter((tool) =>
      (batchMessage.tool_calls ?? []).some((call) => call.name === tool.name),
    );
    if (selectedTools.length === 0) {
      return {
        pendingReadCalls: [],
        pendingReadExecutionCalls: [],
      };
    }

    const output = (await new ToolNode(selectedTools).invoke(
      { messages: [batchMessage] },
      config as Parameters<InstanceType<typeof ToolNode>['invoke']>[1],
    )) as { messages?: ToolMessage[] };
    const executedMessages = Array.isArray(output.messages) ? output.messages : [];
    const nextFiles = executedMessages.flatMap((message) => {
      const artifact = message.artifact as { files?: AgentGraphState['files'] } | undefined;
      return artifact?.files ?? [];
    });
    const executedEntries = await Promise.all(
      state.pendingReadExecutionCalls.map(async (call, index) => ({
        call,
        fingerprint: await resolveToolCallFingerprint(call, toolContext),
        message: executedMessages[index] ?? null,
      })),
    );
    const executedByFingerprint = new Map<
      string,
      {
        call: GraphToolCallDescriptor;
        message: ToolMessage;
        result: SerializedToolResult;
        files: AgentGraphState['files'];
      }
    >();

    for (const entry of executedEntries) {
      const result = (entry.message?.artifact as { result?: SerializedToolResult } | undefined)?.result;
      if (!entry.message || !result || executedByFingerprint.has(entry.fingerprint)) {
        continue;
      }
      const artifact = entry.message.artifact as { files?: AgentGraphState['files'] } | undefined;
      executedByFingerprint.set(entry.fingerprint, {
        call: entry.call,
        message: entry.message,
        result,
        files: artifact?.files ?? [],
      });
    }

    const toolMessages: ToolMessage[] = [];
    const nextToolResults: SerializedToolResult[] = [];
    for (const call of state.pendingReadCalls) {
      const fingerprint = await resolveToolCallFingerprint(call, toolContext);
      const matched = executedByFingerprint.get(fingerprint);
      if (!matched) {
        continue;
      }
      const duplicate = call.id !== matched.call.id;
      toolMessages.push(
        buildToolMessageFromOutcome({
          toolName: call.name,
          callId: call.id,
          content: extractMessageText(matched.message),
          result: matched.result,
          files: matched.files,
          status: matched.result.success ? 'success' : 'error',
          cacheHit: duplicate,
          cacheKind: duplicate ? 'dedupe' : undefined,
        }),
      );
      nextToolResults.push(matched.result);
    }

    return {
      messages: toolMessages,
      toolResults: nextToolResults,
      files: nextFiles,
      pendingReadCalls: [],
      pendingReadExecutionCalls: [],
    };
  };
}

function createCompiledAgentGraph(checkpointer: PostgresSaver | MemorySaver, graphConfig: AgentGraphConfig) {
  const readToolsSubgraph = new StateGraph({
    state: AgentGraphStateSchema,
    context: AgentGraphConfigurableSchema,
  })
    .addNode('tools', buildReadToolsNode(graphConfig))
    .addEdge(START, 'tools')
    .addConditionalEdges('tools', (state) =>
      toolsCondition(state.messages as BaseMessage[]) === 'tools' ? 'tools' : END,
    )
    .compile({
      checkpointer: false,
      name: 'sage_read_tools_subgraph',
      description: 'Read-only ToolNode execution for Sage.',
    });

  const decideTurnNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    if (isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.maxSteps) {
      return new Command({
        goto: 'pause_for_continue',
        update: {
          stopReason: isTimedOut(state, graphConfig) ? 'graph_timeout' : 'step_window_exhausted',
          resumeContext: snapshotRuntimeContext(runtimeContext),
          contextFrame: buildContextFrame(state),
        },
      });
    }
    return new Command({
      goto: 'tool_call_turn',
      update: {
        resumeContext: snapshotRuntimeContext(runtimeContext),
        contextFrame: buildContextFrame(state),
      },
    });
  };

  const toolCallTurnNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    if (isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.maxSteps) {
      return new Command({
        goto: 'pause_for_continue',
        update: {
          stopReason: isTimedOut(state, graphConfig) ? 'graph_timeout' : 'step_window_exhausted',
          resumeContext: snapshotRuntimeContext(runtimeContext),
          contextFrame: buildContextFrame(state),
        },
      });
    }
    const toolContext = buildToolContext(state, runtimeContext, 'turn', config);
    const prepared = buildRebudgetingEvent(
      state.messages as BaseMessage[],
      runtimeContext.model,
      runtimeContext.maxTokens,
    );
    const response = await invokeAgentModelTask({
      messages: buildAssistantTurnMessages({
        state,
        runtimeContext,
      }),
      activeToolNames: runtimeContext.activeToolNames,
      toolContext,
      timeoutMs: graphConfig.toolTimeoutMs,
      model: runtimeContext.model,
      apiKey: runtimeContext.apiKey,
      temperature: runtimeContext.temperature,
      requestTimeoutMs: runtimeContext.timeoutMs,
      maxTokens: runtimeContext.maxTokens,
    });
    const [aiMessageCandidate] = toLangChainMessages([response.message]);
    const aiMessage = AIMessage.isInstance(aiMessageCandidate)
      ? aiMessageCandidate
      : new AIMessage({ content: extractMessageText(aiMessageCandidate as BaseMessage) });
    const replyText = extractMessageText(aiMessage).trim();
    const toolCalls = getLastAiToolCalls([aiMessage]);
    const nextActiveWindowDurationMs = addActiveWindowDuration(state, response.latencyMs);
    const timedOutAfterModel = nextActiveWindowDurationMs >= graphConfig.maxDurationMs;
    const nextRoundsCompleted = state.roundsCompleted + 1;
    const nextTotalRoundsCompleted = state.totalRoundsCompleted + 1;

    if (toolCalls.length > 0) {
      return new Command({
        goto: timedOutAfterModel ? 'pause_for_continue' : 'route_tool_phase',
        update: {
          messages: [aiMessage],
          activeWindowDurationMs: nextActiveWindowDurationMs,
          roundsCompleted: nextRoundsCompleted,
          totalRoundsCompleted: nextTotalRoundsCompleted,
          stopReason: timedOutAfterModel ? 'graph_timeout' : state.stopReason,
          resumeContext: snapshotRuntimeContext(runtimeContext),
          contextFrame: buildContextFrame({
            ...state,
            messages: [...(state.messages as BaseMessage[]), aiMessage],
          }),
          finalization: {
            ...state.finalization,
            rebudgeting: prepared.rebudgeting,
          },
        },
      });
    }

    const nextState: AgentGraphState = {
      ...state,
      messages: [...(state.messages as BaseMessage[]), aiMessage],
      replyText,
      activeWindowDurationMs: nextActiveWindowDurationMs,
      roundsCompleted: nextRoundsCompleted,
      totalRoundsCompleted: nextTotalRoundsCompleted,
      finalization: {
        ...state.finalization,
        rebudgeting: prepared.rebudgeting,
      },
    };

    return buildProtocolViolationOutcome({
      state: nextState,
      detail: `The assistant responded with plain text instead of provider-native tool calls. Use external tools for work, or call ${TURN_CLOSEOUT_TOOL_NAME} to close the turn.`,
      runtimeContext,
      messages: [aiMessage],
    });
  };

  const routeToolPhaseNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const toolCalls = getLastAiToolCalls(state.messages as BaseMessage[]);
    const runtimeContext = resolveRuntimeContext(state, config);
    const toolContext = buildToolContext(state, runtimeContext, 'turn', config);
    const catalog = buildActiveToolCatalog({
      activeToolNames: runtimeContext.activeToolNames,
      context: toolContext,
      timeoutMs: graphConfig.toolTimeoutMs,
    });

    const requestedCallCount = toolCalls.length;
    const closeoutCalls = toolCalls.filter((call) => call.name === TURN_CLOSEOUT_TOOL_NAME);
    if (closeoutCalls.length > 0) {
      if (closeoutCalls.length !== 1 || toolCalls.length !== 1) {
        return buildProtocolViolationOutcome({
          state,
          detail: `The assistant mixed ${TURN_CLOSEOUT_TOOL_NAME} with other tool calls. Use either external tools or exactly one ${TURN_CLOSEOUT_TOOL_NAME} call per assistant turn.`,
          runtimeContext,
        });
      }

      const parsedCloseout = parseCloseoutToolCall({
        id: closeoutCalls[0]!.id,
        name: closeoutCalls[0]!.name,
        args: closeoutCalls[0]!.args,
      });
      if (!parsedCloseout) {
        return buildProtocolViolationOutcome({
          state,
          detail: `${TURN_CLOSEOUT_TOOL_NAME} received invalid arguments. Use kind=final_answer, clarification_question, or delivered_via_tool.`,
          runtimeContext,
        });
      }

      if (parsedCloseout.kind === 'delivered_via_tool') {
        if (state.finalToolDelivery?.effectKind !== 'final_message') {
          return buildProtocolViolationOutcome({
            state,
            detail: `${TURN_CLOSEOUT_TOOL_NAME}(kind="delivered_via_tool") is only valid after a final-delivery tool already posted the answer.`,
            runtimeContext,
          });
        }

        return new Command({
          goto: 'closeout_turn',
          update: {
            replyText: '',
            completionKind: 'delivered_via_tool',
            stopReason: 'verified_closeout',
            deliveryDisposition: 'tool_delivered',
            contextFrame: buildContextFrame(state),
            resumeContext: snapshotRuntimeContext(runtimeContext),
          },
        });
      }

      const visibleReplyText = scrubFinalReplyText({
        replyText: parsedCloseout.message ?? '',
      });
      if (!visibleReplyText) {
        return buildProtocolViolationOutcome({
          state,
          detail: `${TURN_CLOSEOUT_TOOL_NAME} requires a non-empty message for ${parsedCloseout.kind}.`,
          runtimeContext,
        });
      }

      return new Command({
        goto: 'closeout_turn',
        update: {
          replyText: visibleReplyText,
          completionKind:
            parsedCloseout.kind === 'clarification_question'
              ? 'clarification_question'
              : 'final_answer',
          stopReason: 'verified_closeout',
          deliveryDisposition: 'chat_reply',
          contextFrame: buildContextFrame({
            ...state,
            replyText: visibleReplyText,
          }),
          resumeContext: snapshotRuntimeContext(runtimeContext),
        },
      });
    }

    const readBatch: GraphToolCallDescriptor[] = [];
    const readExecutionBatch: GraphToolCallDescriptor[] = [];
    const pendingWriteCalls: GraphToolCallDescriptor[] = [];
    const seenReadFingerprints = new Set<string>();
    const batchFingerprintParts: Array<{ readOnly: boolean; fingerprint: string }> = [];
    let skippedDuplicateCallCount = 0;

    for (const call of toolCalls) {
      const serializedCall: GraphToolCallDescriptor = {
        id: call.id,
        name: call.name,
        args: call.args,
      };
      const readOnly = isReadOnlyToolCall({
        definitions: catalog.definitions,
        call: serializedCall,
        context: toolContext,
      });
      const fingerprint = await resolveToolCallFingerprint(serializedCall, toolContext);
      batchFingerprintParts.push({
        readOnly,
        fingerprint,
      });

      if (readOnly) {
        readBatch.push(serializedCall);
        if (seenReadFingerprints.has(fingerprint)) {
          skippedDuplicateCallCount += 1;
          continue;
        }
        seenReadFingerprints.add(fingerprint);
        readExecutionBatch.push(serializedCall);
        continue;
      }

      pendingWriteCalls.push(serializedCall);
    }
    const uniqueCallCount = readExecutionBatch.length + pendingWriteCalls.length;
    const overLimitCallCount = Math.max(0, uniqueCallCount - graphConfig.maxToolCallsPerRound);
    const batchFingerprint = buildToolBatchFingerprint(batchFingerprintParts);
    const consecutiveIdenticalToolBatches =
      batchFingerprint && batchFingerprint === state.lastToolBatchFingerprint
        ? state.consecutiveIdenticalToolBatches + 1
        : batchFingerprint
          ? 1
          : 0;
    const guardReason: ToolCallRoundEvent['guardReason'] =
      overLimitCallCount > 0
        ? 'too_many_tool_calls'
        : consecutiveIdenticalToolBatches >= graphConfig.maxIdenticalToolBatches && uniqueCallCount > 0
          ? 'repeated_identical_batch'
          : undefined;
    const executedAny = readExecutionBatch.length > 0 || pendingWriteCalls.length > 0;
    const repairable = Boolean(
      guardReason && state.loopGuardRecoveries < graphConfig.maxLoopGuardRecoveries,
    );

    if (guardReason) {
      const detail =
        guardReason === 'too_many_tool_calls'
          ? `The assistant requested ${uniqueCallCount} executable tool calls in one round, which exceeds the limit of ${graphConfig.maxToolCallsPerRound}. Replan into a smaller batch before calling tools again.`
          : `The assistant repeated the same tool batch ${consecutiveIdenticalToolBatches} times in a row. Replan with a different approach or ask the user for clarification before calling tools again.`;
      const loopGuard = buildLoopGuardToolMessages({
        calls: [...readBatch, ...pendingWriteCalls],
        reason: guardReason,
        detail,
        requestedCallCount,
        uniqueCallCount,
        skippedDuplicateCallCount,
        overLimitCallCount,
        repairable,
      });
      const event = await buildExecutionEvent(state, {
        requestedCallCount,
        executedCallCount: 0,
        deduplicatedCallCount: skippedDuplicateCallCount,
        uniqueCallCount,
        skippedDuplicateCallCount,
        overLimitCallCount,
        guardReason,
      });

      if (repairable) {
        return new Command({
          goto: 'tool_call_turn',
          update: {
            messages: loopGuard.messages,
            toolResults: loopGuard.results,
            pendingReadCalls: [],
            pendingReadExecutionCalls: [],
            pendingWriteCalls: [],
            deduplicatedCallCount: skippedDuplicateCallCount,
            lastToolBatchFingerprint: batchFingerprint,
            consecutiveIdenticalToolBatches,
            loopGuardRecoveries: state.loopGuardRecoveries + 1,
            roundEvents: [event],
            contextFrame: buildContextFrame(state),
          },
        });
      }

      const completionTimestamp = await captureGraphTimestampTask();
      return new Command({
        goto: 'finalize_turn',
        update: {
          messages: loopGuard.messages,
          toolResults: loopGuard.results,
          replyText: buildLoopGuardReply({
            reason: guardReason,
            state: {
              toolResults: [...state.toolResults, ...loopGuard.results],
              messages: [...(state.messages as BaseMessage[]), ...loopGuard.messages],
              replyText: state.replyText,
            },
          }),
          pendingReadCalls: [],
          pendingReadExecutionCalls: [],
          pendingWriteCalls: [],
          deduplicatedCallCount: skippedDuplicateCallCount,
          lastToolBatchFingerprint: batchFingerprint,
          consecutiveIdenticalToolBatches,
          loopGuardRecoveries: state.loopGuardRecoveries,
          roundEvents: [event],
          completionKind: 'loop_guard',
          stopReason: 'loop_guard',
          deliveryDisposition: 'chat_reply',
          protocolRepairCount: state.protocolRepairCount,
          contextFrame: buildContextFrame(state),
          finalization: {
            attempted: true,
            succeeded: true,
            completedAt: completionTimestamp.iso,
            stopReason: 'loop_guard',
            completionKind: 'loop_guard',
            deliveryDisposition: 'chat_reply',
            protocolRepairCount: state.protocolRepairCount,
            toolDeliveredFinal: false,
            contextFrame: buildContextFrame(state),
          },
        },
      });
    }

    return new Command({
      goto:
        readExecutionBatch.length > 0
          ? 'execute_read_tools'
          : pendingWriteCalls.length > 0
            ? 'approval_gate'
            : 'tool_call_turn',
      update: {
        pendingReadCalls: readBatch,
        pendingReadExecutionCalls: readExecutionBatch,
        pendingWriteCalls,
        deduplicatedCallCount: skippedDuplicateCallCount,
        lastToolBatchFingerprint: batchFingerprint,
        consecutiveIdenticalToolBatches,
        loopGuardRecoveries: 0,
        roundEvents: executedAny
          ? [
              await buildExecutionEvent(state, {
                requestedCallCount,
                executedCallCount: uniqueCallCount,
                deduplicatedCallCount: skippedDuplicateCallCount,
                uniqueCallCount,
                skippedDuplicateCallCount,
                overLimitCallCount,
              }),
            ]
          : [],
        contextFrame: buildContextFrame(state),
      },
    });
  };

  const closeoutTurnNode = async (
    state: AgentGraphState,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const frame = buildContextFrame(state);
    const effectiveReplyText =
      state.deliveryDisposition === 'tool_delivered' ||
      state.deliveryDisposition === 'approval_governance_only'
        ? ''
        : scrubFinalReplyText({
            replyText: state.replyText || findLatestAssistantText(state.messages as BaseMessage[]),
          });
    const completionTimestamp = await captureGraphTimestampTask();
    return new Command({
      goto: 'finalize_turn',
      update: {
        replyText: effectiveReplyText,
        contextFrame: frame,
        finalization: {
          attempted: true,
          succeeded: true,
          completedAt: completionTimestamp.iso,
          stopReason: state.stopReason,
          completionKind: state.completionKind ?? 'loop_guard',
          deliveryDisposition: state.deliveryDisposition,
          protocolRepairCount: state.protocolRepairCount,
          toolDeliveredFinal: state.deliveryDisposition === 'tool_delivered',
          contextFrame: frame,
          rebudgeting: state.finalization.rebudgeting,
        },
      },
    });
  };

  const executeReadToolsNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const update = (await readToolsSubgraph.invoke(
      state,
      config as Parameters<typeof readToolsSubgraph.invoke>[1],
    )) as Partial<AgentGraphState>;
    const readToolDurationMs = Array.isArray(update.toolResults)
      ? update.toolResults.reduce((total, result) => total + (result.latencyMs ?? 0), 0)
      : 0;
    return new Command({
      goto: state.pendingWriteCalls.length > 0 ? 'approval_gate' : 'tool_call_turn',
      update: {
        messages: update.messages ?? [],
        toolResults: update.toolResults ?? [],
        files: update.files ?? [],
        pendingReadCalls: update.pendingReadCalls ?? [],
        pendingReadExecutionCalls: update.pendingReadExecutionCalls ?? [],
        activeWindowDurationMs: addActiveWindowDuration(state, readToolDurationMs),
        finalToolDelivery: resolveFinalToolDelivery(state.finalToolDelivery, update.toolResults ?? []),
        contextFrame: buildContextFrame({
          ...state,
          toolResults: [...state.toolResults, ...(update.toolResults ?? [])],
          messages: [...(state.messages as BaseMessage[]), ...((update.messages as BaseMessage[] | undefined) ?? [])],
        }),
      },
    });
  };

  const approvalGateNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const currentWriteCall = state.pendingWriteCalls[0] ?? null;
    if (!currentWriteCall) {
      return new Command({ goto: 'tool_call_turn', update: {} });
    }

    const runtimeContext = resolveRuntimeContext(state, config);
    const turnToolContext = buildToolContext(state, runtimeContext, 'turn', config);
    const approvalPlanningStartedAt = Date.now();
    const preparedApproval = await prepareToolApprovalInterrupt({
      activeToolNames: runtimeContext.activeToolNames,
      call: currentWriteCall,
      context: turnToolContext,
    });
    if (preparedApproval) {
      const preparedBatch = [preparedApproval];
      for (let index = 1; index < state.pendingWriteCalls.length; index += 1) {
        const candidate = await prepareToolApprovalInterrupt({
          activeToolNames: runtimeContext.activeToolNames,
          call: state.pendingWriteCalls[index]!,
          context: turnToolContext,
        });
        if (!candidate || candidate.approvalGroupKey !== preparedApproval.approvalGroupKey) {
          break;
        }
        preparedBatch.push(candidate);
      }

      const batchId = buildApprovalBatchId(
        runtimeContext.threadId,
        preparedBatch.map((entry) => entry.call),
      );
      const approvalRequests: NonNullable<Extract<AgentGraphState['pendingInterrupt'], { kind: 'approval_review' }>['requests']> = [];

      for (let index = 0; index < preparedBatch.length; index += 1) {
        const prepared = preparedBatch[index]!;
        const materialized = await materializeApprovalInterruptTask({
          threadId: runtimeContext.threadId,
          originTraceId: runtimeContext.originTraceId,
          payload: {
            ...prepared.payload,
            interruptMetadataJson: {
              ...(prepared.payload.interruptMetadataJson &&
              typeof prepared.payload.interruptMetadataJson === 'object' &&
              !Array.isArray(prepared.payload.interruptMetadataJson)
                ? (prepared.payload.interruptMetadataJson as Record<string, unknown>)
                : {}),
              langgraphApprovalBatch: {
                batchId,
                batchIndex: index,
                batchSize: preparedBatch.length,
                approvalGroupKey: prepared.approvalGroupKey,
              },
            },
          },
        });
        if (materialized.coalesced && materialized.threadId !== runtimeContext.threadId && index > 0) {
          break;
        }
        approvalRequests.push({
          requestId: materialized.requestId,
          call: prepared.call,
          payload: prepared.payload,
          coalesced: materialized.coalesced,
          expiresAtIso: materialized.expiresAtIso,
        });
      }

      if (approvalRequests.length > 0) {
        const interruptTimestamp = await captureGraphTimestampTask();
        return new Command({
          goto: 'resume_interrupt',
          update: {
            replyText: '',
            graphStatus: 'interrupted',
            completionKind: 'approval_handoff',
            stopReason: 'approval_interrupt',
            deliveryDisposition: 'approval_governance_only',
            activeWindowDurationMs: addActiveWindowDuration(
              state,
              Math.max(0, Date.now() - approvalPlanningStartedAt),
            ),
            pendingInterrupt: {
              kind: 'approval_review',
              requestId: approvalRequests[0]!.requestId,
              batchId,
              requests: approvalRequests,
            },
            interruptResolution: null,
            finalization: {
              attempted: false,
              succeeded: true,
              completedAt: interruptTimestamp.iso,
              stopReason: 'approval_interrupt',
              completionKind: 'approval_handoff',
              deliveryDisposition: 'approval_governance_only',
              protocolRepairCount: state.protocolRepairCount,
              toolDeliveredFinal: false,
              contextFrame: buildContextFrame(state),
            },
            contextFrame: buildContextFrame(state),
          },
        });
      }
    }

    const outcome = await executeDurableToolTask({
      activeToolNames: runtimeContext.activeToolNames,
      call: currentWriteCall,
      context: turnToolContext,
      timeoutMs: graphConfig.toolTimeoutMs,
    });

    if (outcome.kind === 'approval_required') {
      const materialized = await materializeApprovalInterruptTask({
        threadId: runtimeContext.threadId,
        originTraceId: runtimeContext.originTraceId,
        payload: outcome.payload,
      });
      const interruptTimestamp = await captureGraphTimestampTask();

      return new Command({
        goto: 'resume_interrupt',
        update: {
          replyText: '',
          graphStatus: 'interrupted',
          completionKind: 'approval_handoff',
          stopReason: 'approval_interrupt',
          deliveryDisposition: 'approval_governance_only',
          activeWindowDurationMs: addActiveWindowDuration(state, outcome.latencyMs),
          pendingInterrupt: {
            kind: 'approval_review',
            requestId: materialized.requestId,
            batchId: buildApprovalBatchId(runtimeContext.threadId, [outcome.call]),
            requests: [
              {
                requestId: materialized.requestId,
                call: outcome.call,
                payload: outcome.payload,
                coalesced: materialized.coalesced,
                expiresAtIso: materialized.expiresAtIso,
              },
            ],
          },
          interruptResolution: null,
          finalization: {
            attempted: false,
            succeeded: true,
            completedAt: interruptTimestamp.iso,
            stopReason: 'approval_interrupt',
            completionKind: 'approval_handoff',
            deliveryDisposition: 'approval_governance_only',
            protocolRepairCount: state.protocolRepairCount,
            toolDeliveredFinal: false,
            contextFrame: buildContextFrame(state),
          },
          contextFrame: buildContextFrame(state),
        },
      });
    }

    const toolMessage = buildToolMessageFromOutcome({
      toolName: outcome.toolName,
      callId: outcome.callId,
      content: outcome.content,
      result: outcome.result,
      files: outcome.files,
      status: outcome.result.success ? 'success' : 'error',
    });

    return new Command({
      goto: state.pendingWriteCalls.length > 1 ? 'approval_gate' : 'tool_call_turn',
      update: {
        activeWindowDurationMs: addActiveWindowDuration(state, outcome.result.latencyMs),
        pendingWriteCalls: state.pendingWriteCalls.slice(1),
        messages: [toolMessage],
        toolResults: [outcome.result],
        files: outcome.files,
        finalToolDelivery: resolveFinalToolDelivery(state.finalToolDelivery, [outcome.result], [outcome.toolName]),
        contextFrame: buildContextFrame({
          ...state,
          toolResults: [...state.toolResults, outcome.result],
          messages: [...(state.messages as BaseMessage[]), toolMessage],
        }),
      },
    });
  };

  const resumeInterruptNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    if (!state.pendingInterrupt) {
      return new Command({
        goto: 'tool_call_turn',
        update: {},
      });
    }

    const runtimeContext = resolveRuntimeContext(state, config);
    if (state.pendingInterrupt.kind === 'continue_prompt') {
      const resume = interrupt({
        kind: 'continue_prompt',
        continuationId: state.pendingInterrupt.continuationId,
        pauseReason: state.pendingInterrupt.pauseReason,
        expiresAtIso: state.pendingInterrupt.expiresAtIso,
        completedWindows: state.pendingInterrupt.completedWindows,
        maxWindows: state.pendingInterrupt.maxWindows,
        summaryText: state.pendingInterrupt.summaryText,
      }) as GraphResumeInput;

      if (resume.interruptKind !== 'continue_prompt') {
        throw new Error('Continuation interrupt resumed with incompatible payload.');
      }

      const resumedContext: AgentGraphRuntimeContext = {
        ...runtimeContext,
        traceId: resume.resumeTraceId?.trim() || runtimeContext.traceId,
      };

      if (resume.decision !== 'continue') {
        const completionTimestamp = await captureGraphTimestampTask();
        return new Command({
          goto: 'finalize_turn',
          update: {
            resumeContext: snapshotRuntimeContext(resumedContext),
            completionKind: 'pause_handoff',
            stopReason: 'continuation_expired',
            deliveryDisposition: 'chat_reply',
            graphStatus: 'completed',
            pendingInterrupt: null,
            interruptResolution: {
              kind: 'continue_prompt',
              continuationId: state.pendingInterrupt.continuationId,
              decision: 'expired',
              resumedByUserId: resume.resumedByUserId ?? null,
            },
            finalization: {
              attempted: true,
              succeeded: true,
              completedAt: completionTimestamp.iso,
              stopReason: 'continuation_expired',
              completionKind: 'pause_handoff',
              deliveryDisposition: 'chat_reply',
              protocolRepairCount: state.protocolRepairCount,
              toolDeliveredFinal: false,
              contextFrame: buildContextFrame(state),
            },
            contextFrame: buildContextFrame(state),
          },
        });
      }

      const consumed = await consumeContinuationInterruptTask({
        continuationId: resume.continuationId,
        latestTraceId: resumedContext.traceId,
      });
      if (!consumed) {
        const completionTimestamp = await captureGraphTimestampTask();
        return new Command({
          goto: 'finalize_turn',
          update: {
            replyText:
              state.replyText.trim() ||
              buildContinuationUnavailableReply(),
            resumeContext: snapshotRuntimeContext(resumedContext),
            graphStatus: 'completed',
            completionKind: 'pause_handoff',
            stopReason: 'continuation_expired',
            deliveryDisposition: 'chat_reply',
            pendingInterrupt: null,
            interruptResolution: {
              kind: 'continue_prompt',
              continuationId: resume.continuationId,
              decision: 'expired',
              resumedByUserId: resume.resumedByUserId ?? null,
            },
            finalization: {
              attempted: true,
              succeeded: true,
              completedAt: completionTimestamp.iso,
              stopReason: 'continuation_expired',
              completionKind: 'pause_handoff',
              deliveryDisposition: 'chat_reply',
              protocolRepairCount: state.protocolRepairCount,
              toolDeliveredFinal: false,
              contextFrame: buildContextFrame(state),
            },
            contextFrame: buildContextFrame(state),
          },
        });
      }

      return new Command({
        goto: state.pendingInterrupt.resumeNode,
        update: {
          replyText: '',
          resumeContext: snapshotRuntimeContext(resumedContext),
          graphStatus: 'running',
          completionKind: null,
          stopReason: 'verified_closeout',
          deliveryDisposition: 'chat_reply',
          pendingInterrupt: null,
          interruptResolution: {
            kind: 'continue_prompt',
            continuationId: state.pendingInterrupt.continuationId,
            decision: 'continue',
            resumedByUserId: resume.resumedByUserId ?? null,
          },
          roundsCompleted: 0,
          activeWindowDurationMs: 0,
          contextFrame: buildContextFrame(state),
          finalization: buildDefaultFinalization(),
        },
      });
    }

    const approvalInterrupt = state.pendingInterrupt;
    const resume = interrupt({
      batchId: approvalInterrupt.batchId,
      requestIds: approvalInterrupt.requests.map((request) => request.requestId),
      requests: approvalInterrupt.requests.map((request) => ({
        requestId: request.requestId,
        kind: request.payload.kind,
        coalesced: request.coalesced,
        expiresAtIso: request.expiresAtIso,
      })),
    }) as GraphResumeInput;
    const decisions = normalizeApprovalResumeDecisions(approvalInterrupt, resume);
    const resumedContext: AgentGraphRuntimeContext = {
      ...runtimeContext,
      traceId: resume.resumeTraceId?.trim() || runtimeContext.traceId,
    };
    const toolMessages: ToolMessage[] = [];
    const resolvedResults: SerializedToolResult[] = [];
    const resolvedFiles: AgentGraphState['files'] = [];
    const resolutions: Array<Extract<NonNullable<AgentGraphState['interruptResolution']>, { kind: 'approval_review_batch' }>['resolutions'][number]> = [];
    let consumedDurationMs = 0;

    for (const request of approvalInterrupt.requests) {
      const decision = decisions.find((entry) => entry.requestId === request.requestId);
      if (!decision) {
        throw new Error(`Approval batch resume is missing a decision for request "${request.requestId}".`);
      }

      if (decision.status !== 'approved') {
        const result: SerializedToolResult = {
          name: request.call.name,
          success: false,
          error:
            decision.status === 'rejected'
              ? decision.decisionReasonText?.trim()
                ? `Approval rejected: ${decision.decisionReasonText.trim()}`
                : 'Approval rejected.'
              : 'Approval expired before execution.',
          errorType: 'execution',
          latencyMs: 0,
        };
        toolMessages.push(
          buildToolMessageFromOutcome({
            toolName: request.call.name,
            callId: request.call.id,
            content: JSON.stringify({
              status: decision.status,
              decisionReasonText: decision.decisionReasonText ?? null,
            }),
            result,
            files: [],
            status: 'error',
          }),
        );
        resolvedResults.push(result);
        resolutions.push({
          kind: 'approval_review',
          requestId: request.requestId,
          decision: decision.status,
          status: decision.status,
          reviewerId: decision.reviewerId ?? null,
          decisionReasonText: decision.decisionReasonText ?? null,
        });
        continue;
      }

      const executed = await executeApprovedReviewTask({
        requestId: request.requestId,
        toolName: request.call.name,
        callId: request.call.id,
        reviewerId: decision.reviewerId ?? null,
        decisionReasonText: decision.decisionReasonText ?? null,
        resumeTraceId: resume.resumeTraceId ?? null,
      });
      consumedDurationMs += executed.result.latencyMs ?? 0;
      toolMessages.push(
        buildToolMessageFromOutcome({
          toolName: executed.toolName,
          callId: executed.callId,
          content: executed.content,
          result: executed.result,
          files: executed.files,
          status: executed.result.success ? 'success' : 'error',
        }),
      );
      resolvedResults.push(executed.result);
      resolvedFiles.push(...executed.files);
      resolutions.push({
        kind: 'approval_review',
        requestId: request.requestId,
        decision: decision.status,
        status: normalizeResolvedApprovalStatus({
          decision: decision.status,
          actionStatus: executed.status,
          errorText: executed.result.error ?? null,
        }),
        reviewerId: decision.reviewerId ?? null,
        decisionReasonText: decision.decisionReasonText ?? null,
        errorText: executed.result.error ?? null,
      });
    }

    return new Command({
      goto: state.pendingWriteCalls.length > approvalInterrupt.requests.length ? 'approval_gate' : 'tool_call_turn',
      update: {
        messages: toolMessages,
        resumeContext: snapshotRuntimeContext(resumedContext),
        graphStatus: 'running',
        roundsCompleted: 0,
        activeWindowDurationMs: consumedDurationMs,
        interruptResolution: {
          kind: 'approval_review_batch',
          batchId: approvalInterrupt.batchId,
          resolutions,
        },
        pendingInterrupt: null,
        pendingWriteCalls: state.pendingWriteCalls.slice(approvalInterrupt.requests.length),
        toolResults: resolvedResults,
        files: resolvedFiles,
        finalToolDelivery: resolveFinalToolDelivery(state.finalToolDelivery, resolvedResults),
        contextFrame: buildContextFrame({
          ...state,
          toolResults: [...state.toolResults, ...resolvedResults],
          messages: [...(state.messages as BaseMessage[]), ...toolMessages],
        }),
      },
    });
  };

  const pauseForContinueNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    const toolContext = buildToolContext(state, runtimeContext, 'turn', config);
    const nextCompletedWindows = state.completedWindows + 1;
    const pauseReason = isTimedOut(state, graphConfig) ? 'graph_timeout' : 'step_window_exhausted';

    if (nextCompletedWindows >= GRAPH_CONTINUATION_MAX_WINDOWS) {
      const limitSummary = await buildWindowCloseoutSummary({
        state,
        runtimeContext,
        toolContext,
        graphConfig,
        pauseReason,
        continuationLimitReached: true,
      });
      const completionTimestamp = await captureGraphTimestampTask();
      return new Command({
        goto: 'finalize_turn',
        update: {
          replyText: limitSummary.text,
          completedWindows: nextCompletedWindows,
          totalRoundsCompleted:
            state.totalRoundsCompleted + (limitSummary.usedModel ? 1 : 0),
          graphStatus: 'completed',
          completionKind: 'pause_handoff',
          stopReason: 'max_windows_reached',
          deliveryDisposition: 'chat_reply',
          activeWindowDurationMs: addActiveWindowDuration(state, limitSummary.latencyMs),
          finalization: {
            attempted: true,
            succeeded: true,
            completedAt: completionTimestamp.iso,
            stopReason: 'max_windows_reached',
            completionKind: 'pause_handoff',
            deliveryDisposition: 'chat_reply',
            protocolRepairCount: state.protocolRepairCount,
            toolDeliveredFinal: false,
            contextFrame: buildContextFrame(state),
          },
          contextFrame: buildContextFrame(state),
        },
      });
    }

    const summary = await buildWindowCloseoutSummary({
      state,
      runtimeContext,
      toolContext,
      graphConfig,
      pauseReason,
    });
    const continuation = await createContinuationInterruptTask({
      threadId: runtimeContext.threadId,
      originTraceId: runtimeContext.originTraceId,
      latestTraceId: runtimeContext.traceId,
      guildId: runtimeContext.guildId,
      channelId: runtimeContext.channelId,
      requestedByUserId: runtimeContext.userId,
      pauseKind: pauseReason,
      completedWindows: nextCompletedWindows,
      maxWindows: GRAPH_CONTINUATION_MAX_WINDOWS,
      summaryText: summary.text,
      resumeNode: resolveContinueResumeNode(state),
    });

    const interruptTimestamp = await captureGraphTimestampTask();
    return new Command({
      goto: 'resume_interrupt',
      update: {
        replyText: summary.text,
        completedWindows: nextCompletedWindows,
        totalRoundsCompleted:
          state.totalRoundsCompleted + (summary.usedModel ? 1 : 0),
        graphStatus: 'interrupted',
        completionKind: 'pause_handoff',
        stopReason: resolveContinuationStopReason(continuation.pauseReason),
        deliveryDisposition: 'chat_reply_with_continue',
        activeWindowDurationMs: addActiveWindowDuration(state, summary.latencyMs),
        pendingInterrupt: {
          kind: 'continue_prompt',
          continuationId: continuation.id,
          pauseReason: continuation.pauseReason,
          requestedByUserId: continuation.requestedByUserId,
          channelId: continuation.channelId,
          guildId: continuation.guildId,
          summaryText: continuation.summaryText,
          completedWindows: continuation.completedWindows,
          maxWindows: continuation.maxWindows,
          expiresAtIso: continuation.expiresAtIso,
          resumeNode: continuation.resumeNode,
        },
        interruptResolution: null,
        finalization: {
          attempted: true,
          succeeded: true,
          completedAt: interruptTimestamp.iso,
          stopReason: resolveContinuationStopReason(continuation.pauseReason),
          completionKind: 'pause_handoff',
          deliveryDisposition: 'chat_reply_with_continue',
          protocolRepairCount: state.protocolRepairCount,
          toolDeliveredFinal: false,
          contextFrame: buildContextFrame(state),
        },
        contextFrame: buildContextFrame(state),
      },
    });
  };

  const finalizeTurnNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => ({
    graphStatus: state.graphStatus === 'failed' ? 'failed' : 'completed',
    pendingReadCalls: [],
    pendingReadExecutionCalls: [],
    pendingWriteCalls: [],
  });

  return new StateGraph({
    state: AgentGraphStateSchema,
    context: AgentGraphConfigurableSchema,
  })
    .addNode('decide_turn', decideTurnNode, {
      ends: ['tool_call_turn', 'pause_for_continue'],
    })
    .addNode('tool_call_turn', toolCallTurnNode, {
      ends: ['route_tool_phase', 'tool_call_turn', 'pause_for_continue', 'closeout_turn'],
    })
    .addNode('route_tool_phase', routeToolPhaseNode, {
      ends: ['execute_read_tools', 'approval_gate', 'tool_call_turn', 'closeout_turn', 'finalize_turn'],
    })
    .addNode('closeout_turn', closeoutTurnNode, {
      ends: ['finalize_turn'],
    })
    .addNode('execute_read_tools', executeReadToolsNode, {
      ends: ['approval_gate', 'tool_call_turn'],
    })
    .addNode('approval_gate', approvalGateNode, {
      ends: ['resume_interrupt', 'tool_call_turn'],
    })
    .addNode('pause_for_continue', pauseForContinueNode, {
      ends: ['resume_interrupt', 'finalize_turn'],
    })
    .addNode('resume_interrupt', resumeInterruptNode, {
      ends: ['tool_call_turn', 'route_tool_phase', 'finalize_turn'],
    })
    .addNode('finalize_turn', finalizeTurnNode)
    .addEdge(START, 'decide_turn')
    .addEdge('finalize_turn', END)
    .compile({
      checkpointer,
      name: 'sage_agent_graph',
      description: 'Sage LangGraph-native runtime for provider-neutral agent orchestration.',
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

function isRecoverableInterruptedState(state: AgentGraphState): boolean {
  return (
    state.graphStatus === 'interrupted' &&
    !!state.pendingInterrupt &&
    (
      state.stopReason === 'approval_interrupt' ||
      state.stopReason === 'step_window_exhausted' ||
      state.stopReason === 'graph_timeout'
    )
  );
}

function coerceInterruptedState(value: unknown): AgentGraphState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const state = value as Partial<AgentGraphState>;
  if (
    state.graphStatus !== 'interrupted' ||
    (
      state.stopReason !== 'approval_interrupt' &&
      state.stopReason !== 'step_window_exhausted' &&
      state.stopReason !== 'graph_timeout'
    )
  ) {
    return null;
  }

  const pendingInterrupt = state.pendingInterrupt;
  if (!pendingInterrupt || typeof pendingInterrupt !== 'object' || typeof pendingInterrupt.kind !== 'string') {
    return null;
  }
  if (pendingInterrupt.kind === 'approval_review') {
    const approvalRequests = (pendingInterrupt as { requests?: unknown[] }).requests;
    if (
      typeof pendingInterrupt.requestId !== 'string' ||
      pendingInterrupt.requestId.trim().length === 0 ||
      !Array.isArray(approvalRequests) ||
      approvalRequests.length < 1
    ) {
      return null;
    }
  } else if (pendingInterrupt.kind === 'continue_prompt') {
    if (
      typeof pendingInterrupt.continuationId !== 'string' ||
      pendingInterrupt.continuationId.trim().length === 0
    ) {
      return null;
    }
  } else {
    return null;
  }

  if (typeof state.replyText !== 'string') {
    return null;
  }

  return state as AgentGraphState;
}

async function recoverInterruptedGraphState(
  graph: Pick<AgentGraphRuntime['graph'], 'getState'>,
  config: RunnableConfig,
  context: {
    reason: 'interrupt_sentinel' | 'stream_error' | 'missing_final_state';
    streamError?: unknown;
  },
  ): Promise<AgentGraphState | null> {
  try {
    const snapshot = await graph.getState(config);
    const state = coerceInterruptedState(snapshot.values);
    if (!state || !isRecoverableInterruptedState(state)) {
      return null;
    }
    const pendingInterrupt = state.pendingInterrupt;
    if (!pendingInterrupt) {
      return null;
    }
    const interruptId =
      pendingInterrupt.kind === 'approval_review'
        ? pendingInterrupt.requestId
        : pendingInterrupt.continuationId;

    const logPayload = {
      traceId: state.resumeContext.traceId,
      threadId: state.resumeContext.threadId,
      interruptKind: pendingInterrupt.kind,
      interruptId,
      recoveryReason: context.reason,
      streamError: context.streamError instanceof Error ? context.streamError.message : undefined,
    };

    if (context.reason === 'interrupt_sentinel') {
      logger.info(
        logPayload,
        'Recovered interrupted graph state from LangGraph checkpoint after receiving an interrupt sentinel stream chunk',
      );
    } else {
      logger.warn(
        logPayload,
        'Recovered interrupted graph state from LangGraph checkpoint after stream did not yield a terminal value',
      );
    }
    return state;
  } catch (error) {
    logger.warn(
      {
        error,
        reason: context.reason,
        streamError: context.streamError instanceof Error ? context.streamError.message : undefined,
      },
      'Failed to recover interrupted graph state from LangGraph checkpoint',
    );
    return null;
  }
}

function normalizeRecoveredGraphState(value: unknown): AgentGraphState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const state = value as Partial<AgentGraphState>;
  if (!Array.isArray(state.messages) || !Array.isArray(state.toolResults)) {
    return null;
  }

  return {
    messages: state.messages,
    resumeContext: state.resumeContext ?? snapshotRuntimeContext(EMPTY_RUNTIME_CONTEXT),
    pendingReadCalls: state.pendingReadCalls ?? [],
    pendingReadExecutionCalls: state.pendingReadExecutionCalls ?? [],
    pendingWriteCalls: state.pendingWriteCalls ?? [],
    replyText: state.replyText ?? '',
    toolResults: state.toolResults ?? [],
    files: state.files ?? [],
    roundsCompleted: state.roundsCompleted ?? 0,
    completedWindows: state.completedWindows ?? 0,
    totalRoundsCompleted: state.totalRoundsCompleted ?? 0,
    deduplicatedCallCount: state.deduplicatedCallCount ?? 0,
    lastToolBatchFingerprint: state.lastToolBatchFingerprint ?? null,
    consecutiveIdenticalToolBatches: state.consecutiveIdenticalToolBatches ?? 0,
    loopGuardRecoveries: state.loopGuardRecoveries ?? 0,
    roundEvents: state.roundEvents ?? [],
    finalization: {
      ...buildDefaultFinalization(),
      ...(state.finalization ?? {}),
    },
    completionKind: state.completionKind ?? null,
    stopReason: state.stopReason ?? 'verified_closeout',
    deliveryDisposition: state.deliveryDisposition ?? 'chat_reply',
    protocolRepairCount: state.protocolRepairCount ?? state.finalization?.protocolRepairCount ?? 0,
    finalToolDelivery: state.finalToolDelivery ?? null,
    contextFrame: state.contextFrame ?? buildDefaultContextFrame(),
    graphStatus: state.graphStatus ?? 'running',
    activeWindowDurationMs: state.activeWindowDurationMs ?? 0,
    pendingInterrupt: state.pendingInterrupt ?? null,
    interruptResolution: state.interruptResolution ?? null,
  };
}

async function recoverLoopGuardState(
  graph: Pick<AgentGraphRuntime['graph'], 'getState'>,
  config: RunnableConfig,
  streamError: unknown,
): Promise<AgentGraphState | null> {
  try {
    const snapshot = await graph.getState(config);
    const state = normalizeRecoveredGraphState(snapshot.values);
    if (!state) {
      return null;
    }

    const completionTimestamp = new Date().toISOString();
    const pendingCallCount =
      state.pendingReadCalls.length +
      state.pendingReadExecutionCalls.length +
      state.pendingWriteCalls.length;
    const nextRoundEvents =
      pendingCallCount > 0
        ? [
            ...state.roundEvents,
            {
              round: Math.max(1, state.roundsCompleted),
              requestedCallCount: pendingCallCount,
              executedCallCount: 0,
              deduplicatedCallCount: 0,
              uniqueCallCount: pendingCallCount,
              skippedDuplicateCallCount: 0,
              overLimitCallCount: 0,
              guardReason: 'recursion_limit',
              completedAt: completionTimestamp,
            } satisfies ToolCallRoundEvent,
          ]
        : state.roundEvents;

    logger.warn(
      {
        error: streamError,
        traceId: state.resumeContext.traceId,
        threadId: state.resumeContext.threadId,
      },
      'Recovered graph checkpoint after hitting the LangGraph recursion limit',
    );

    return {
      ...state,
      pendingReadCalls: [],
      pendingReadExecutionCalls: [],
      pendingWriteCalls: [],
      replyText: buildLoopGuardReply({
        reason: 'recursion_limit',
        state,
      }),
      roundEvents: nextRoundEvents,
      completionKind: 'loop_guard',
      stopReason: 'loop_guard',
      deliveryDisposition: 'chat_reply',
      graphStatus: 'completed',
      pendingInterrupt: null,
      finalization: {
        attempted: true,
        succeeded: true,
        completedAt: completionTimestamp,
        stopReason: 'loop_guard',
        completionKind: 'loop_guard',
        deliveryDisposition: 'chat_reply',
        protocolRepairCount: state.protocolRepairCount ?? state.finalization?.protocolRepairCount ?? 0,
        toolDeliveredFinal: false,
        contextFrame: buildContextFrame(state),
      },
    };
  } catch (error) {
    logger.warn(
      {
        error,
        streamError: streamError instanceof Error ? streamError.message : String(streamError),
      },
      'Failed to recover loop-guard graph state after hitting the LangGraph recursion limit',
    );
    return null;
  }
}

export async function runGraphValueStream(
  graph: Pick<AgentGraphRuntime['graph'], 'stream' | 'getState'>,
  input: Parameters<AgentGraphRuntime['graph']['invoke']>[0],
  config: RunnableConfig,
): Promise<AgentGraphState> {
  let lastValue: AgentGraphState | null = null;
  let streamError: unknown;

  try {
    const stream = await graph.stream(input, {
      ...config,
      streamMode: 'values',
    } as Parameters<typeof graph.stream>[1]);
    for await (const chunk of stream as AsyncIterable<unknown>) {
      if (isInterrupted(chunk)) {
        const recovered = await recoverInterruptedGraphState(graph, config, {
          reason: 'interrupt_sentinel',
        });
        if (recovered) {
          return recovered;
        }
        continue;
      }
      lastValue = chunk as AgentGraphState;
    }
  } catch (error) {
    streamError = error;
  }

  if (streamError) {
    const recovered = await recoverInterruptedGraphState(graph, config, {
      reason: 'stream_error',
      streamError,
    });
    if (recovered) {
      return recovered;
    }
    if (isGraphRecursionLimitError(streamError)) {
      const loopGuardState = await recoverLoopGuardState(graph, config, streamError);
      if (loopGuardState) {
        return loopGuardState;
      }
    }
    throw streamError;
  }

  if (!lastValue) {
    const recovered = await recoverInterruptedGraphState(graph, config, {
      reason: 'missing_final_state',
    });
    if (recovered) {
      return recovered;
    }
    throw new Error('Agent graph finished without a final state.');
  }

  return lastValue;
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

export async function __getAgentGraphStateForTests(threadId: string): Promise<AgentGraphState | null> {
  const runtime = await getRuntime();
  const snapshot = await runtime.graph.getState(
    buildRunnableConfig({
      threadId,
      recursionLimit: runtime.config.recursionLimit,
      runId: `${threadId}:state`,
      runName: 'sage_agent_state_lookup',
      context: {
        threadId,
        traceId: threadId,
      },
    }),
  );
  const values = snapshot.values;
  return values ? (values as AgentGraphState) : null;
}

function buildInitialState(params: StartAgentGraphTurnParams): AgentGraphState {
  return {
    messages: params.messages,
    resumeContext: snapshotRuntimeContext(createRuntimeContext(params)),
    pendingReadCalls: [],
    pendingReadExecutionCalls: [],
    pendingWriteCalls: [],
    replyText: '',
    toolResults: [],
    files: [],
    roundsCompleted: 0,
    completedWindows: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    lastToolBatchFingerprint: null,
    consecutiveIdenticalToolBatches: 0,
    loopGuardRecoveries: 0,
    roundEvents: [],
    finalization: buildDefaultFinalization(),
    completionKind: null,
    stopReason: 'verified_closeout',
    deliveryDisposition: 'chat_reply',
    protocolRepairCount: 0,
    finalToolDelivery: null,
    contextFrame: buildDefaultContextFrame(),
    graphStatus: 'running',
    activeWindowDurationMs: 0,
    pendingInterrupt: null,
    interruptResolution: null,
  };
}

function buildSeededGraphState(params: {
  threadId: string;
  runId: string;
  context?: Partial<AgentGraphRuntimeContext>;
  state?: Partial<AgentGraphState>;
}): AgentGraphState {
  const resolvedContext: AgentGraphRuntimeContext = {
    ...EMPTY_RUNTIME_CONTEXT,
    traceId: params.runId,
    originTraceId: params.runId,
    threadId: params.threadId,
    ...(params.context ?? {}),
    activeToolNames: [...(params.context?.activeToolNames ?? EMPTY_RUNTIME_CONTEXT.activeToolNames)],
    replyTarget: params.context?.replyTarget ?? null,
  };

  const seededState: AgentGraphState = {
    messages: [],
    resumeContext: snapshotRuntimeContext(resolvedContext),
    pendingReadCalls: [],
    pendingReadExecutionCalls: [],
    pendingWriteCalls: [],
    replyText: '',
    toolResults: [],
    files: [],
    roundsCompleted: 0,
    completedWindows: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    lastToolBatchFingerprint: null,
    consecutiveIdenticalToolBatches: 0,
    loopGuardRecoveries: 0,
    roundEvents: [],
    finalization: buildDefaultFinalization(),
    completionKind: null,
    stopReason: 'verified_closeout',
    deliveryDisposition: 'chat_reply',
    protocolRepairCount: 0,
    finalToolDelivery: null,
    contextFrame: buildDefaultContextFrame(),
    graphStatus: 'running',
    activeWindowDurationMs: 0,
    pendingInterrupt: null,
    interruptResolution: null,
    ...(params.state ?? {}),
  };

  seededState.resumeContext = params.state?.resumeContext ?? snapshotRuntimeContext(resolvedContext);
  return seededState;
}

export async function runAgentGraphTurn(params: StartAgentGraphTurnParams): Promise<AgentGraphTurnResult> {
  const runtime = await getRuntime();
  const telemetry = createAgentRunTelemetry();
  const context = createRuntimeContext(params);
  const output = await runGraphValueStream(
    runtime.graph,
    buildInitialState(params),
    buildRunnableConfig({
      threadId: context.threadId,
      recursionLimit: runtime.config.recursionLimit,
      runId: context.traceId,
      runName: 'sage_agent_turn',
      context,
      callbacks: telemetry.callbacks,
      tags: ['sage', 'agent-runtime', 'langgraph'],
      metadata: {
        routeKind: context.routeKind,
        channelId: context.channelId,
        guildId: context.guildId,
        userId: context.userId,
      },
    }),
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(context.traceId));
}

export async function runSeededAgentGraphTurn(params: {
  threadId: string;
  goto: GraphNodeName;
  state?: Partial<AgentGraphState>;
  context?: Partial<AgentGraphRuntimeContext>;
  runId?: string;
  runName?: string;
}): Promise<AgentGraphTurnResult> {
  const runtime = await getRuntime();
  const telemetry = createAgentRunTelemetry();
  const runId = params.runId?.trim() || params.context?.traceId?.trim() || params.threadId;
  const context: AgentGraphRuntimeContext = {
    ...EMPTY_RUNTIME_CONTEXT,
    traceId: runId,
    originTraceId: params.context?.originTraceId?.trim() || runId,
    threadId: params.threadId,
    ...(params.context ?? {}),
    activeToolNames: [...(params.context?.activeToolNames ?? EMPTY_RUNTIME_CONTEXT.activeToolNames)],
    replyTarget: params.context?.replyTarget ?? null,
  };
  const output = await runGraphValueStream(
    runtime.graph,
    new Command({
      goto: params.goto,
      update: Object.entries(
        buildSeededGraphState({
          threadId: params.threadId,
          runId,
          context,
          state: params.state,
        }),
      ) as [string, unknown][],
    }),
    buildRunnableConfig({
      threadId: params.threadId,
      recursionLimit: runtime.config.recursionLimit,
      runId,
      runName: params.runName?.trim() || 'sage_agent_test_command',
      context,
      callbacks: telemetry.callbacks,
      tags: ['sage', 'agent-runtime', 'langgraph', 'test-command'],
      metadata: {
        goto: params.goto,
        routeKind: context.routeKind,
        channelId: context.channelId,
        guildId: context.guildId,
        userId: context.userId,
      },
    }),
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(runId));
}

export const __runAgentGraphCommandForTests = runSeededAgentGraphTurn;

export async function resumeAgentGraphTurn(
  params: ResumeAgentGraphTurnParams,
): Promise<AgentGraphTurnResult> {
  const runtime = await getRuntime();
  const telemetry = createAgentRunTelemetry();
  const runId = params.resume.resumeTraceId?.trim() || params.threadId;
  const runtimeContextOverrides = Object.fromEntries(
    Object.entries(params.context ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<AgentGraphRuntimeContext>;
  const output = await runGraphValueStream(
    runtime.graph,
    new Command({
      resume: params.resume,
    }),
    buildRunnableConfig({
      threadId: params.threadId,
      recursionLimit: runtime.config.recursionLimit,
      runId,
      runName:
        params.resume.interruptKind === 'approval_review'
          ? 'sage_agent_approval_resume'
          : 'sage_agent_continue_resume',
      context: {
        threadId: params.threadId,
        traceId: runId,
        ...runtimeContextOverrides,
      },
      callbacks: telemetry.callbacks,
      tags: [
        'sage',
        'agent-runtime',
        params.resume.interruptKind === 'approval_review' ? 'approval-resume' : 'continue-resume',
      ],
      metadata: {
        threadId: params.threadId,
        interruptKind: params.resume.interruptKind,
        decision:
          params.resume.interruptKind === 'approval_review'
            ? params.resume.decisions.map((decision) => `${decision.requestId}:${decision.status}`).join(',')
            : params.resume.decision,
      },
    }),
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(runId));
}

export async function retryAgentGraphTurn(params: {
  threadId: string;
  context: Partial<AgentGraphRuntimeContext>;
  runId?: string;
  runName?: string;
}): Promise<AgentGraphTurnResult> {
  const runtime = await getRuntime();
  const telemetry = createAgentRunTelemetry();
  const runId = params.runId?.trim() || params.context.traceId?.trim() || params.threadId;
  const output = await runGraphValueStream(
    runtime.graph,
    null as Parameters<AgentGraphRuntime['graph']['invoke']>[0],
    buildRunnableConfig({
      threadId: params.threadId,
      recursionLimit: runtime.config.recursionLimit,
      runId,
      runName: params.runName?.trim() || 'sage_agent_turn_retry',
      context: {
        ...params.context,
        threadId: params.threadId,
      },
      callbacks: telemetry.callbacks,
      tags: ['sage', 'agent-runtime', 'langgraph', 'retry'],
      metadata: {
        routeKind: params.context.routeKind,
        channelId: params.context.channelId,
        guildId: params.context.guildId,
        userId: params.context.userId,
        retryThreadId: params.threadId,
      },
    }),
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(runId));
}

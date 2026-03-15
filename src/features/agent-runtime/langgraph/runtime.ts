import crypto from 'crypto';
import {
  Command,
  END,
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
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { getModelBudgetConfig } from '../../../platform/llm/model-budget-config';
import { planBudget, trimMessagesToBudget } from '../../../platform/llm/context-budgeter';
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
  AgentGraphPersistedContext,
  AgentGraphRuntimeContext,
  AgentGraphState,
  ApprovalResumeDecision,
  GraphResumeInput,
  GraphRebudgetEvent,
  GraphTurnTerminationReason,
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
  truncatedCallCount: z.number(),
  completedAt: z.string(),
  rebudgeting: GraphRebudgetEventSchema.optional(),
});

const ToolCallFinalizationEventSchema = z.object({
  attempted: z.boolean(),
  succeeded: z.boolean(),
  completedAt: z.string(),
  terminationReason: z.enum([
    'assistant_reply',
    'continue_prompt',
    'graph_timeout',
    'approval_interrupt',
    'max_windows_reached',
  ]),
  rebudgeting: GraphRebudgetEventSchema.optional(),
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
  resumeNode: z.enum(['llm_call', 'route_tool_phase']),
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
  truncatedCallCount: new ReducedValue(z.number().default(0), {
    reducer: (left, right) => left + right,
  }),
  roundEvents: new ReducedValue(z.array(ToolCallRoundEventSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  finalization: ToolCallFinalizationEventSchema.default({
    attempted: false,
    succeeded: true,
    completedAt: new Date(0).toISOString(),
    terminationReason: 'assistant_reply',
  }),
  terminationReason: z
    .enum(['assistant_reply', 'continue_prompt', 'graph_timeout', 'approval_interrupt', 'max_windows_reached'])
    .default('assistant_reply'),
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
  | 'llm_call'
  | 'route_tool_phase'
  | 'execute_read_tools'
  | 'approval_gate'
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
  truncatedCallCount: number;
  roundEvents: ToolCallRoundEvent[];
  finalization: ToolCallFinalizationEvent;
  terminationReason: GraphTurnTerminationReason;
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
    truncatedCallCount: state.truncatedCallCount,
    roundEvents: state.roundEvents,
    finalization: state.finalization,
    terminationReason: state.terminationReason,
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
  const modelConfig = getModelBudgetConfig(model);
  const budgetPlan = planBudget(modelConfig, {
    reservedOutputTokens: maxTokens ?? modelConfig.maxOutputTokens,
  });
  const { trimmed, stats } = trimMessagesToBudget(preparedMessages, budgetPlan, {
    keepSystemMessages: true,
    keepLastUserTurns: 4,
    visionFadeKeepLastUserImages: modelConfig.visionFadeKeepLastUserImages,
    attachmentTextMaxTokens: modelConfig.attachmentTextMaxTokens,
    estimator: modelConfig.estimation,
    visionEnabled: modelConfig.visionEnabled,
  });

  return {
    trimmedMessages: toLangChainMessages(trimmed),
    rebudgeting: {
      beforeCount: stats.beforeCount,
      afterCount: stats.afterCount,
      estimatedTokensBefore: stats.estimatedTokensBefore,
      estimatedTokensAfter: stats.estimatedTokensAfter,
      availableInputTokens: budgetPlan.availableInputTokens,
      reservedOutputTokens: budgetPlan.reservedOutputTokens,
      notes: [...stats.notes],
      trimmed:
        stats.beforeCount !== stats.afterCount ||
        stats.estimatedTokensBefore !== stats.estimatedTokensAfter ||
        stats.notes.length > 0,
    },
  };
}

function createGraphChatModel(params: {
  model?: string;
  apiKey?: string;
  temperature: number;
  timeoutMs?: number;
  maxTokens?: number;
}): AiProviderChatModel {
  const model = params.model?.trim() || appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
  if (!model) {
    throw new Error('AI_PROVIDER_MAIN_AGENT_MODEL must be configured before the agent graph can run.');
  }

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
  maxResultChars: number;
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
  resumeNode: 'llm_call' | 'route_tool_phase';
}

interface DurableGraphTimestampOutput {
  iso: string;
}

const invokeAgentModelTask = task(
  { name: 'sage_invoke_agent_model' },
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
            maxResultChars: input.maxResultChars,
          })
        : null;
    const runnable =
      catalog && catalog.allTools.length > 0 ? baseModel.bindTools(catalog.allTools, { tool_choice: 'auto' }) : baseModel;
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
    resumeNode: 'llm_call' | 'route_tool_phase';
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
      resumeNode: continuation.resumeNode as 'llm_call' | 'route_tool_phase',
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
): ToolExecutionContext {
  const currentGraphTurn = Math.max(1, state.roundsCompleted);
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
}): ToolMessage {
  return new ToolMessage({
    content: params.content,
    tool_call_id: params.callId ?? `${params.toolName}-call`,
    artifact: {
      result: params.result,
      files: params.files,
    },
    status: params.status,
  });
}

function resolveContinueResumeNode(state: AgentGraphState): 'llm_call' | 'route_tool_phase' {
  const lastMessage = state.messages.at(-1);
  if (lastMessage && AIMessage.isInstance(lastMessage) && (lastMessage.tool_calls?.length ?? 0) > 0) {
    return 'route_tool_phase';
  }
  return 'llm_call';
}

function resolveContinuationTerminationReason(
  pauseReason: 'graph_timeout' | 'step_window_exhausted',
): GraphTurnTerminationReason {
  return pauseReason === 'graph_timeout' ? 'graph_timeout' : 'continue_prompt';
}

function buildReadToolsNode(graphConfig: AgentGraphConfig) {
  return async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Partial<AgentGraphState>> => {
    const batchMessage = state.messages.at(-1);
    if (!AIMessage.isInstance(batchMessage)) {
      return {};
    }

    const runtimeContext = resolveRuntimeContext(state, config);
    const toolContext = buildToolContext(state, runtimeContext, 'turn');
    const catalog = buildActiveToolCatalog({
      activeToolNames: runtimeContext.activeToolNames,
      context: toolContext,
      timeoutMs: graphConfig.toolTimeoutMs,
      maxResultChars: graphConfig.maxResultChars,
    });
    const selectedTools = catalog.readOnlyTools.filter((tool) =>
      (batchMessage.tool_calls ?? []).some((call) => call.name === tool.name),
    );
    if (selectedTools.length === 0) {
      return {};
    }

    const output = (await new ToolNode(selectedTools).invoke(
      { messages: [batchMessage] },
      config as Parameters<InstanceType<typeof ToolNode>['invoke']>[1],
    )) as { messages?: ToolMessage[] };
    const toolMessages = Array.isArray(output.messages) ? output.messages : [];
    const nextToolResults = toolMessages
      .map((message) => (message.artifact as { result?: SerializedToolResult } | undefined)?.result)
      .filter((result): result is SerializedToolResult => Boolean(result));
    const nextFiles = toolMessages.flatMap((message) => {
      const artifact = message.artifact as { files?: AgentGraphState['files'] } | undefined;
      return artifact?.files ?? [];
    });

    return {
      messages: toolMessages,
      toolResults: nextToolResults,
      files: nextFiles,
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

  const callModelNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    if (isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.maxSteps) {
      return new Command({
        goto: 'pause_for_continue',
        update: {
          terminationReason: isTimedOut(state, graphConfig) ? 'graph_timeout' : 'continue_prompt',
          resumeContext: snapshotRuntimeContext(runtimeContext),
        },
      });
    }
    const toolContext = buildToolContext(state, runtimeContext, 'turn');
    const toolsEnabled =
      runtimeContext.activeToolNames.length > 0 &&
      state.roundsCompleted < graphConfig.maxSteps &&
      !isTimedOut(state, graphConfig);
    const prepared = buildRebudgetingEvent(
      state.messages as BaseMessage[],
      runtimeContext.model,
      runtimeContext.maxTokens,
    );
    const response = await invokeAgentModelTask({
      messages: toLlmMessages(prepared.trimmedMessages),
      activeToolNames: toolsEnabled ? runtimeContext.activeToolNames : [],
      toolContext,
      timeoutMs: graphConfig.toolTimeoutMs,
      maxResultChars: graphConfig.maxResultChars,
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
        goto:
          timedOutAfterModel
            ? 'pause_for_continue'
            : 'route_tool_phase',
        update: {
          messages: [aiMessage],
          activeWindowDurationMs: nextActiveWindowDurationMs,
          roundsCompleted: nextRoundsCompleted,
          totalRoundsCompleted: nextTotalRoundsCompleted,
          terminationReason:
            timedOutAfterModel
              ? 'graph_timeout'
              : state.terminationReason,
          resumeContext: snapshotRuntimeContext(runtimeContext),
        },
      });
    }

    const completionTimestamp = await captureGraphTimestampTask();
    return new Command({
      goto: 'finalize_turn',
      update: {
        messages: [aiMessage],
        replyText,
        activeWindowDurationMs: addActiveWindowDuration(state, response.latencyMs),
        roundsCompleted: nextRoundsCompleted,
        totalRoundsCompleted: nextTotalRoundsCompleted,
        terminationReason: 'assistant_reply',
        finalization: {
          attempted: true,
          succeeded: true,
          completedAt: completionTimestamp.iso,
          terminationReason: 'assistant_reply',
          rebudgeting: prepared.rebudgeting,
        },
        resumeContext: snapshotRuntimeContext(runtimeContext),
      },
    });
  };

  const routeToolPhaseNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const toolCalls = getLastAiToolCalls(state.messages as BaseMessage[]);
    const runtimeContext = resolveRuntimeContext(state, config);
    const toolContext = buildToolContext(state, runtimeContext, 'turn');
    const catalog = buildActiveToolCatalog({
      activeToolNames: runtimeContext.activeToolNames,
      context: toolContext,
      timeoutMs: graphConfig.toolTimeoutMs,
      maxResultChars: graphConfig.maxResultChars,
    });

    const requestedCallCount = toolCalls.length;
    const effectiveCalls = toolCalls.slice(0, graphConfig.maxToolCallsPerStep);
    const truncatedCallCount = Math.max(0, requestedCallCount - effectiveCalls.length);
    const seenReadOnly = new Set<string>();
    const readBatch: GraphToolCallDescriptor[] = [];
    const pendingWriteCalls: GraphToolCallDescriptor[] = [];
    let deduplicatedCallCount = 0;

    for (const call of effectiveCalls) {
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

      if (readOnly) {
        const dedupeKey = `${call.name}:${JSON.stringify(call.args ?? {})}`;
        if (seenReadOnly.has(dedupeKey)) {
          deduplicatedCallCount += 1;
          continue;
        }
        seenReadOnly.add(dedupeKey);
        readBatch.push(serializedCall);
        continue;
      }

      pendingWriteCalls.push(serializedCall);
    }

    const readBatchMessage =
      readBatch.length > 0
        ? new AIMessage({
            content: '',
            tool_calls: readBatch.map((call) => ({
              id: call.id,
              name: call.name,
              args:
                call.args && typeof call.args === 'object' && !Array.isArray(call.args)
                  ? (call.args as Record<string, unknown>)
                  : {},
              type: 'tool_call',
            })),
          })
        : null;

    const executedAny = readBatch.length > 0 || pendingWriteCalls.length > 0;

    return new Command({
      goto:
        readBatch.length > 0
          ? 'execute_read_tools'
          : pendingWriteCalls.length > 0
            ? 'approval_gate'
            : 'llm_call',
      update: {
        messages: readBatchMessage ? [readBatchMessage] : [],
        pendingWriteCalls,
        deduplicatedCallCount,
        truncatedCallCount,
        roundEvents: executedAny
          ? [
              await buildExecutionEvent(state, {
                requestedCallCount,
                executedCallCount: readBatch.length + pendingWriteCalls.length,
                deduplicatedCallCount,
                truncatedCallCount,
              }),
            ]
          : [],
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
      goto: state.pendingWriteCalls.length > 0 ? 'approval_gate' : 'llm_call',
      update: {
        ...update,
        activeWindowDurationMs: addActiveWindowDuration(state, readToolDurationMs),
      },
    });
  };

  const approvalGateNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const currentWriteCall = state.pendingWriteCalls[0] ?? null;
    if (!currentWriteCall) {
      return new Command({ goto: 'llm_call', update: {} });
    }

    const runtimeContext = resolveRuntimeContext(state, config);
    const turnToolContext = buildToolContext(state, runtimeContext, 'turn');
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
            terminationReason: 'approval_interrupt',
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
              terminationReason: 'approval_interrupt',
            },
          },
        });
      }
    }

    const outcome = await executeDurableToolTask({
      activeToolNames: runtimeContext.activeToolNames,
      call: currentWriteCall,
      context: turnToolContext,
      timeoutMs: graphConfig.toolTimeoutMs,
      maxResultChars: graphConfig.maxResultChars,
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
          terminationReason: 'approval_interrupt',
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
            terminationReason: 'approval_interrupt',
          },
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
      goto: state.pendingWriteCalls.length > 1 ? 'approval_gate' : 'llm_call',
      update: {
        activeWindowDurationMs: addActiveWindowDuration(state, outcome.result.latencyMs),
        pendingWriteCalls: state.pendingWriteCalls.slice(1),
        messages: [toolMessage],
        toolResults: [outcome.result],
        files: outcome.files,
      },
    });
  };

  const resumeInterruptNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    if (!state.pendingInterrupt) {
      return new Command({
        goto: 'llm_call',
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
            terminationReason: resolveContinuationTerminationReason(state.pendingInterrupt.pauseReason),
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
              terminationReason: resolveContinuationTerminationReason(state.pendingInterrupt.pauseReason),
            },
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
            terminationReason: resolveContinuationTerminationReason(state.pendingInterrupt.pauseReason),
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
              terminationReason: resolveContinuationTerminationReason(state.pendingInterrupt.pauseReason),
            },
          },
        });
      }

      return new Command({
        goto: state.pendingInterrupt.resumeNode,
        update: {
          replyText: '',
          resumeContext: snapshotRuntimeContext(resumedContext),
          graphStatus: 'running',
          terminationReason: 'assistant_reply',
          pendingInterrupt: null,
          interruptResolution: {
            kind: 'continue_prompt',
            continuationId: state.pendingInterrupt.continuationId,
            decision: 'continue',
            resumedByUserId: resume.resumedByUserId ?? null,
          },
          roundsCompleted: 0,
          activeWindowDurationMs: 0,
          finalization: {
            attempted: false,
            succeeded: true,
            completedAt: new Date(0).toISOString(),
            terminationReason: 'assistant_reply',
          },
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
        maxResultChars: graphConfig.maxResultChars,
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
      goto: state.pendingWriteCalls.length > approvalInterrupt.requests.length ? 'approval_gate' : 'llm_call',
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
      },
    });
  };

  const pauseForContinueNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    const nextCompletedWindows = state.completedWindows + 1;
    const summaryText = buildDeterministicRuntimeSummary(state, { paused: true });

    if (nextCompletedWindows >= GRAPH_CONTINUATION_MAX_WINDOWS) {
      const limitText = buildDeterministicRuntimeSummary(state, {
        continuationLimitReached: true,
      });
      const completionTimestamp = await captureGraphTimestampTask();
      return new Command({
        goto: 'finalize_turn',
        update: {
          replyText: limitText,
          completedWindows: nextCompletedWindows,
          graphStatus: 'completed',
          terminationReason: 'max_windows_reached',
          finalization: {
            attempted: true,
            succeeded: true,
            completedAt: completionTimestamp.iso,
            terminationReason: 'max_windows_reached',
          },
        },
      });
    }

    const continuation = await createContinuationInterruptTask({
      threadId: runtimeContext.threadId,
      originTraceId: runtimeContext.originTraceId,
      latestTraceId: runtimeContext.traceId,
      guildId: runtimeContext.guildId,
      channelId: runtimeContext.channelId,
      requestedByUserId: runtimeContext.userId,
      pauseKind: isTimedOut(state, graphConfig) ? 'graph_timeout' : 'step_window_exhausted',
      completedWindows: nextCompletedWindows,
      maxWindows: GRAPH_CONTINUATION_MAX_WINDOWS,
      summaryText,
      resumeNode: resolveContinueResumeNode(state),
    });

    const interruptTimestamp = await captureGraphTimestampTask();
    return new Command({
      goto: 'resume_interrupt',
      update: {
        replyText: summaryText,
        completedWindows: nextCompletedWindows,
        graphStatus: 'interrupted',
        terminationReason: resolveContinuationTerminationReason(continuation.pauseReason),
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
          terminationReason: resolveContinuationTerminationReason(continuation.pauseReason),
        },
      },
    });
  };

  const finalizeTurnNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => ({
    graphStatus: state.graphStatus === 'failed' ? 'failed' : 'completed',
    pendingWriteCalls: [],
  });

  return new StateGraph({
    state: AgentGraphStateSchema,
    context: AgentGraphConfigurableSchema,
  })
    .addNode('llm_call', callModelNode, {
      ends: ['route_tool_phase', 'pause_for_continue', 'finalize_turn'],
    })
    .addNode('route_tool_phase', routeToolPhaseNode, {
      ends: ['execute_read_tools', 'approval_gate', 'llm_call'],
    })
    .addNode('execute_read_tools', executeReadToolsNode, {
      ends: ['approval_gate', 'llm_call'],
    })
    .addNode('approval_gate', approvalGateNode, {
      ends: ['resume_interrupt', 'llm_call'],
    })
    .addNode('pause_for_continue', pauseForContinueNode, {
      ends: ['resume_interrupt', 'finalize_turn'],
    })
    .addNode('resume_interrupt', resumeInterruptNode, {
      ends: ['llm_call', 'route_tool_phase', 'finalize_turn'],
    })
    .addNode('finalize_turn', finalizeTurnNode)
    .addEdge(START, 'llm_call')
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
      state.terminationReason === 'approval_interrupt' ||
      state.terminationReason === 'continue_prompt' ||
      state.terminationReason === 'graph_timeout'
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
      state.terminationReason !== 'approval_interrupt' &&
      state.terminationReason !== 'continue_prompt' &&
      state.terminationReason !== 'graph_timeout'
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
    pendingWriteCalls: [],
    replyText: '',
    toolResults: [],
    files: [],
    roundsCompleted: 0,
    completedWindows: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    truncatedCallCount: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      completedAt: new Date(0).toISOString(),
      terminationReason: 'assistant_reply',
    },
    terminationReason: 'assistant_reply',
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
    pendingWriteCalls: [],
    replyText: '',
    toolResults: [],
    files: [],
    roundsCompleted: 0,
    completedWindows: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    truncatedCallCount: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      completedAt: new Date(0).toISOString(),
      terminationReason: 'assistant_reply',
    },
    terminationReason: 'assistant_reply',
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

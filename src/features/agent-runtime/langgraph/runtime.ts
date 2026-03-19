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
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { getModelBudgetConfig } from '../../../platform/llm/model-budget-config';
import { countMessagesTokens, estimateMessagesTokens, planBudget } from '../../../platform/llm/context-budgeter';
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
import { scrubFinalReplyText } from '../finalReplyScrubber';
import type { CurrentTurnContext, ReplyTargetContext } from '../continuityContext';
import {
  buildDefaultWorkingMemoryFrame,
  buildPromptContextContent,
  buildUniversalPromptContract,
  type PromptInputMode,
  type ToolObservationEvidence,
  type PromptWorkingMemoryFrame,
} from '../promptContract';
import type { ToolResult } from '../toolCallExecution';
import type { ToolExecutionContext } from '../toolRegistry';
import { ApprovalRequiredSignal } from '../toolControlSignals';
import { createAgentRunTelemetry } from '../observability/langsmith';
import { buildRuntimeFailureReply } from '../visibleReply';
import { buildToolCacheKey } from '../toolCache';
import { globalToolRegistry } from '../toolRegistry';
import { AppError } from '../../../shared/errors/app-error';
import { buildAgentGraphConfig, type AgentGraphConfig } from './config';
import {
  buildActiveToolCatalog,
  buildRuntimeControlTools,
  executeApprovedReviewTask,
  executeDurableToolTask,
  isReadOnlyToolCall,
  planReadOnlyToolExecution,
  prepareToolApprovalInterrupt,
  resolveRuntimeControlSignal,
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
  PlainTextOutcomeSource,
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
  structuredContent: z.unknown().optional(),
  modelSummary: z.string().optional(),
  error: z.string().optional(),
  errorType: z.string().optional(),
  telemetry: z.object({
    latencyMs: z.number().default(0),
    cacheHit: z.boolean().optional(),
    cacheKind: z.enum(['round', 'global', 'dedupe']).optional(),
    cacheScopeKey: z.string().optional(),
  }).default({ latencyMs: 0 }),
  artifactsMeta: z
    .array(
      z.object({
        kind: z.enum(['file', 'discord_artifact', 'governance_only']),
        filename: z.string().optional(),
        mimetype: z.string().optional(),
        byteLength: z.number().optional(),
        visibleSummary: z.string().optional(),
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
  countSource: z.enum(['local_tokenizer', 'fallback_estimator']),
  tokenizerEncoding: z.string(),
  imageTokenReserve: z.number(),
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
    'assistant_turn_completed',
    'approval_interrupt',
    'user_input_interrupt',
    'background_yield',
    'loop_guard',
    'runtime_failure',
    'cancelled',
  ]),
  completionKind: z.enum([
    'final_answer',
    'approval_pending',
    'user_input_pending',
    'loop_guard',
    'runtime_failure',
    'cancelled',
  ]),
  deliveryDisposition: z.enum(['response_session', 'approval_handoff']),
  finalizedBy: z.enum([
    'assistant_no_tool_calls',
    'approval_interrupt',
    'user_input_interrupt',
    'background_yield',
    'loop_guard',
    'runtime_failure',
    'cancelled',
  ]),
  draftRevision: z.number(),
  contextFrame: z
    .object({
      objective: z.string(),
      verifiedFacts: z.array(z.string()),
      completedActions: z.array(z.string()),
      openQuestions: z.array(z.string()),
      pendingApprovals: z.array(z.string()),
      deliveryState: z.enum(['none', 'awaiting_approval', 'paused', 'final']),
      nextAction: z.string(),
      activeEvidenceRefs: z.array(z.string()).optional(),
      droppedMessageCutoff: z.number().optional(),
      compactionRevision: z.number().optional(),
    })
    .optional(),
  rebudgeting: GraphRebudgetEventSchema.optional(),
});

const GraphArtifactDeliverySchema = z.object({
  toolName: z.string(),
  effectKind: z.enum(['governance_only', 'discord_artifact']),
  visibleSummary: z.string().optional(),
});

const GraphResponseSessionSchema = z.object({
  responseSessionId: z.string(),
  status: z.enum(['draft', 'awaiting_approval', 'waiting_user_input', 'final', 'failed']),
  latestText: z.string(),
  draftRevision: z.number(),
  sourceMessageId: z.string().nullable(),
  responseMessageId: z.string().nullable(),
  overflowMessageIds: z.array(z.string()).default([]),
  linkedArtifactMessageIds: z.array(z.string()),
});

const GraphContextFrameSchema = z.object({
  objective: z.string(),
  verifiedFacts: z.array(z.string()).default([]),
  completedActions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  pendingApprovals: z.array(z.string()).default([]),
  deliveryState: z.enum(['none', 'awaiting_approval', 'paused', 'final']).default('none'),
  nextAction: z.string(),
  activeEvidenceRefs: z.array(z.string()).default([]),
  droppedMessageCutoff: z.number().default(0),
  compactionRevision: z.number().default(0),
});

const ApprovalInterruptStateSchema = z.object({
  kind: z.literal('approval_review'),
  requestId: z.string(),
  batchId: z.string(),
  requests: z.array(ApprovalInterruptRequestStateSchema).min(1),
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

const GraphWaitingStateSchema = z.object({
  kind: z.enum(['approval_review', 'user_input']),
  prompt: z.string(),
  requestedByUserId: z.string(),
  channelId: z.string(),
  guildId: z.string().nullable(),
  responseMessageId: z.string().nullable().optional(),
});

const PromptWaitingFollowUpSchema = z.object({
  matched: z.boolean(),
  matchKind: z.enum(['direct_reply']),
  outstandingPrompt: z.string(),
  responseMessageId: z.string().nullable().optional(),
});

const GraphCompactionStateSchema = z.object({
  workingObjective: z.string(),
  verifiedFacts: z.array(z.string()).default([]),
  completedActions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  pendingApprovals: z.array(z.string()).default([]),
  deliveryState: z.enum(['none', 'awaiting_approval', 'paused', 'final']).default('none'),
  nextAction: z.string(),
  activeEvidenceRefs: z.array(z.string()).default([]),
  droppedMessageCutoff: z.number().default(0),
  compactionRevision: z.number().default(0),
  retainedRawMessageCount: z.number().default(0),
  retainedToolObservationCount: z.number().default(0),
  reason: z.enum([
    'tool_pressure',
    'round_pressure',
    'message_pressure',
    'approval_resolution',
    'yield_boundary',
  ]),
  inputTokensEstimate: z.number().default(0),
  outputTokensEstimate: z.number().default(0),
});

const GraphTokenUsageSchema = z.object({
  countSource: z.enum(['local_tokenizer', 'fallback_estimator']),
  tokenizerEncoding: z.string(),
  estimatedInputTokens: z.number().default(0),
  imageTokenReserve: z.number().default(0),
  requestCount: z.number().default(0),
  promptTokens: z.number().default(0),
  completionTokens: z.number().default(0),
  totalTokens: z.number().default(0),
  cachedTokens: z.number().default(0),
  reasoningTokens: z.number().default(0),
});

const PlainTextOutcomeSourceSchema = z.enum([
  'runtime_control_tool',
  'default_final_answer',
]);

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
  userProfileSummary: z.string().nullable().optional(),
  guildSagePersona: z.string().nullable().optional(),
  focusedContinuity: z.string().nullable().optional(),
  recentTranscript: z.string().nullable().optional(),
  voiceContext: z.string().nullable().optional(),
  waitingFollowUp: z.union([PromptWaitingFollowUpSchema, z.null()]).optional(),
  promptMode: z
    .enum(['standard', 'image_only', 'reply_only', 'direct_attention', 'durable_resume', 'waiting_follow_up'])
    .optional(),
  promptVersion: z.string().nullable().optional(),
  promptFingerprint: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
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
    userProfileSummary: z.string().nullable().optional(),
    guildSagePersona: z.string().nullable().optional(),
    focusedContinuity: z.string().nullable().optional(),
    recentTranscript: z.string().nullable().optional(),
    voiceContext: z.string().nullable().optional(),
    waitingFollowUp: z.union([PromptWaitingFollowUpSchema, z.null()]).optional(),
    promptMode: z
      .enum(['standard', 'image_only', 'reply_only', 'direct_attention', 'durable_resume', 'waiting_follow_up'])
      .optional(),
    promptVersion: z.string().nullable().optional(),
    promptFingerprint: z.string().nullable().optional(),
    runId: z.string().nullable().optional(),
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
  sliceIndex: z.number().default(0),
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
    stopReason: 'assistant_turn_completed',
    completionKind: 'final_answer',
    deliveryDisposition: 'response_session',
    finalizedBy: 'assistant_no_tool_calls',
    draftRevision: 0,
  }),
  completionKind: z
    .enum([
      'final_answer',
      'approval_pending',
      'user_input_pending',
      'loop_guard',
      'runtime_failure',
      'cancelled',
    ])
    .nullable()
    .default(null),
  stopReason: z
    .enum([
      'assistant_turn_completed',
      'approval_interrupt',
      'user_input_interrupt',
      'background_yield',
      'loop_guard',
      'runtime_failure',
      'cancelled',
    ])
    .default('assistant_turn_completed'),
  deliveryDisposition: z.enum(['response_session', 'approval_handoff']).default('response_session'),
  responseSession: GraphResponseSessionSchema.default({
    responseSessionId: '',
    status: 'draft',
    latestText: '',
    draftRevision: 0,
    sourceMessageId: null,
    responseMessageId: null,
    overflowMessageIds: [],
    linkedArtifactMessageIds: [],
  }),
  artifactDeliveries: new ReducedValue(z.array(GraphArtifactDeliverySchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  contextFrame: GraphContextFrameSchema.default({
    objective: 'Finish the current user request cleanly.',
    verifiedFacts: [],
    completedActions: [],
    openQuestions: [],
    pendingApprovals: [],
    deliveryState: 'none',
    nextAction: 'Decide the next best step.',
    activeEvidenceRefs: [],
    droppedMessageCutoff: 0,
    compactionRevision: 0,
  }),
  waitingState: z.union([GraphWaitingStateSchema, z.null()]).default(null),
  compactionState: z.union([GraphCompactionStateSchema, z.null()]).default(null),
  yieldReason: z
    .enum(['slice_budget_exhausted', 'provider_backoff', 'awaiting_compaction', 'worker_handoff'])
    .nullable()
    .default(null),
  graphStatus: z.enum(['running', 'interrupted', 'completed', 'failed']).default('running'),
  activeWindowDurationMs: z.number().default(0),
  pendingInterrupt: z.union([ApprovalInterruptStateSchema, z.null()]).default(null),
  interruptResolution: z
    .union([ApprovalResolutionStateSchema, ApprovalBatchResolutionStateSchema, z.null()])
    .default(null),
  tokenUsage: GraphTokenUsageSchema.default({
    countSource: 'local_tokenizer',
    tokenizerEncoding: 'o200k_base',
    estimatedInputTokens: 0,
    imageTokenReserve: 0,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
  }),
  plainTextOutcomeSource: z.union([PlainTextOutcomeSourceSchema, z.null()]).default(null),
});

type GraphNodeName =
  | 'decide_turn'
  | 'tool_call_turn'
  | 'route_tool_phase'
  | 'execute_read_tools'
  | 'approval_gate'
  | 'closeout_turn'
  | 'yield_background'
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
  userProfileSummary: null,
  guildSagePersona: null,
  focusedContinuity: null,
  recentTranscript: null,
  voiceContext: null,
  waitingFollowUp: null,
  promptMode: 'standard',
  promptVersion: null,
  promptFingerprint: null,
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
  userProfileSummary?: string | null;
  guildSagePersona?: string | null;
  focusedContinuity?: string | null;
  recentTranscript?: string | null;
  voiceContext?: string | null;
  waitingFollowUp?: AgentGraphRuntimeContext['waitingFollowUp'];
  promptMode?: PromptInputMode;
  promptVersion?: string | null;
  promptFingerprint?: string | null;
  invokedBy?: AgentGraphRuntimeContext['invokedBy'];
  invokerIsAdmin?: boolean;
  invokerCanModerate?: boolean;
  onStateUpdate?: (state: AgentGraphState) => Promise<void> | void;
}

export interface ResumeAgentGraphTurnParams {
  threadId: string;
  resume: GraphResumeInput;
  context?: Partial<AgentGraphRuntimeContext>;
  onStateUpdate?: (state: AgentGraphState) => Promise<void> | void;
}

export interface ContinueAgentGraphTurnParams {
  threadId: string;
  context?: Partial<AgentGraphRuntimeContext>;
  appendedMessages?: BaseMessage[];
  clearWaitingState?: boolean;
  runId?: string;
  runName?: string;
  onStateUpdate?: (state: AgentGraphState) => Promise<void> | void;
}

export interface AgentGraphTurnResult {
  replyText: string;
  toolResults: ToolResult[];
  files: Array<{ attachment: Buffer; name: string }>;
  roundsCompleted: number;
  sliceIndex: number;
  totalRoundsCompleted: number;
  deduplicatedCallCount: number;
  roundEvents: ToolCallRoundEvent[];
  finalization: ToolCallFinalizationEvent;
  completionKind: GraphCompletionKind | null;
  stopReason: GraphStopReason;
  deliveryDisposition: GraphDeliveryDisposition;
  responseSession: AgentGraphState['responseSession'];
  artifactDeliveries: AgentGraphState['artifactDeliveries'];
  contextFrame: GraphContextFrame;
  waitingState: AgentGraphState['waitingState'];
  compactionState: AgentGraphState['compactionState'];
  yieldReason: AgentGraphState['yieldReason'];
  graphStatus: AgentGraphState['graphStatus'];
  activeWindowDurationMs: number;
  pendingInterrupt: AgentGraphState['pendingInterrupt'];
  interruptResolution: AgentGraphState['interruptResolution'];
  tokenUsage: AgentGraphState['tokenUsage'];
  plainTextOutcomeSource: AgentGraphState['plainTextOutcomeSource'];
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
    stopReason: 'assistant_turn_completed',
    completionKind: 'final_answer',
    deliveryDisposition: 'response_session',
    finalizedBy: 'assistant_no_tool_calls',
    draftRevision: 0,
  };
}

function buildDefaultContextFrame(): GraphContextFrame {
  return buildDefaultWorkingMemoryFrame();
}

function buildDefaultResponseSession(threadId: string): AgentGraphState['responseSession'] {
  return {
    responseSessionId: threadId,
    status: 'draft',
    latestText: '',
    draftRevision: 0,
    sourceMessageId: null,
    responseMessageId: null,
    overflowMessageIds: [],
    linkedArtifactMessageIds: [],
  };
}

function readCurrentTurnMessageId(currentTurn: unknown): string | null {
  if (!currentTurn || typeof currentTurn !== 'object' || Array.isArray(currentTurn)) {
    return null;
  }
  const candidate = (currentTurn as { messageId?: unknown }).messageId;
  return typeof candidate === 'string' ? candidate : null;
}

function buildFollowUpResumeResponseSession(params: {
  runtimeContext: AgentGraphRuntimeContext;
  responseSessionId: string;
}): AgentGraphState['responseSession'] {
  return {
    ...buildDefaultResponseSession(params.responseSessionId),
    sourceMessageId: readCurrentTurnMessageId(params.runtimeContext.currentTurn),
    // A user-input follow-up starts a fresh visible reply surface while keeping the same task run.
    status: 'draft',
  };
}

function resolveDraftText(replyText: string | null | undefined): string {
  const cleaned = scrubFinalReplyText({ replyText });
  return cleaned || 'Working on that now.';
}

function bumpResponseSession(params: {
  state: AgentGraphState;
  latestText: string;
  status: AgentGraphState['responseSession']['status'];
}): AgentGraphState['responseSession'] {
  const current = params.state.responseSession;
  const nextText = params.latestText.trim();
  const textChanged = nextText !== current.latestText;
  const statusChanged = params.status !== current.status;
  return {
    ...current,
    status: params.status,
    latestText: nextText,
    draftRevision: textChanged || statusChanged ? current.draftRevision + 1 : current.draftRevision,
  };
}

function buildDeterministicRuntimeSummary(
  state: Pick<AgentGraphState, 'toolResults' | 'messages' | 'replyText'>,
  options?: {
    backgroundYield?: boolean;
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

  if (latestAssistantText) {
    parts.push(latestAssistantText);
  } else if (cleanedReplyText) {
    parts.push(cleanedReplyText);
  } else if (successful.length > 0 && failed.length > 0) {
    parts.push('I made some progress, but I also ran into a problem.');
  } else if (successful.length > 0) {
    parts.push('I made some progress on that.');
  } else if (failed.length > 0) {
    parts.push('I ran into a problem while working on that.');
  }

  if (options?.backgroundYield) {
    parts.push('I’m still working on that.');
  } else if (parts.length === 0) {
    parts.push('I’m still working on that.');
  }

  return parts.join(' ').trim();
}

const WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS =
  (appConfig.AGENT_WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS as number | undefined) ?? 2_400;
const WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS =
  (appConfig.AGENT_WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS as number | undefined) ?? 20_000;
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
}): string {
  return [params.summaryBody.trim(), 'I’m still working on that.']
    .filter((part) => part.length > 0)
    .join(' ')
    .trim();
}

async function buildWindowCloseoutSummary(params: {
  state: AgentGraphState;
  runtimeContext: AgentGraphRuntimeContext;
  toolContext: ToolExecutionContext;
  graphConfig: AgentGraphConfig;
  pauseReason: 'background_yield';
}): Promise<{
  text: string;
  usedModel: boolean;
  latencyMs: number;
}> {
  const deterministic = buildDeterministicRuntimeSummary(params.state, {
    backgroundYield: true,
  });

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
        text: wrapWindowCloseoutReply({ summaryBody }),
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
      },
      'Background-yield summary model call failed; using deterministic summary fallback',
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
    userProfileSummary: params.userProfileSummary ?? null,
    guildSagePersona: params.guildSagePersona ?? null,
    focusedContinuity: params.focusedContinuity ?? null,
    recentTranscript: params.recentTranscript ?? null,
    voiceContext: params.voiceContext ?? null,
    waitingFollowUp: params.waitingFollowUp ?? null,
    promptMode: params.promptMode ?? 'standard',
    promptVersion: params.promptVersion ?? null,
    promptFingerprint: params.promptFingerprint ?? null,
  };
}

function snapshotRuntimeContext(runtimeContext: AgentGraphRuntimeContext): AgentGraphPersistedContext {
  const { apiKey, ...persisted } = runtimeContext;
  void apiKey;
  return {
    ...persisted,
    promptMode: persisted.promptMode === 'waiting_follow_up' ? 'standard' : persisted.promptMode,
    waitingFollowUp: null,
  };
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
    sliceIndex: state.sliceIndex,
    totalRoundsCompleted: state.totalRoundsCompleted,
    deduplicatedCallCount: state.deduplicatedCallCount,
    roundEvents: state.roundEvents,
    finalization: state.finalization,
    completionKind: state.completionKind,
    stopReason: state.stopReason,
    deliveryDisposition: state.deliveryDisposition,
    responseSession: state.responseSession,
    artifactDeliveries: state.artifactDeliveries,
    contextFrame: state.contextFrame,
    waitingState: state.waitingState,
    compactionState: state.compactionState,
    yieldReason: state.yieldReason,
    graphStatus: state.graphStatus,
    activeWindowDurationMs: state.activeWindowDurationMs,
    pendingInterrupt: state.pendingInterrupt,
    interruptResolution: state.interruptResolution,
    tokenUsage: state.tokenUsage,
    plainTextOutcomeSource: state.plainTextOutcomeSource,
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
  const resolvedModel = resolveGraphModelId(model);
  const modelConfig = getModelBudgetConfig(resolvedModel);
  const budgetPlan = planBudget(modelConfig, {
    reservedOutputTokens: maxTokens ?? modelConfig.maxOutputTokens,
  });
  const tokenCount = countMessagesTokens(preparedMessages, resolvedModel);

  return {
    trimmedMessages: toLangChainMessages(preparedMessages),
    rebudgeting: {
      beforeCount: preparedMessages.length,
      afterCount: preparedMessages.length,
      estimatedTokensBefore: tokenCount.totalTokens,
      estimatedTokensAfter: tokenCount.totalTokens,
      countSource: tokenCount.source,
      tokenizerEncoding: tokenCount.encodingName,
      imageTokenReserve: tokenCount.imageTokenReserve,
      availableInputTokens: budgetPlan.availableInputTokens,
      reservedOutputTokens: budgetPlan.reservedOutputTokens,
      notes:
        tokenCount.totalTokens > budgetPlan.availableInputTokens
          ? ['Sage no longer re-budgets graph messages before provider calls; overflow is deferred to the provider/runtime boundary.']
          : [],
      trimmed: false,
    },
  };
}

function mergeTokenUsage(params: {
  current: AgentGraphState['tokenUsage'];
  rebudgeting: GraphRebudgetEvent;
  usage?: DurableModelInvokeOutput['usage'];
}): AgentGraphState['tokenUsage'] {
  return {
    countSource: params.rebudgeting.countSource,
    tokenizerEncoding: params.rebudgeting.tokenizerEncoding,
    estimatedInputTokens: params.rebudgeting.estimatedTokensAfter,
    imageTokenReserve: params.rebudgeting.imageTokenReserve,
    requestCount: params.current.requestCount + (params.usage ? 1 : 0),
    promptTokens: params.current.promptTokens + (params.usage?.promptTokens ?? 0),
    completionTokens: params.current.completionTokens + (params.usage?.completionTokens ?? 0),
    totalTokens: params.current.totalTokens + (params.usage?.totalTokens ?? 0),
    cachedTokens: params.current.cachedTokens + (params.usage?.cachedTokens ?? 0),
    reasoningTokens: params.current.reasoningTokens + (params.usage?.reasoningTokens ?? 0),
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
  if (!(error instanceof AppError)) {
    return false;
  }

  switch (error.code) {
    case 'AI_PROVIDER_RATE_LIMIT':
    case 'AI_PROVIDER_TIMEOUT':
    case 'AI_PROVIDER_NETWORK':
    case 'AI_PROVIDER_UPSTREAM':
      return true;
    default:
      return false;
  }
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
  internalTools?: DynamicStructuredTool[];
  allowedToolNames?: string[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  parallelToolCalls?: boolean;
}

interface DurableModelInvokeOutput {
  message: LLMChatMessage;
  latencyMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
    raw?: Record<string, unknown>;
  };
}

interface DurableApprovalMaterializationOutput {
  requestId: string;
  threadId: string;
  coalesced: boolean;
  expiresAtIso: string;
}

interface DurableGraphTimestampOutput {
  iso: string;
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
    const internalTools = input.internalTools ?? [];
    const boundTools = [...(catalog?.allTools ?? []), ...internalTools];
    const allowedTools = input.allowedToolNames
      ?? [
        ...(catalog?.providerAllowedToolNames ?? []),
        ...internalTools.map((tool) => tool.name).filter((name): name is string => typeof name === 'string' && name.trim().length > 0),
      ];
    const runnable = baseModel.bindTools(boundTools, {
      tool_choice: input.toolChoice ?? 'auto',
      allowedTools,
      parallelToolCalls: input.parallelToolCalls ?? catalog?.parallelToolCallsAllowed ?? false,
    });
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
    const usage = aiMessage.response_metadata?.usage;
    return {
      message: message ?? {
        role: 'assistant',
        content: extractMessageText(aiMessage),
      },
      latencyMs: Math.max(0, Date.now() - startedAt),
      usage:
        usage &&
        typeof usage === 'object' &&
        typeof (usage as { promptTokens?: unknown }).promptTokens === 'number' &&
        typeof (usage as { completionTokens?: unknown }).completionTokens === 'number' &&
        typeof (usage as { totalTokens?: unknown }).totalTokens === 'number'
          ? (usage as DurableModelInvokeOutput['usage'])
          : undefined,
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
  return state.activeWindowDurationMs >= graphConfig.sliceMaxDurationMs;
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
        telemetry: { latencyMs: 0 },
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
  void params.state;
  return params.reason === 'too_many_tool_calls'
    ? 'I need to handle that in smaller steps, so please tell me what to do first.'
    : params.reason === 'repeated_identical_batch'
      ? 'I got stuck repeating myself, so please tell me the next step more clearly.'
      : 'I need a smaller follow-up so I can finish that safely.';
}

function buildContextFrame(state: Pick<
    AgentGraphState,
    | 'messages'
    | 'toolResults'
    | 'replyText'
    | 'pendingInterrupt'
    | 'responseSession'
    | 'artifactDeliveries'
    | 'contextFrame'
    | 'compactionState'
  >): GraphContextFrame {
  if (state.compactionState) {
    return {
      objective: state.compactionState.workingObjective,
      verifiedFacts: [...state.compactionState.verifiedFacts],
      completedActions: [...state.compactionState.completedActions],
      openQuestions: [...state.compactionState.openQuestions],
      pendingApprovals: [...state.compactionState.pendingApprovals],
      deliveryState: state.compactionState.deliveryState,
      nextAction: state.compactionState.nextAction,
      activeEvidenceRefs: [...state.compactionState.activeEvidenceRefs],
      droppedMessageCutoff: state.compactionState.droppedMessageCutoff,
      compactionRevision: state.compactionState.compactionRevision,
    };
  }

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
    .map((result) => `${result.name}${result.telemetry?.cacheHit ? ' (cache)' : ''}`);
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
    state.responseSession.status === 'awaiting_approval'
      ? 'awaiting_approval'
      : state.responseSession.status === 'waiting_user_input'
        ? 'paused'
        : state.responseSession.status === 'final'
          ? 'final'
          : 'none';
  const nextAction =
    pendingApprovals.length > 0
      ? 'Wait for approval resolution and then continue the same response session.'
      : successfulResults.length > 0
        ? 'Use the latest tool results to decide whether more tools are needed or whether the next assistant turn can finalize with plain text.'
        : latestAssistantText
          ? 'Continue the visible draft, call the next tool if needed, or finish with a plain-text answer.'
          : 'Choose the next tool call or answer directly with plain text.';

  return {
    objective: objective.trim() || 'Finish the current user request cleanly.',
    verifiedFacts,
    completedActions,
    openQuestions,
    pendingApprovals,
    deliveryState,
    nextAction,
    activeEvidenceRefs: [],
    droppedMessageCutoff: 0,
    compactionRevision: 0,
  };
}

function normalizeWorkingMemoryFrame(frame: GraphContextFrame | null | undefined): PromptWorkingMemoryFrame {
  const fallback = buildDefaultWorkingMemoryFrame();
  if (!frame) {
    return fallback;
  }
  return {
    objective: frame.objective || fallback.objective,
    verifiedFacts: [...frame.verifiedFacts],
    completedActions: [...frame.completedActions],
    openQuestions: [...frame.openQuestions],
    pendingApprovals: [...frame.pendingApprovals],
    deliveryState: frame.deliveryState,
    nextAction: frame.nextAction || fallback.nextAction,
    activeEvidenceRefs: [...(frame.activeEvidenceRefs ?? [])],
    droppedMessageCutoff: frame.droppedMessageCutoff ?? 0,
    compactionRevision: frame.compactionRevision ?? 0,
  };
}

function extractLatestHumanRequestText(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!HumanMessage.isInstance(message)) {
      continue;
    }
    const text = extractMessageText(message).trim();
    if (text) {
      return text;
    }
  }
  return 'Continue the current turn using the latest working memory and tool results.';
}

function buildToolObservationEvidence(
  results: SerializedToolResult[],
  maxItems = 6,
): ToolObservationEvidence[] {
  if (results.length === 0) {
    return [];
  }

  return results.slice(-maxItems).map((result, index) => ({
    ref: `tool:${result.name}#${results.length - Math.min(results.length, maxItems) + index}`,
    toolName: result.name,
    status: result.success ? 'success' : 'failure',
    summary: result.success
      ? result.modelSummary?.trim() || `${result.name} completed successfully.`
      : `${result.name} failed.`,
    errorText: result.success ? null : result.error ?? result.errorType ?? 'Tool execution failed.',
    cacheHit: result.telemetry?.cacheHit ?? false,
  }));
}

function buildCompactionState(params: {
  state: AgentGraphState;
  graphConfig: AgentGraphConfig;
  reason: 'tool_pressure' | 'round_pressure' | 'message_pressure' | 'approval_resolution' | 'yield_boundary';
}): AgentGraphState['compactionState'] {
  const rawMessages = params.state.messages as BaseMessage[];
  const frame = buildContextFrame({
    ...params.state,
    compactionState: null,
  });
  const retainedRawMessageCount = Math.min(rawMessages.length, params.graphConfig.compactionMaxRawMessages);
  const retainedToolObservationCount = Math.min(
    params.state.toolResults.length,
    params.graphConfig.compactionMaxToolObservations,
  );
  return {
    workingObjective: frame.objective,
    verifiedFacts: frame.verifiedFacts.slice(-8),
    completedActions: frame.completedActions.slice(-8),
    openQuestions: frame.openQuestions.slice(-6),
    pendingApprovals: frame.pendingApprovals.slice(-4),
    deliveryState: frame.deliveryState,
    nextAction: frame.nextAction,
    activeEvidenceRefs: params.state.toolResults
      .slice(-retainedToolObservationCount)
      .map(
        (result, index) =>
          `tool:${result.name}#${params.state.toolResults.length - retainedToolObservationCount + index}`,
      ),
    droppedMessageCutoff: Math.max(0, rawMessages.length - retainedRawMessageCount),
    compactionRevision: (params.state.compactionState?.compactionRevision ?? 0) + 1,
    retainedRawMessageCount,
    retainedToolObservationCount,
    reason: params.reason,
    inputTokensEstimate: estimateMessagesTokens(
      toLlmMessages(rawMessages),
      resolveGraphModelId(params.state.resumeContext.model),
    ),
    outputTokensEstimate: params.graphConfig.maxOutputTokens,
  };
}

function shouldCompactState(params: {
  state: AgentGraphState;
  graphConfig: AgentGraphConfig;
  estimatedInputTokens: number;
}): boolean {
  if (!params.graphConfig.compactionEnabled) {
    return false;
  }

  return (
    params.estimatedInputTokens >= params.graphConfig.compactionTriggerEstimatedTokens ||
    params.state.roundsCompleted >= params.graphConfig.compactionTriggerRounds ||
    params.state.toolResults.length >= params.graphConfig.compactionTriggerToolResults ||
    (params.state.messages as BaseMessage[]).length > params.graphConfig.compactionMaxRawMessages
  );
}

function getSerializedToolLatencyMs(result: { telemetry?: { latencyMs?: number } } | null | undefined): number {
  return result?.telemetry?.latencyMs ?? 0;
}

function resolvePromptCurrentTurn(runtimeContext: AgentGraphRuntimeContext): CurrentTurnContext {
  const candidate = runtimeContext.currentTurn as Partial<CurrentTurnContext> | null | undefined;
  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.invokerUserId === 'string' &&
    typeof candidate.invokerDisplayName === 'string' &&
    typeof candidate.messageId === 'string' &&
    typeof candidate.channelId === 'string' &&
    typeof candidate.invokedBy === 'string'
  ) {
    return candidate as CurrentTurnContext;
  }

  return {
    invokerUserId: runtimeContext.userId,
    invokerDisplayName: 'Current User',
    messageId: runtimeContext.traceId || 'graph-turn',
    guildId: runtimeContext.guildId,
    channelId: runtimeContext.channelId,
    invokedBy: runtimeContext.invokedBy ?? 'component',
    mentionedUserIds: [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: null,
  };
}

function buildAssistantTurnMessages(params: {
  state: AgentGraphState;
  runtimeContext: AgentGraphRuntimeContext;
}): LLMChatMessage[] {
  const graphConfig = buildAgentGraphConfig();
  const prepared = buildRebudgetingEvent(
    params.state.messages as BaseMessage[],
    params.runtimeContext.model,
    params.runtimeContext.maxTokens,
  );
  const compactionState =
    params.state.compactionState ??
    (shouldCompactState({
      state: params.state,
      graphConfig,
      estimatedInputTokens: prepared.rebudgeting.estimatedTokensAfter,
    })
      ? buildCompactionState({
          state: params.state,
          graphConfig,
          reason:
            params.state.toolResults.length >= graphConfig.compactionTriggerToolResults
              ? 'tool_pressure'
              : params.state.roundsCompleted >= graphConfig.compactionTriggerRounds
                ? 'round_pressure'
                : 'message_pressure',
        })
      : null);
  const promptMessages =
    compactionState && compactionState.droppedMessageCutoff > 0
      ? (params.state.messages as BaseMessage[]).slice(-compactionState.retainedRawMessageCount)
      : (params.state.messages as BaseMessage[]);
  const frame = buildContextFrame({
    ...params.state,
    compactionState,
  });
  const contract = buildUniversalPromptContract({
    userProfileSummary: params.runtimeContext.userProfileSummary ?? null,
    currentTurn: resolvePromptCurrentTurn(params.runtimeContext),
    activeTools: params.runtimeContext.activeToolNames,
    model: params.runtimeContext.model ?? null,
    invokedBy: params.runtimeContext.invokedBy ?? null,
    invokerIsAdmin: params.runtimeContext.invokerIsAdmin,
    invokerCanModerate: params.runtimeContext.invokerCanModerate,
    inGuild: params.runtimeContext.guildId !== null,
    turnMode: params.runtimeContext.voiceContext ? 'voice' : 'text',
    guildSagePersona: params.runtimeContext.guildSagePersona ?? null,
    replyTarget: (params.runtimeContext.replyTarget as ReplyTargetContext | null | undefined) ?? null,
    userText: extractLatestHumanRequestText(params.state.messages as BaseMessage[]),
    focusedContinuity: params.runtimeContext.focusedContinuity ?? null,
    recentTranscript: params.runtimeContext.recentTranscript ?? null,
    voiceContext: params.runtimeContext.voiceContext ?? null,
    waitingFollowUp: params.runtimeContext.waitingFollowUp ?? null,
    graphLimits: {
      maxRounds: graphConfig.sliceMaxSteps,
    },
    workingMemoryFrame: normalizeWorkingMemoryFrame(frame),
    toolObservationEvidence: buildToolObservationEvidence(
      params.state.toolResults,
      compactionState?.retainedToolObservationCount ?? graphConfig.compactionMaxToolObservations,
    ),
    promptMode: 'durable_resume',
  });
  const contextMessageContent = buildPromptContextContent({
    replyTarget: (params.runtimeContext.replyTarget as ReplyTargetContext | null | undefined) ?? null,
    focusedContinuity: params.runtimeContext.focusedContinuity ?? null,
    recentTranscript: params.runtimeContext.recentTranscript ?? null,
    toolObservationEvidence: buildToolObservationEvidence(
      params.state.toolResults,
      compactionState?.retainedToolObservationCount ?? graphConfig.compactionMaxToolObservations,
    ),
    includeUserInput: false,
    userText: extractLatestHumanRequestText(params.state.messages as BaseMessage[]),
  });
  const preparedMessages = toLlmMessages(promptMessages);
  const messages: LLMChatMessage[] = [
    {
      role: 'system',
      content: contract.systemMessage,
    },
  ];
  if (contextMessageContent) {
    messages.push({
      role: 'user',
      content: typeof contextMessageContent === 'string' ? contextMessageContent : contextMessageContent,
    });
  }
  messages.push(...preparedMessages);
  return messages;
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

function resolveBackgroundYieldReason(
  state: AgentGraphState,
  graphConfig: AgentGraphConfig,
): AgentGraphState['yieldReason'] {
  if (shouldCompactState({
    state,
    graphConfig,
      estimatedInputTokens: estimateMessagesTokens(
        toLlmMessages(state.messages as BaseMessage[]),
        resolveGraphModelId(state.resumeContext.model),
      ),
  })) {
    return 'awaiting_compaction';
  }
  return 'slice_budget_exhausted';
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
    const executionPlan = planReadOnlyToolExecution({
      definitions: catalog.definitions,
      calls: state.pendingReadExecutionCalls,
      context: toolContext,
    });
    if (executionPlan.parallelCalls.length === 0 && executionPlan.sequentialCalls.length === 0) {
      return {
        pendingReadCalls: [],
        pendingReadExecutionCalls: [],
      };
    }

    const parallelBatchMessage =
      executionPlan.parallelCalls.length > 0
        ? new AIMessage({
            content: '',
            tool_calls: executionPlan.parallelCalls.map((call) => ({
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
    const selectedParallelTools =
      parallelBatchMessage === null
        ? []
        : catalog.readOnlyTools.filter((tool) =>
            (parallelBatchMessage.tool_calls ?? []).some((call) => call.name === tool.name),
          );
    const parallelOutput =
      selectedParallelTools.length > 0 && parallelBatchMessage
        ? ((await new ToolNode(selectedParallelTools).invoke(
            { messages: [parallelBatchMessage] },
            config as Parameters<InstanceType<typeof ToolNode>['invoke']>[1],
          )) as { messages?: ToolMessage[] })
        : { messages: [] };
    const parallelMessages = Array.isArray(parallelOutput.messages) ? parallelOutput.messages : [];
    const sequentialOutcomes = await Promise.all(
      executionPlan.sequentialCalls.map(async (call) => ({
        call,
        outcome: await executeDurableToolTask({
          activeToolNames: runtimeContext.activeToolNames,
          call,
          context: toolContext,
          timeoutMs: graphConfig.toolTimeoutMs,
        }),
      })),
    );
    const sequentialEntries = await Promise.all(
      sequentialOutcomes.map(async ({ call, outcome }) => ({
        call,
        fingerprint: await resolveToolCallFingerprint(call, toolContext),
        message:
          outcome.kind === 'tool_result'
            ? buildToolMessageFromOutcome({
                toolName: outcome.toolName,
                callId: outcome.callId,
                content: outcome.content,
                result: outcome.result,
                files: outcome.files,
                status: outcome.result.success ? 'success' : 'error',
              })
            : null,
      })),
    );
    const sequentialMessages = sequentialEntries
      .map((entry) => entry.message)
      .filter((message): message is ToolMessage => Boolean(message));
    const executedMessages = [...parallelMessages, ...sequentialMessages];
    const nextFiles = executedMessages.flatMap((message) => {
      const artifact = message.artifact as { files?: AgentGraphState['files'] } | undefined;
      return artifact?.files ?? [];
    });
    const parallelEntries = await Promise.all(
      executionPlan.parallelCalls.map(async (call, index) => ({
        call,
        fingerprint: await resolveToolCallFingerprint(call, toolContext),
        message: parallelMessages[index] ?? null,
      })),
    );
    const executedEntries = [...parallelEntries, ...sequentialEntries];
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
    // Sage already batches and executes the full read set inside buildReadToolsNode, so
    // this subgraph should always exit after one pass. Leaving a generic ToolNode loop
    // here can burn recursion hops if a tool batch yields no new ToolMessages.
    .addEdge('tools', END)
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
    if (isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.sliceMaxSteps) {
      return new Command({
        goto: 'yield_background',
        update: {
          stopReason: 'background_yield',
          yieldReason: resolveBackgroundYieldReason(state, graphConfig),
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
    if (isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.sliceMaxSteps) {
      return new Command({
        goto: 'yield_background',
        update: {
          stopReason: 'background_yield',
          yieldReason: resolveBackgroundYieldReason(state, graphConfig),
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
      internalTools: buildRuntimeControlTools(),
    });
    const [aiMessageCandidate] = toLangChainMessages([response.message]);
    const aiMessage = AIMessage.isInstance(aiMessageCandidate)
      ? aiMessageCandidate
      : new AIMessage({ content: extractMessageText(aiMessageCandidate as BaseMessage) });
    const replyText = extractMessageText(aiMessage).trim();
    const toolCalls = getLastAiToolCalls([aiMessage]);
    const runtimeControl = resolveRuntimeControlSignal(toolCalls);
    const nextActiveWindowDurationMs = addActiveWindowDuration(state, response.latencyMs);
    const timedOutAfterModel = nextActiveWindowDurationMs >= graphConfig.sliceMaxDurationMs;
    const nextRoundsCompleted = state.roundsCompleted + 1;
    const nextTotalRoundsCompleted = state.totalRoundsCompleted + 1;
    const nextMessages = [...(state.messages as BaseMessage[]), aiMessage];

    if (toolCalls.length > 0 && runtimeControl.controlCount === 0) {
      const draftText = resolveDraftText(replyText);
      const responseSession = bumpResponseSession({
        state,
        latestText: draftText,
        status: 'draft',
      });
      return new Command({
        goto: timedOutAfterModel ? 'yield_background' : 'route_tool_phase',
        update: {
          messages: [aiMessage],
          replyText: draftText,
          responseSession,
          activeWindowDurationMs: nextActiveWindowDurationMs,
          roundsCompleted: nextRoundsCompleted,
          totalRoundsCompleted: nextTotalRoundsCompleted,
          stopReason: timedOutAfterModel ? 'background_yield' : state.stopReason,
          yieldReason: timedOutAfterModel ? resolveBackgroundYieldReason(state, graphConfig) : null,
          resumeContext: snapshotRuntimeContext(runtimeContext),
          compactionState:
            timedOutAfterModel
              ? buildCompactionState({
                  state: {
                    ...state,
                    messages: nextMessages,
                    replyText: draftText,
                    responseSession,
                  },
                  graphConfig,
                  reason: 'yield_boundary',
                })
              : state.compactionState,
          contextFrame: buildContextFrame({
            ...state,
            messages: nextMessages,
            replyText: draftText,
            responseSession,
            compactionState:
              timedOutAfterModel
                ? buildCompactionState({
                    state: {
                      ...state,
                      messages: nextMessages,
                      replyText: draftText,
                      responseSession,
                    },
                    graphConfig,
                    reason: 'yield_boundary',
                  })
                : state.compactionState,
          }),
          finalization: {
            ...state.finalization,
            rebudgeting: prepared.rebudgeting,
          },
          tokenUsage: mergeTokenUsage({
            current: state.tokenUsage,
            rebudgeting: prepared.rebudgeting,
            usage: response.usage,
          }),
          plainTextOutcomeSource: null,
        },
      });
    }

    let completionKind: GraphCompletionKind;
    let finalReplyText: string;
    let plainTextOutcomeSource: PlainTextOutcomeSource;

    if (runtimeControl.controlCount > 0) {
      if (runtimeControl.invalid || runtimeControl.externalCount > 0 || !runtimeControl.signal) {
        completionKind = 'runtime_failure';
        finalReplyText = buildRuntimeFailureReply({
          kind: 'turn',
          category: 'runtime',
        });
        plainTextOutcomeSource = 'runtime_control_tool';
      } else {
        if (replyText.length > 0) {
          logger.warn(
            {
              threadId: runtimeContext.threadId,
              controlToolName: runtimeControl.signal.toolName,
            },
            'Runtime control tool returned alongside visible assistant text; preferring control tool args',
          );
        }
        const controlReplyText = scrubFinalReplyText({ replyText: runtimeControl.signal.replyText });
        if (!controlReplyText) {
          completionKind = 'runtime_failure';
          finalReplyText = buildRuntimeFailureReply({
            kind: 'turn',
            category: 'runtime',
          });
        } else {
          completionKind = runtimeControl.signal.kind;
          finalReplyText = controlReplyText;
        }
        plainTextOutcomeSource = 'runtime_control_tool';
      }
    } else {
      const visibleReplyText = scrubFinalReplyText({ replyText });
      if (!visibleReplyText) {
        completionKind = 'runtime_failure';
        finalReplyText = buildRuntimeFailureReply({
          kind: 'turn',
          category: 'runtime',
        });
      } else {
        completionKind = 'final_answer';
        finalReplyText = visibleReplyText;
      }
      plainTextOutcomeSource = 'default_final_answer';
    }

    const waitingForUserInput = completionKind === 'user_input_pending';
    const runtimeFailed = completionKind === 'runtime_failure';
    const waitingState =
      waitingForUserInput
        ? {
            kind: 'user_input' as const,
            prompt: finalReplyText,
            requestedByUserId: runtimeContext.userId,
            channelId: runtimeContext.channelId,
            guildId: runtimeContext.guildId,
            responseMessageId: state.responseSession.responseMessageId,
          }
        : null;
    const responseSession = bumpResponseSession({
      state,
      latestText: finalReplyText,
      status: waitingForUserInput ? 'waiting_user_input' : runtimeFailed ? 'failed' : 'final',
    });
    return new Command({
      goto: 'closeout_turn',
      update: {
        messages: [aiMessage],
        replyText: finalReplyText,
        completionKind,
        stopReason: waitingForUserInput
          ? 'user_input_interrupt'
          : runtimeFailed
            ? 'runtime_failure'
            : completionKind === 'cancelled'
              ? 'cancelled'
              : 'assistant_turn_completed',
        deliveryDisposition: 'response_session',
        responseSession,
        activeWindowDurationMs: nextActiveWindowDurationMs,
        roundsCompleted: nextRoundsCompleted,
        totalRoundsCompleted: nextTotalRoundsCompleted,
        resumeContext: snapshotRuntimeContext(runtimeContext),
        waitingState,
        contextFrame: buildContextFrame({
          ...state,
          messages: nextMessages,
          replyText: finalReplyText,
          responseSession,
        }),
        finalization: {
          ...state.finalization,
          rebudgeting: prepared.rebudgeting,
        },
        tokenUsage: mergeTokenUsage({
          current: state.tokenUsage,
          rebudgeting: prepared.rebudgeting,
          usage: response.usage,
        }),
        plainTextOutcomeSource,
      },
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
    if (requestedCallCount === 0) {
      const replyText = scrubFinalReplyText({
        replyText: state.replyText || findLatestAssistantText(state.messages as BaseMessage[]),
      });
      const completionKind = replyText ? (state.completionKind ?? 'final_answer') : 'runtime_failure';
      const waitingForUserInput = completionKind === 'user_input_pending';
      const runtimeFailed = completionKind === 'runtime_failure';
      const resolvedReplyText = replyText || buildRuntimeFailureReply({
        kind: 'turn',
        category: 'runtime',
      });
      const responseSession = bumpResponseSession({
        state,
        latestText: resolvedReplyText,
        status: waitingForUserInput ? 'waiting_user_input' : runtimeFailed ? 'failed' : 'final',
      });
      const nextState = {
        ...state,
        replyText: resolvedReplyText,
        responseSession,
      };
      return new Command({
        goto: 'closeout_turn',
        update: {
          replyText: resolvedReplyText,
          completionKind,
          stopReason:
            waitingForUserInput
              ? 'user_input_interrupt'
              : runtimeFailed
                ? 'runtime_failure'
              : completionKind === 'cancelled'
                ? 'cancelled'
              : 'assistant_turn_completed',
          deliveryDisposition: 'response_session',
          responseSession,
          contextFrame: buildContextFrame(nextState),
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
          deliveryDisposition: 'response_session',
          responseSession: bumpResponseSession({
            state,
            latestText: buildLoopGuardReply({
              reason: guardReason,
              state: {
                toolResults: [...state.toolResults, ...loopGuard.results],
                messages: [...(state.messages as BaseMessage[]), ...loopGuard.messages],
                replyText: state.replyText,
              },
            }),
            status: 'failed',
          }),
          contextFrame: buildContextFrame({
            ...state,
            replyText: buildLoopGuardReply({
              reason: guardReason,
              state: {
                toolResults: [...state.toolResults, ...loopGuard.results],
                messages: [...(state.messages as BaseMessage[]), ...loopGuard.messages],
                replyText: state.replyText,
              },
            }),
          }),
          finalization: {
            attempted: true,
            succeeded: true,
            completedAt: completionTimestamp.iso,
            stopReason: 'loop_guard',
            completionKind: 'loop_guard',
            deliveryDisposition: 'response_session',
            finalizedBy: 'loop_guard',
            draftRevision: state.responseSession.draftRevision + 1,
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
    const effectiveReplyText = scrubFinalReplyText({
      replyText: state.replyText || findLatestAssistantText(state.messages as BaseMessage[]),
    });
    const waitingForUserInput =
      state.completionKind === 'user_input_pending';
    const responseSession =
      state.responseSession.status === 'final' || state.responseSession.status === 'failed'
        ? state.responseSession
        : bumpResponseSession({
            state,
            latestText: effectiveReplyText || state.responseSession.latestText,
            status:
              state.completionKind === 'loop_guard' || state.completionKind === 'runtime_failure'
                ? 'failed'
                : waitingForUserInput
                  ? 'waiting_user_input'
                  : 'final',
          });
    const completionTimestamp = await captureGraphTimestampTask();
    return new Command({
      goto: 'finalize_turn',
      update: {
        replyText: effectiveReplyText,
        responseSession,
        contextFrame: frame,
        finalization: {
          attempted: true,
          succeeded: true,
          completedAt: completionTimestamp.iso,
          stopReason: state.stopReason,
          completionKind: state.completionKind ?? 'runtime_failure',
          deliveryDisposition: state.deliveryDisposition,
          finalizedBy:
            state.stopReason === 'approval_interrupt'
              ? 'approval_interrupt'
              : state.stopReason === 'loop_guard'
                ? 'loop_guard'
                : state.stopReason === 'background_yield'
                  ? 'background_yield'
                  : state.stopReason === 'user_input_interrupt'
                    ? 'user_input_interrupt'
                  : state.stopReason === 'runtime_failure'
                    ? 'runtime_failure'
                    : 'assistant_no_tool_calls',
          draftRevision: responseSession.draftRevision,
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
    ? update.toolResults.reduce((total, result) => total + getSerializedToolLatencyMs(result), 0)
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
        const responseSession = bumpResponseSession({
          state,
          latestText: resolveDraftText(state.replyText || state.responseSession.latestText),
          status: 'awaiting_approval',
        });
        return new Command({
          goto: 'resume_interrupt',
          update: {
            replyText: responseSession.latestText,
            graphStatus: 'interrupted',
            completionKind: 'approval_pending',
            stopReason: 'approval_interrupt',
            deliveryDisposition: 'approval_handoff',
            responseSession,
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
              completionKind: 'approval_pending',
              deliveryDisposition: 'approval_handoff',
              finalizedBy: 'approval_interrupt',
              draftRevision: responseSession.draftRevision,
              contextFrame: buildContextFrame({
                ...state,
                responseSession,
                replyText: responseSession.latestText,
              }),
            },
            contextFrame: buildContextFrame({
              ...state,
              responseSession,
              replyText: responseSession.latestText,
            }),
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

    if (!outcome) {
      const replyText = buildRuntimeFailureReply({
        kind: 'turn',
        category: 'runtime',
      });
      const responseSession = bumpResponseSession({
        state,
        latestText: replyText,
        status: 'failed',
      });
      return new Command({
        goto: 'closeout_turn',
        update: {
          replyText,
          completionKind: 'runtime_failure',
          stopReason: 'runtime_failure',
          deliveryDisposition: 'response_session',
          responseSession,
          contextFrame: buildContextFrame({
            ...state,
            replyText,
            responseSession,
          }),
        },
      });
    }

    if (outcome.kind === 'approval_required') {
      const materialized = await materializeApprovalInterruptTask({
        threadId: runtimeContext.threadId,
        originTraceId: runtimeContext.originTraceId,
        payload: outcome.payload,
      });
      const interruptTimestamp = await captureGraphTimestampTask();
      const responseSession = bumpResponseSession({
        state,
        latestText: resolveDraftText(state.replyText || state.responseSession.latestText),
        status: 'awaiting_approval',
      });

      return new Command({
        goto: 'resume_interrupt',
        update: {
          replyText: responseSession.latestText,
          graphStatus: 'interrupted',
          completionKind: 'approval_pending',
          stopReason: 'approval_interrupt',
          deliveryDisposition: 'approval_handoff',
          responseSession,
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
            completionKind: 'approval_pending',
            deliveryDisposition: 'approval_handoff',
            finalizedBy: 'approval_interrupt',
            draftRevision: responseSession.draftRevision,
            contextFrame: buildContextFrame({
              ...state,
              responseSession,
              replyText: responseSession.latestText,
            }),
          },
          contextFrame: buildContextFrame({
            ...state,
            responseSession,
            replyText: responseSession.latestText,
          }),
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
      activeWindowDurationMs: addActiveWindowDuration(state, getSerializedToolLatencyMs(outcome.result)),
        pendingWriteCalls: state.pendingWriteCalls.slice(1),
        messages: [toolMessage],
        toolResults: [outcome.result],
        files: outcome.files,
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
    if (!state.pendingInterrupt || state.pendingInterrupt.kind !== 'approval_review') {
      return new Command({
        goto: 'tool_call_turn',
        update: {},
      });
    }

    const runtimeContext = resolveRuntimeContext(state, config);
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
          telemetry: { latencyMs: 0 },
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
      consumedDurationMs += getSerializedToolLatencyMs(executed.result);
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

    const hasPendingFollowupWrites = state.pendingWriteCalls.length > approvalInterrupt.requests.length;
    const latestReplyText =
      state.responseSession.latestText ||
      resolveDraftText(state.replyText || findLatestAssistantText(state.messages as BaseMessage[]));
    const responseSession = bumpResponseSession({
      state,
      latestText: latestReplyText,
      status: hasPendingFollowupWrites ? 'awaiting_approval' : 'draft',
    });
    return new Command({
      goto: hasPendingFollowupWrites ? 'approval_gate' : 'tool_call_turn',
      update: {
        messages: toolMessages,
        resumeContext: snapshotRuntimeContext(resumedContext),
        graphStatus: 'running',
        roundsCompleted: 0,
        activeWindowDurationMs: consumedDurationMs,
        replyText: latestReplyText,
        responseSession,
        interruptResolution: {
          kind: 'approval_review_batch',
          batchId: approvalInterrupt.batchId,
          resolutions,
        },
        pendingInterrupt: null,
        pendingWriteCalls: state.pendingWriteCalls.slice(approvalInterrupt.requests.length),
        toolResults: resolvedResults,
        files: resolvedFiles,
        contextFrame: buildContextFrame({
          ...state,
          replyText: latestReplyText,
          responseSession,
          toolResults: [...state.toolResults, ...resolvedResults],
          messages: [...(state.messages as BaseMessage[]), ...toolMessages],
        }),
      },
    });
  };

  const yieldBackgroundNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    const toolContext = buildToolContext(state, runtimeContext, 'turn', config);
    const summary = await buildWindowCloseoutSummary({
      state,
      runtimeContext,
      toolContext,
      graphConfig,
      pauseReason: 'background_yield',
    });
    const yieldTimestamp = await captureGraphTimestampTask();
    const compactionState = buildCompactionState({
      state,
      graphConfig,
      reason: 'yield_boundary',
    });
    const responseSession = bumpResponseSession({
      state,
      latestText: summary.text,
      status: state.waitingState?.kind === 'user_input' ? 'waiting_user_input' : state.responseSession.status,
    });
    return new Command({
      goto: 'finalize_turn',
      update: {
        replyText: summary.text,
        responseSession,
        sliceIndex: state.sliceIndex + 1,
        totalRoundsCompleted:
          state.totalRoundsCompleted + (summary.usedModel ? 1 : 0),
        graphStatus: 'completed',
        completionKind: state.completionKind,
        stopReason: 'background_yield',
        deliveryDisposition: 'response_session',
        activeWindowDurationMs: addActiveWindowDuration(state, summary.latencyMs),
        yieldReason: resolveBackgroundYieldReason(state, graphConfig),
        compactionState,
        pendingInterrupt: null,
        interruptResolution: null,
        finalization: {
          attempted: true,
          succeeded: true,
          completedAt: yieldTimestamp.iso,
          stopReason: 'background_yield',
          completionKind: state.completionKind ?? 'final_answer',
          deliveryDisposition: 'response_session',
          finalizedBy: 'background_yield',
          draftRevision: responseSession.draftRevision,
          contextFrame: buildContextFrame({
            ...state,
            replyText: summary.text,
            responseSession,
            compactionState,
          }),
        },
        contextFrame: buildContextFrame({
          ...state,
          replyText: summary.text,
          responseSession,
          compactionState,
        }),
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
      ends: ['tool_call_turn', 'yield_background'],
    })
    .addNode('tool_call_turn', toolCallTurnNode, {
      ends: ['route_tool_phase', 'tool_call_turn', 'yield_background', 'closeout_turn'],
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
    .addNode('yield_background', yieldBackgroundNode, {
      ends: ['finalize_turn'],
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
    state.stopReason === 'approval_interrupt'
  );
}

function coerceInterruptedState(value: unknown): AgentGraphState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const state = value as Partial<AgentGraphState>;
  if (state.graphStatus !== 'interrupted' || state.stopReason !== 'approval_interrupt') {
    return null;
  }

  const pendingInterrupt = state.pendingInterrupt;
  if (!pendingInterrupt || typeof pendingInterrupt !== 'object' || typeof pendingInterrupt.kind !== 'string') {
    return null;
  }
  if (pendingInterrupt.kind !== 'approval_review') {
    return null;
  }
  const approvalRequests = (pendingInterrupt as { requests?: unknown[] }).requests;
  if (
    typeof pendingInterrupt.requestId !== 'string' ||
    pendingInterrupt.requestId.trim().length === 0 ||
    !Array.isArray(approvalRequests) ||
    approvalRequests.length < 1
  ) {
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
    const logPayload = {
      traceId: state.resumeContext.traceId,
      threadId: state.resumeContext.threadId,
      interruptKind: pendingInterrupt.kind,
      interruptId: pendingInterrupt.requestId,
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
    sliceIndex: state.sliceIndex ?? 0,
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
    stopReason: state.stopReason ?? 'assistant_turn_completed',
    deliveryDisposition: state.deliveryDisposition ?? 'response_session',
    responseSession:
      state.responseSession ??
      buildDefaultResponseSession(
        state.resumeContext?.threadId ?? state.resumeContext?.traceId ?? 'recovered-thread',
      ),
    artifactDeliveries: state.artifactDeliveries ?? [],
    contextFrame: state.contextFrame ?? buildDefaultContextFrame(),
    waitingState: state.waitingState ?? null,
    compactionState: state.compactionState ?? null,
    yieldReason: state.yieldReason ?? null,
    graphStatus: state.graphStatus ?? 'running',
    activeWindowDurationMs: state.activeWindowDurationMs ?? 0,
    pendingInterrupt: state.pendingInterrupt ?? null,
    interruptResolution: state.interruptResolution ?? null,
    tokenUsage: state.tokenUsage ?? {
      countSource: 'local_tokenizer',
      tokenizerEncoding: 'o200k_base',
      estimatedInputTokens: 0,
      imageTokenReserve: 0,
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
    plainTextOutcomeSource: state.plainTextOutcomeSource ?? null,
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
      deliveryDisposition: 'response_session',
      responseSession: bumpResponseSession({
        state,
        latestText: buildLoopGuardReply({
          reason: 'recursion_limit',
          state,
        }),
        status: 'failed',
      }),
      graphStatus: 'completed',
      pendingInterrupt: null,
      finalization: {
        attempted: true,
        succeeded: true,
        completedAt: completionTimestamp,
        stopReason: 'loop_guard',
        completionKind: 'loop_guard',
        deliveryDisposition: 'response_session',
        finalizedBy: 'loop_guard',
        draftRevision: state.responseSession.draftRevision + 1,
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
  onStateUpdate?: (state: AgentGraphState) => Promise<void> | void,
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
      await onStateUpdate?.(lastValue);
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
    sliceIndex: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    lastToolBatchFingerprint: null,
    consecutiveIdenticalToolBatches: 0,
    loopGuardRecoveries: 0,
    roundEvents: [],
    finalization: buildDefaultFinalization(),
    completionKind: null,
    stopReason: 'assistant_turn_completed',
    deliveryDisposition: 'response_session',
    responseSession: buildDefaultResponseSession(params.traceId),
    artifactDeliveries: [],
    contextFrame: buildDefaultContextFrame(),
    waitingState: null,
    compactionState: null,
    yieldReason: null,
    graphStatus: 'running',
    activeWindowDurationMs: 0,
    pendingInterrupt: null,
    interruptResolution: null,
    tokenUsage: {
      countSource: 'local_tokenizer',
      tokenizerEncoding: 'o200k_base',
      estimatedInputTokens: 0,
      imageTokenReserve: 0,
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
    plainTextOutcomeSource: null,
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
    sliceIndex: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    lastToolBatchFingerprint: null,
    consecutiveIdenticalToolBatches: 0,
    loopGuardRecoveries: 0,
    roundEvents: [],
    finalization: buildDefaultFinalization(),
    completionKind: null,
    stopReason: 'assistant_turn_completed',
    deliveryDisposition: 'response_session',
    responseSession: buildDefaultResponseSession(params.threadId),
    artifactDeliveries: [],
    contextFrame: buildDefaultContextFrame(),
    waitingState: null,
    compactionState: null,
    yieldReason: null,
    graphStatus: 'running',
    activeWindowDurationMs: 0,
    pendingInterrupt: null,
    interruptResolution: null,
    tokenUsage: {
      countSource: 'local_tokenizer',
      tokenizerEncoding: 'o200k_base',
      estimatedInputTokens: 0,
      imageTokenReserve: 0,
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
    plainTextOutcomeSource: null,
    ...(params.state ?? {}),
  };

  seededState.resumeContext = params.state?.resumeContext ?? snapshotRuntimeContext(resolvedContext);
  seededState.tokenUsage = params.state?.tokenUsage ?? seededState.tokenUsage;
  seededState.plainTextOutcomeSource = params.state?.plainTextOutcomeSource ?? seededState.plainTextOutcomeSource ?? null;
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
    params.onStateUpdate,
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
  onStateUpdate?: (state: AgentGraphState) => Promise<void> | void;
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
    params.onStateUpdate,
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
        'sage_agent_approval_resume',
      context: {
        threadId: params.threadId,
        traceId: runId,
        ...runtimeContextOverrides,
      },
      callbacks: telemetry.callbacks,
      tags: [
        'sage',
        'agent-runtime',
        'approval-resume',
      ],
      metadata: {
        threadId: params.threadId,
        interruptKind: params.resume.interruptKind,
        decision: params.resume.decisions.map((decision) => `${decision.requestId}:${decision.status}`).join(','),
      },
    }),
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(runId));
}

function resolveContinueNode(state: AgentGraphState): GraphNodeName {
  if (state.pendingInterrupt?.kind === 'approval_review') {
    return 'resume_interrupt';
  }
  if (state.pendingReadCalls.length > 0 || state.pendingReadExecutionCalls.length > 0 || state.pendingWriteCalls.length > 0) {
    return 'route_tool_phase';
  }
  return 'decide_turn';
}

export async function continueAgentGraphTurn(
  params: ContinueAgentGraphTurnParams,
): Promise<AgentGraphTurnResult> {
  const runtime = await getRuntime();
  const telemetry = createAgentRunTelemetry();
  const runId = params.runId?.trim() || params.context?.traceId?.trim() || params.threadId;
  const snapshot = await runtime.graph.getState(
    buildRunnableConfig({
      threadId: params.threadId,
      recursionLimit: runtime.config.recursionLimit,
      runId: `${runId}:continue-state`,
      runName: params.runName?.trim() || 'sage_agent_continue_state',
      context: {
        threadId: params.threadId,
        traceId: runId,
      },
    }),
  );
  const values = snapshot.values;
  if (!values) {
    throw new Error(`Agent graph state for thread "${params.threadId}" is unavailable.`);
  }

  const existingState = normalizeRecoveredGraphState(values);
  if (!existingState) {
    throw new Error(`Agent graph state for thread "${params.threadId}" could not be normalized.`);
  }
  const mergedContext: AgentGraphRuntimeContext = {
    ...existingState.resumeContext,
    traceId: runId,
    originTraceId: existingState.resumeContext.originTraceId || params.threadId,
    threadId: params.threadId,
    ...(params.context ?? {}),
    activeToolNames: [
      ...((params.context?.activeToolNames ?? existingState.resumeContext.activeToolNames) ?? []),
    ],
    replyTarget: params.context?.replyTarget ?? existingState.resumeContext.replyTarget ?? null,
  };
  const persistedMergedContext: AgentGraphRuntimeContext = params.clearWaitingState
    ? {
        ...mergedContext,
        waitingFollowUp: null,
        promptMode: existingState.resumeContext.promptMode ?? 'standard',
      }
    : mergedContext;
  const isWaitingFollowUpResume =
    params.clearWaitingState &&
    existingState.waitingState?.kind === 'user_input' &&
    mergedContext.promptMode === 'waiting_follow_up';
  const reopenedResponseSession = isWaitingFollowUpResume
    ? buildFollowUpResumeResponseSession({
        runtimeContext: mergedContext,
        responseSessionId: runId,
      })
    : existingState.responseSession.status === 'final' || existingState.responseSession.status === 'failed'
      ? {
          ...existingState.responseSession,
          status: 'draft' as const,
        }
      : existingState.responseSession;

  const output = await runGraphValueStream(
    runtime.graph,
    new Command({
      goto: resolveContinueNode(existingState),
      update: Object.entries({
        messages: [...(existingState.messages as BaseMessage[]), ...(params.appendedMessages ?? [])],
        resumeContext: snapshotRuntimeContext(persistedMergedContext),
        replyText: existingState.replyText,
        responseSession: reopenedResponseSession,
        waitingState: params.clearWaitingState ? null : existingState.waitingState,
        completionKind: null,
        stopReason: 'assistant_turn_completed',
        deliveryDisposition: existingState.deliveryDisposition,
        graphStatus: 'running',
        yieldReason: null,
        roundsCompleted: 0,
        activeWindowDurationMs: 0,
        finalization: buildDefaultFinalization(),
      }) as [string, unknown][],
    }),
    buildRunnableConfig({
      threadId: params.threadId,
      recursionLimit: runtime.config.recursionLimit,
      runId,
      runName: params.runName?.trim() || 'sage_agent_continue',
      context: mergedContext,
      callbacks: telemetry.callbacks,
      tags: ['sage', 'agent-runtime', 'langgraph', 'continue'],
      metadata: {
        threadId: params.threadId,
        routeKind: mergedContext.routeKind,
        channelId: mergedContext.channelId,
        guildId: mergedContext.guildId,
        userId: mergedContext.userId,
        continued: true,
      },
    }),
    params.onStateUpdate,
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(runId));
}

export async function retryAgentGraphTurn(params: {
  threadId: string;
  context: Partial<AgentGraphRuntimeContext>;
  runId?: string;
  runName?: string;
  onStateUpdate?: (state: AgentGraphState) => Promise<void> | void;
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
    params.onStateUpdate,
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(runId));
}

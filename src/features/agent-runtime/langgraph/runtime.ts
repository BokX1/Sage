import {
  Command,
  END,
  MemorySaver,
  MessagesValue,
  ReducedValue,
  START,
  StateGraph,
  StateSchema,
  interrupt,
  isInterrupted,
} from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { jsonrepair } from 'jsonrepair';
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
import { config as appConfig } from '../../../platform/config/env';
import { logger } from '../../../platform/logging/logger';
import { createOrReuseApprovalReviewRequestFromSignal } from '../../admin/adminActionService';
import {
  consumeGraphContinuationSession,
  createGraphContinuationSession,
  GRAPH_CONTINUATION_MAX_WINDOWS,
} from '../graphContinuationRepo';
import type { ToolResult } from '../toolCallExecution';
import type { ToolExecutionContext } from '../toolRegistry';
import { ApprovalRequiredSignal } from '../toolControlSignals';
import { createAgentRunTelemetry } from '../observability/langsmith';
import { buildAgentGraphConfig, type AgentGraphConfig } from './config';
import {
  buildActiveToolCatalog,
  executeApprovedReviewTask,
  executeDurableToolTask,
  isReadOnlyToolCall,
  type GraphToolCallDescriptor,
} from './nativeTools';
import type {
  AgentGraphRuntimeContext,
  AgentGraphState,
  GraphResumeInput,
  GraphRebudgetEvent,
  GraphTaskState,
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

const GraphTaskStatusSchema = z.enum([
  'framing',
  'executing',
  'needs_user_input',
  'ready_to_answer',
  'paused',
  'completed',
]);

const GraphTaskStateSchema = z.object({
  objective: z.string(),
  successCriteria: z.array(z.string()),
  currentSubgoal: z.string(),
  nextAction: z.string(),
  unresolvedItems: z.array(z.string()),
  evidenceSummary: z.string(),
  status: GraphTaskStatusSchema,
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
  guardrailBlockedCallCount: z.number(),
  completedAt: z.string(),
  rebudgeting: GraphRebudgetEventSchema.optional(),
});

const ToolCallFinalizationEventSchema = z.object({
  attempted: z.boolean(),
  succeeded: z.boolean(),
  fallbackUsed: z.boolean(),
  returnedToolCallCount: z.number(),
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
  call: GraphToolCallDescriptorSchema,
  payload: z.unknown(),
  coalesced: z.boolean().optional(),
  expiresAtIso: z.string().optional(),
});

const ContinuePromptInterruptStateSchema = z.object({
  kind: z.literal('continue_prompt'),
  continuationId: z.string(),
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
  apiKey: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number(),
  timeoutMs: z.number().optional(),
  maxTokens: z.number().optional(),
  invokedBy: z.enum(['mention', 'reply', 'wakeword', 'autopilot', 'component']).optional(),
  invokerIsAdmin: z.boolean().optional(),
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
    activeToolNames: z.array(z.string()).optional(),
    routeKind: z.string().optional(),
    currentTurn: z.unknown().optional(),
    replyTarget: z.unknown().optional(),
  })
  .strip();

const AgentGraphStateSchema = new StateSchema({
  messages: MessagesValue,
  resumeContext: AgentGraphRuntimeSnapshotSchema,
  pendingWriteCall: z.union([GraphToolCallDescriptorSchema, z.null()]).default(null),
  replyText: z.string().default(''),
  draftReplyText: z.string().default(''),
  repairHint: z.string().default(''),
  answerRepairCount: z.number().default(0),
  toolResults: new ReducedValue(z.array(SerializedToolResultSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  files: new ReducedValue(z.array(GraphToolFileSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  roundsCompleted: z.number().default(0),
  completedWindows: z.number().default(0),
  totalRoundsCompleted: z.number().default(0),
  workingSummary: z.string().default(''),
  taskState: GraphTaskStateSchema.default({
    objective: '',
    successCriteria: [],
    currentSubgoal: '',
    nextAction: '',
    unresolvedItems: [],
    evidenceSummary: '',
    status: 'framing',
  }),
  deduplicatedCallCount: new ReducedValue(z.number().default(0), {
    reducer: (left, right) => left + right,
  }),
  truncatedCallCount: new ReducedValue(z.number().default(0), {
    reducer: (left, right) => left + right,
  }),
  guardrailBlockedCallCount: new ReducedValue(z.number().default(0), {
    reducer: (left, right) => left + right,
  }),
  roundEvents: new ReducedValue(z.array(ToolCallRoundEventSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  finalization: ToolCallFinalizationEventSchema.default({
    attempted: false,
    succeeded: true,
    fallbackUsed: false,
    returnedToolCallCount: 0,
    completedAt: new Date(0).toISOString(),
    terminationReason: 'assistant_reply',
  }),
  terminationReason: z
    .enum(['assistant_reply', 'continue_prompt', 'graph_timeout', 'approval_interrupt', 'max_windows_reached'])
    .default('assistant_reply'),
  graphStatus: z.enum(['running', 'interrupted', 'completed', 'failed']).default('running'),
  startedAtEpochMs: z.number().default(0),
  pendingInterrupt: z
    .union([ApprovalInterruptStateSchema, ContinuePromptInterruptStateSchema, z.null()])
    .default(null),
  interruptResolution: z
    .union([ApprovalResolutionStateSchema, ContinuePromptResolutionStateSchema, z.null()])
    .default(null),
});

type GraphNodeName =
  | 'frame_task'
  | 'llm_call'
  | 'route_tool_phase'
  | 'execute_read_tools'
  | 'approval_gate'
  | 'refresh_task_state'
  | 'finalize_answer'
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
  workingSummary: string;
  taskState: GraphTaskState;
  deduplicatedCallCount: number;
  truncatedCallCount: number;
  guardrailBlockedCallCount: number;
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

function nowIso(): string {
  return new Date().toISOString();
}

function getDefaultTaskState(): GraphTaskState {
  return {
    objective: '',
    successCriteria: [],
    currentSubgoal: '',
    nextAction: '',
    unresolvedItems: [],
    evidenceSummary: '',
    status: 'framing',
  };
}

function sanitizeTaskList(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sanitized.push(trimmed);
    if (sanitized.length >= limit) {
      break;
    }
  }
  return sanitized;
}

function buildFallbackObjective(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = extractMessageText(messages[index]).trim();
    if (content) {
      return content.length <= 240 ? content : `${content.slice(0, 237)}...`;
    }
  }
  return 'Resolve the current user request.';
}

function normalizeTaskState(params: {
  raw: Partial<GraphTaskState> | null | undefined;
  previous?: GraphTaskState | null;
  fallbackObjective: string;
}): GraphTaskState {
  const previous = params.previous ?? getDefaultTaskState();
  const raw = params.raw ?? {};
  const objective = raw.objective?.trim() || previous.objective.trim() || params.fallbackObjective;
  const successCriteria = sanitizeTaskList(
    Array.isArray(raw.successCriteria) ? raw.successCriteria : previous.successCriteria,
    6,
  );
  const unresolvedItems = sanitizeTaskList(
    Array.isArray(raw.unresolvedItems) ? raw.unresolvedItems : previous.unresolvedItems,
    6,
  );
  const status = GraphTaskStatusSchema.catch(previous.status).parse(raw.status ?? previous.status);
  return {
    objective,
    successCriteria:
      successCriteria.length > 0
        ? successCriteria
        : ['Resolve the user request with the minimum necessary tools or one clear clarifying question.'],
    currentSubgoal:
      raw.currentSubgoal?.trim() ||
      previous.currentSubgoal.trim() ||
      'Determine the next concrete step needed to resolve the request.',
    nextAction:
      raw.nextAction?.trim() ||
      previous.nextAction.trim() ||
      'Either ask one concise clarification question or take the next minimal tool/action step.',
    unresolvedItems: status === 'ready_to_answer' || status === 'completed' ? [] : unresolvedItems,
    evidenceSummary:
      raw.evidenceSummary?.trim() ||
      previous.evidenceSummary.trim() ||
      'The task is framed, but no verified evidence has been gathered yet.',
    status,
  };
}

function isTaskStateValid(taskState: GraphTaskState | null | undefined): taskState is GraphTaskState {
  return Boolean(taskState && taskState.objective.trim() && taskState.currentSubgoal.trim());
}

function buildTaskStateBlock(taskState: GraphTaskState): string {
  const successCriteria =
    taskState.successCriteria.length > 0
      ? taskState.successCriteria.map((item) => `- ${item}`).join('\n')
      : '- none';
  const unresolvedItems =
    taskState.unresolvedItems.length > 0
      ? taskState.unresolvedItems.map((item) => `- ${item}`).join('\n')
      : '- none';
  return [
    '<task_state>',
    `status: ${taskState.status}`,
    `objective: ${taskState.objective}`,
    'success_criteria:',
    successCriteria,
    `current_subgoal: ${taskState.currentSubgoal}`,
    `next_action: ${taskState.nextAction}`,
    'unresolved_items:',
    unresolvedItems,
    `evidence_summary: ${taskState.evidenceSummary}`,
    '</task_state>',
  ].join('\n');
}

function deriveWorkingSummary(taskState: GraphTaskState, fallback?: string): string {
  const parts = [
    taskState.objective.trim() ? `Objective: ${taskState.objective.trim()}` : '',
    taskState.evidenceSummary.trim() ? `Confirmed: ${taskState.evidenceSummary.trim()}` : '',
    taskState.unresolvedItems.length > 0 ? `Unresolved: ${taskState.unresolvedItems.join('; ')}` : '',
    taskState.nextAction.trim() ? `Next: ${taskState.nextAction.trim()}` : '',
  ].filter((value) => value.length > 0);
  return (parts.join('\n') || fallback || '').trim();
}

function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

function parseStructuredJson<T>(schema: z.ZodType<T>, text: string): T | null {
  const cleaned = stripJsonCodeFence(text);
  if (!cleaned) {
    return null;
  }
  try {
    return schema.parse(JSON.parse(cleaned));
  } catch {
    try {
      return schema.parse(JSON.parse(jsonrepair(cleaned)));
    } catch {
      return null;
    }
  }
}

function isConciseClarifyingQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.endsWith('?')) {
    return false;
  }
  if (trimmed.length > 240) {
    return false;
  }
  return trimmed.split(/\r?\n/).length <= 3;
}

function buildRepairHint(taskState: GraphTaskState, draftReplyText: string): string {
  const draft = draftReplyText.trim();
  return [
    'The previous plain-text draft was premature.',
    `Current task status: ${taskState.status}.`,
    'If the task is not fully satisfied, do not answer partially.',
    'Either ask one concise clarifying question, call the next necessary tool, or wait until the task is ready for the dedicated final-answer step.',
    draft ? `Premature draft to avoid repeating verbatim: ${draft}` : '',
  ]
    .filter((value) => value.length > 0)
    .join(' ');
}

const TaskStateEnvelopeSchema = z.object({
  taskState: GraphTaskStateSchema.optional(),
  replyText: z.string().optional(),
});

function buildClarifyingQuestion(taskState: GraphTaskState): string {
  const unresolved = taskState.unresolvedItems.find((item) => item.trim().length > 0);
  if (unresolved) {
    return `Before I continue, can you clarify: ${unresolved}?`;
  }
  return 'Before I continue, what specific outcome should I optimize for?';
}

async function invokeStructuredTaskStateStep(params: {
  kind: 'frame' | 'refresh';
  state: AgentGraphState;
  runtimeContext: AgentGraphRuntimeContext;
  config: RunnableConfig;
}): Promise<{
  taskState: GraphTaskState;
  replyText: string;
  workingSummary: string;
  rebudgeting?: GraphRebudgetEvent;
  strictFailure: boolean;
}> {
  const fallbackObjective = buildFallbackObjective(params.state.messages as BaseMessage[]);
  const previousTaskState = isTaskStateValid(params.state.taskState)
    ? params.state.taskState
    : normalizeTaskState({
        raw: null,
        fallbackObjective,
      });
  const promptLines =
    params.kind === 'frame'
      ? [
          'You are framing the internal task state before tool execution.',
          'Do not call tools.',
          'Return JSON only with keys `taskState` and optional `replyText`.',
          'Set `taskState.objective` to the real user goal and define concrete success criteria.',
          'Set `taskState.currentSubgoal` to the first actionable subgoal.',
          'Set `taskState.nextAction` to the next concrete thing the runtime should do.',
          'Set `taskState.status` to `needs_user_input` only when one user answer is required before safe progress.',
          'If `taskState.status` is `needs_user_input`, place one concise clarification question in `replyText`.',
          'Set `taskState.status` to `ready_to_answer` only if the request can be answered now without tools.',
        ]
      : [
          'You are refreshing the internal task state after the runtime gathered new evidence.',
          'Do not call tools.',
          'Return JSON only with keys `taskState` and optional `replyText`.',
          'Update what is confirmed, what remains unresolved, the current subgoal, and the next best action.',
          'Set `taskState.status` to `ready_to_answer` only if the objective can now be answered completely without more tools.',
          'Set `taskState.status` to `needs_user_input` only if one user answer is required next.',
          'If `taskState.status` is `needs_user_input`, place one concise clarification question in `replyText`.',
        ];
  const buildPromptMessages = (extraSystemInstructions?: string, previousInvalidResponse?: string): BaseMessage[] => {
    const messages: BaseMessage[] = [
      new SystemMessage({
        content: [
          ...promptLines,
          'Do not wrap the JSON in markdown fences.',
          extraSystemInstructions ?? '',
        ]
          .filter((value) => value.length > 0)
          .join(' '),
      }),
      ...(params.state.messages as BaseMessage[]),
    ];
    if (previousInvalidResponse?.trim()) {
      messages.push(
        new SystemMessage({
          content: [
            'The previous response was invalid for this structured step.',
            'Correct it into strict JSON with keys `taskState` and optional `replyText` only.',
            'Do not repeat explanations or markdown fences.',
            `Previous invalid response:\n${previousInvalidResponse.trim()}`,
          ].join(' '),
        }),
      );
    }
    return messages;
  };

  const invokeStructuredAttempt = async (
    promptMessages: BaseMessage[],
    temperature: number,
  ): Promise<{
    parsed: z.infer<typeof TaskStateEnvelopeSchema> | null;
    rawText: string;
    rebudgeting?: GraphRebudgetEvent;
  }> => {
    const prepared = buildRebudgetingEvent(
      promptMessages,
      params.runtimeContext.model,
      params.runtimeContext.maxTokens,
      {
        workingSummary: params.state.workingSummary,
        taskState: isTaskStateValid(params.state.taskState) ? params.state.taskState : null,
      },
    );
    const responseMessage = await createGraphChatModel({
      model: params.runtimeContext.model,
      apiKey: params.runtimeContext.apiKey,
      temperature,
      timeoutMs: params.runtimeContext.timeoutMs,
      maxTokens: params.runtimeContext.maxTokens,
    }).invoke(prepared.trimmedMessages, params.config);
    const aiMessage = AIMessage.isInstance(responseMessage)
      ? responseMessage
      : new AIMessage({ content: extractMessageText(responseMessage as BaseMessage) });
    const rawText = extractMessageText(aiMessage).trim();
    const parsed = parseStructuredJson(TaskStateEnvelopeSchema, rawText);
    return {
      parsed,
      rawText,
      rebudgeting: prepared.rebudgeting,
    };
  };

  try {
    const firstAttempt = await invokeStructuredAttempt(
      buildPromptMessages(),
      params.kind === 'frame'
        ? Math.max(0, params.runtimeContext.temperature - 0.2)
        : Math.max(0, params.runtimeContext.temperature - 0.1),
    );
    let parsed = firstAttempt.parsed?.taskState ? firstAttempt.parsed : null;
    let rawText = firstAttempt.rawText;
    let rebudgeting = firstAttempt.rebudgeting;

    if (!parsed) {
      const repairedAttempt = await invokeStructuredAttempt(
        buildPromptMessages(
          'Your next response must be valid strict JSON for the schema, not prose.',
          rawText,
        ),
        0,
      );
      parsed = repairedAttempt.parsed?.taskState ? repairedAttempt.parsed : null;
      rawText = repairedAttempt.rawText;
      rebudgeting = repairedAttempt.rebudgeting ?? rebudgeting;
    }

    if (!parsed?.taskState) {
      throw new Error('Structured task-state step did not return a valid taskState payload.');
    }

    const taskState = normalizeTaskState({
      raw: parsed.taskState,
      previous: previousTaskState,
      fallbackObjective,
    });
    const replyText =
      taskState.status === 'needs_user_input'
        ? parsed.replyText?.trim() || (isConciseClarifyingQuestion(rawText) ? rawText : buildClarifyingQuestion(taskState))
        : '';
    const workingSummary = deriveWorkingSummary(
      taskState,
      params.state.workingSummary || buildFallbackWorkingSummary(params.state),
    );
    return {
      taskState,
      replyText,
      workingSummary,
      rebudgeting,
      strictFailure: false,
    };
  } catch (error) {
    logger.warn(
      {
        error,
        traceId: params.runtimeContext.traceId,
        stepKind: params.kind,
      },
      'Structured task-state step failed; using fallback task state',
    );
    const taskState = normalizeTaskState({
      raw: {
        status: params.kind === 'frame' ? 'needs_user_input' : previousTaskState.status,
        nextAction:
          params.kind === 'frame'
            ? 'Wait for the user to clarify the goal before continuing.'
            : previousTaskState.nextAction,
      },
      previous: previousTaskState,
      fallbackObjective,
    });
    return {
      taskState,
      replyText:
        params.kind === 'frame'
          ? buildClarifyingQuestion(taskState)
          : taskState.status === 'needs_user_input'
            ? buildClarifyingQuestion(taskState)
            : '',
      workingSummary: deriveWorkingSummary(
        taskState,
        params.state.workingSummary || buildFallbackWorkingSummary(params.state),
      ),
      rebudgeting: undefined,
      strictFailure: true,
    };
  }
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
    activeToolNames: [...params.activeToolNames],
    routeKind: params.routeKind,
    currentTurn: params.currentTurn,
    replyTarget: params.replyTarget ?? null,
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
    completedWindows: state.completedWindows,
    totalRoundsCompleted: state.totalRoundsCompleted,
    workingSummary: state.workingSummary,
    taskState: state.taskState,
    deduplicatedCallCount: state.deduplicatedCallCount,
    truncatedCallCount: state.truncatedCallCount,
    guardrailBlockedCallCount: state.guardrailBlockedCallCount,
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
  options?: {
    workingSummary?: string;
    taskState?: GraphTaskState | null;
    repairHint?: string;
  },
): { trimmedMessages: BaseMessage[]; rebudgeting: GraphRebudgetEvent } {
  const systemMessages: BaseMessage[] = [];
  if (options?.taskState && isTaskStateValid(options.taskState)) {
    systemMessages.push(
      new SystemMessage({
        content: buildTaskStateBlock(options.taskState),
      }),
    );
  }
  if (options?.workingSummary?.trim()) {
    systemMessages.push(
      new SystemMessage({
        content: `<working_summary>\n${options.workingSummary.trim()}\n</working_summary>`,
      }),
    );
  }
  if (options?.repairHint?.trim()) {
    systemMessages.push(
      new SystemMessage({
        content: `<repair_hint>\n${options.repairHint.trim()}\n</repair_hint>`,
      }),
    );
  }
  const preparedMessages = toLlmMessages(
    systemMessages.length > 0 ? [...systemMessages, ...messages] : messages,
  );
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
  return {
    traceId: runtimeContext.traceId,
    graphThreadId: runtimeContext.threadId,
    graphRunKind,
    graphStep: state.roundsCompleted + 1,
    approvalRequestId:
      state.pendingInterrupt?.kind === 'approval_review' ? state.pendingInterrupt.requestId : null,
    userId: runtimeContext.userId,
    channelId: runtimeContext.channelId,
    guildId: runtimeContext.guildId,
    apiKey: runtimeContext.apiKey,
    invokerIsAdmin: runtimeContext.invokerIsAdmin,
    invokedBy: runtimeContext.invokedBy,
    routeKind: runtimeContext.routeKind,
    currentTurn: runtimeContext.currentTurn as ToolExecutionContext['currentTurn'],
    replyTarget: runtimeContext.replyTarget as ToolExecutionContext['replyTarget'],
  };
}

function isTimedOut(state: AgentGraphState, graphConfig: AgentGraphConfig): boolean {
  return Date.now() - state.startedAtEpochMs >= graphConfig.maxDurationMs;
}

function buildExecutionEvent(
  state: AgentGraphState,
  details: Omit<ToolCallRoundEvent, 'round' | 'completedAt'>,
): ToolCallRoundEvent {
  return {
    round: state.roundsCompleted + 1,
    completedAt: nowIso(),
    ...details,
  };
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

function buildFallbackWorkingSummary(state: AgentGraphState): string {
  const taskSummary = isTaskStateValid(state.taskState) ? deriveWorkingSummary(state.taskState) : '';
  const successfulTools = state.toolResults.filter((result) => result.success).map((result) => result.name);
  const failedTools = state.toolResults
    .filter((result) => !result.success)
    .map((result) => `${result.name}${result.error ? ` (${result.error})` : ''}`);
  const parts: string[] = [];

  if (taskSummary) {
    parts.push(taskSummary);
  }
  if (successfulTools.length > 0) {
    parts.push(`Verified so far: completed ${successfulTools.join(', ')}.`);
  }
  if (failedTools.length > 0) {
    parts.push(`Issues encountered: ${failedTools.join('; ')}.`);
  }
  if (state.replyText.trim()) {
    parts.push(state.replyText.trim());
  }
  if (parts.length === 0) {
    parts.push('I have partial tool results but need another continuation window to finish the request.');
  }

  return parts.join('\n\n').trim();
}

async function buildContinuationSummary(params: {
  state: AgentGraphState;
  runtimeContext: AgentGraphRuntimeContext;
  config: RunnableConfig;
}): Promise<{ summaryText: string; workingSummary: string; rebudgeting?: GraphRebudgetEvent }> {
  const taskState =
    params.state.taskState.status === 'paused'
      ? params.state.taskState
      : {
          ...params.state.taskState,
          status: 'paused' as const,
        };
  const fallback =
    deriveWorkingSummary(taskState, params.state.workingSummary || buildFallbackWorkingSummary(params.state)) ||
    buildFallbackWorkingSummary(params.state);
  const summaryPrompt = [
    new SystemMessage({
      content: [
        'You are pausing an in-progress tool workflow.',
        'Do not call tools.',
        'Write a concise progress handoff for the user in plain text.',
        'Include: what is confirmed so far, what is still unresolved, and what you would likely do next if they press Continue.',
        'Do not mention internal graph state, checkpoints, windows, or tool protocol.',
      ].join(' '),
    }),
    ...(params.state.messages as BaseMessage[]),
  ];
  const prepared = buildRebudgetingEvent(
    summaryPrompt,
    params.runtimeContext.model,
    params.runtimeContext.maxTokens,
    {
      workingSummary: params.state.workingSummary || fallback,
      taskState,
    },
  );

  try {
    const responseMessage = await createGraphChatModel({
      model: params.runtimeContext.model,
      apiKey: params.runtimeContext.apiKey,
      temperature: Math.max(0, params.runtimeContext.temperature - 0.15),
      timeoutMs: params.runtimeContext.timeoutMs,
      maxTokens: params.runtimeContext.maxTokens,
    }).invoke(prepared.trimmedMessages, params.config);
    const aiMessage = AIMessage.isInstance(responseMessage)
      ? responseMessage
      : new AIMessage({ content: extractMessageText(responseMessage as BaseMessage) });
    const summaryText = extractMessageText(aiMessage).trim() || fallback;
    return {
      summaryText,
      workingSummary: summaryText,
      rebudgeting: prepared.rebudgeting,
    };
  } catch (error) {
    logger.warn(
      { error, traceId: params.runtimeContext.traceId },
      'Agent graph continuation summary generation failed; using fallback summary',
    );
    return {
      summaryText: fallback,
      workingSummary: fallback,
      rebudgeting: prepared.rebudgeting,
    };
  }
}

function resolveContinueResumeNode(state: AgentGraphState): 'llm_call' | 'route_tool_phase' {
  const lastMessage = state.messages.at(-1);
  if (lastMessage && AIMessage.isInstance(lastMessage) && (lastMessage.tool_calls?.length ?? 0) > 0) {
    return 'route_tool_phase';
  }
  return 'llm_call';
}

function routeAfterTaskStateRefresh(
  state: AgentGraphState,
  graphConfig: AgentGraphConfig,
): GraphNodeName {
  if (state.taskState.status === 'needs_user_input') {
    return 'finalize_turn';
  }
  if (state.taskState.status === 'ready_to_answer' || state.taskState.status === 'completed') {
    return 'finalize_answer';
  }
  if (isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.maxSteps) {
    return 'pause_for_continue';
  }
  return 'llm_call';
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

  const frameTaskNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    const framed = await invokeStructuredTaskStateStep({
      kind: 'frame',
      state,
      runtimeContext,
      config,
    });
    const nextState: Partial<AgentGraphState> = {
      taskState: framed.taskState,
      workingSummary: framed.workingSummary,
      replyText: framed.taskState.status === 'needs_user_input' ? framed.replyText : '',
      draftReplyText: '',
      repairHint: '',
      answerRepairCount: 0,
      resumeContext: runtimeContext,
    };

    if (framed.strictFailure) {
      return new Command({
        goto: 'finalize_turn',
        update: {
          ...nextState,
          terminationReason: 'assistant_reply',
          finalization: {
            attempted: true,
            succeeded: false,
            fallbackUsed: true,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
            terminationReason: 'assistant_reply',
            rebudgeting: framed.rebudgeting,
          },
        },
      });
    }

    if (framed.taskState.status === 'needs_user_input') {
      return new Command({
        goto: 'finalize_turn',
        update: {
          ...nextState,
          terminationReason: 'assistant_reply',
          finalization: {
            attempted: true,
            succeeded: true,
            fallbackUsed: false,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
            terminationReason: 'assistant_reply',
            rebudgeting: framed.rebudgeting,
          },
        },
      });
    }

    if (framed.taskState.status === 'ready_to_answer' || framed.taskState.status === 'completed') {
      return new Command({
        goto: 'finalize_answer',
        update: nextState,
      });
    }

    return new Command({
      goto: 'llm_call',
      update: nextState,
    });
  };

  const callModelNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    const toolContext = buildToolContext(state, runtimeContext, 'turn');
    const toolsEnabled =
      runtimeContext.activeToolNames.length > 0 &&
      state.roundsCompleted < graphConfig.maxSteps &&
      !isTimedOut(state, graphConfig);
    const catalog = toolsEnabled
      ? buildActiveToolCatalog({
          activeToolNames: runtimeContext.activeToolNames,
          context: toolContext,
          timeoutMs: graphConfig.toolTimeoutMs,
          maxResultChars: graphConfig.maxResultChars,
        })
      : null;
    const prepared = buildRebudgetingEvent(
      state.messages as BaseMessage[],
      runtimeContext.model,
      runtimeContext.maxTokens,
      {
        workingSummary: state.workingSummary,
        taskState: isTaskStateValid(state.taskState) ? state.taskState : null,
        repairHint: state.repairHint,
      },
    );
    const baseModel = createGraphChatModel({
      model: runtimeContext.model,
      apiKey: runtimeContext.apiKey,
      temperature: runtimeContext.temperature,
      timeoutMs: runtimeContext.timeoutMs,
      maxTokens: runtimeContext.maxTokens,
    });
    const runnable =
      catalog && catalog.allTools.length > 0
        ? baseModel.bindTools(catalog.allTools, { tool_choice: 'auto' })
        : baseModel;
    const responseMessage = await runnable.invoke(prepared.trimmedMessages, config);
    const aiMessage = AIMessage.isInstance(responseMessage)
      ? responseMessage
      : new AIMessage({ content: extractMessageText(responseMessage as BaseMessage) });
    const replyText = extractMessageText(aiMessage).trim();
    const toolCalls = getLastAiToolCalls([aiMessage]);

    if (toolCalls.length > 0) {
      return new Command({
        goto:
          isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.maxSteps
            ? 'pause_for_continue'
            : 'route_tool_phase',
        update: {
          messages: [aiMessage],
          draftReplyText: '',
          repairHint: '',
          answerRepairCount: 0,
          terminationReason:
            isTimedOut(state, graphConfig)
              ? 'graph_timeout'
              : state.roundsCompleted >= graphConfig.maxSteps
                ? 'continue_prompt'
                : state.terminationReason,
          resumeContext: runtimeContext,
        },
      });
    }

    if (isConciseClarifyingQuestion(replyText)) {
      const taskState = normalizeTaskState({
        raw: {
          status: 'needs_user_input',
          nextAction: 'Wait for the user to answer the clarification question.',
        },
        previous: state.taskState,
        fallbackObjective: buildFallbackObjective(state.messages as BaseMessage[]),
      });
      return new Command({
        goto: 'finalize_turn',
        update: {
          messages: [aiMessage],
          replyText,
          workingSummary: deriveWorkingSummary(taskState, state.workingSummary),
          taskState,
          draftReplyText: '',
          repairHint: '',
          answerRepairCount: 0,
          terminationReason: 'assistant_reply',
          finalization: {
            attempted: true,
            succeeded: true,
            fallbackUsed: false,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
            terminationReason: 'assistant_reply',
            rebudgeting: prepared.rebudgeting,
          },
          resumeContext: runtimeContext,
        },
      });
    }

    if (state.taskState.status === 'ready_to_answer' || state.taskState.status === 'completed') {
      return new Command({
        goto: 'finalize_answer',
        update: {
          messages: [aiMessage],
          draftReplyText: replyText,
          repairHint: '',
          answerRepairCount: 0,
          resumeContext: runtimeContext,
        },
      });
    }

    if (state.answerRepairCount < 1) {
      return new Command({
        goto: 'llm_call',
        update: {
          draftReplyText: replyText,
          repairHint: buildRepairHint(state.taskState, replyText),
          answerRepairCount: state.answerRepairCount + 1,
          resumeContext: runtimeContext,
        },
      });
    }

    const fallbackSummary = deriveWorkingSummary(
      state.taskState,
      state.workingSummary || replyText || buildFallbackWorkingSummary(state),
    );
    return new Command({
      goto: 'finalize_turn',
      update: {
        workingSummary: fallbackSummary,
        draftReplyText: replyText,
        repairHint: '',
        answerRepairCount: 0,
        terminationReason: 'assistant_reply',
        finalization: {
          attempted: true,
          succeeded: false,
          fallbackUsed: true,
          returnedToolCallCount: 0,
          completedAt: nowIso(),
          terminationReason: 'assistant_reply',
          rebudgeting: prepared.rebudgeting,
        },
        resumeContext: runtimeContext,
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
    let pendingWriteCall: GraphToolCallDescriptor | null = null;
    let deduplicatedCallCount = 0;
    let guardrailBlockedCallCount = 0;

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

      if (!pendingWriteCall) {
        pendingWriteCall = serializedCall;
      } else {
        guardrailBlockedCallCount += 1;
      }
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

    const executedAny = readBatch.length > 0 || pendingWriteCall !== null;

    return new Command({
      goto:
        readBatch.length > 0
          ? 'execute_read_tools'
          : pendingWriteCall
            ? 'approval_gate'
            : 'llm_call',
      update: {
        messages: readBatchMessage ? [readBatchMessage] : [],
        pendingWriteCall,
        roundsCompleted: executedAny ? state.roundsCompleted + 1 : state.roundsCompleted,
        totalRoundsCompleted: executedAny ? state.totalRoundsCompleted + 1 : state.totalRoundsCompleted,
        deduplicatedCallCount,
        truncatedCallCount,
        guardrailBlockedCallCount,
        roundEvents: executedAny
          ? [
              buildExecutionEvent(state, {
                requestedCallCount,
                executedCallCount: readBatch.length + (pendingWriteCall ? 1 : 0),
                deduplicatedCallCount,
                truncatedCallCount,
                guardrailBlockedCallCount,
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
    return new Command({
      goto: state.pendingWriteCall ? 'approval_gate' : 'refresh_task_state',
      update,
    });
  };

  const approvalGateNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    if (!state.pendingWriteCall) {
      return new Command({ goto: 'refresh_task_state', update: {} });
    }

    const runtimeContext = resolveRuntimeContext(state, config);
    const outcome = await executeDurableToolTask({
      activeToolNames: runtimeContext.activeToolNames,
      call: state.pendingWriteCall,
      context: buildToolContext(state, runtimeContext, 'turn'),
      timeoutMs: graphConfig.toolTimeoutMs,
      maxResultChars: graphConfig.maxResultChars,
    });

    if (outcome.kind === 'approval_required') {
      const materialized = await createOrReuseApprovalReviewRequestFromSignal({
        threadId: runtimeContext.threadId,
        originTraceId: runtimeContext.originTraceId,
        signal: new ApprovalRequiredSignal(outcome.payload),
      });

      return new Command({
        goto: 'resume_interrupt',
        update: {
          pendingWriteCall: null,
          replyText: '',
          graphStatus: 'interrupted',
          terminationReason: 'approval_interrupt',
          pendingInterrupt: {
            kind: 'approval_review',
            requestId: materialized.request.id,
            call: outcome.call,
            payload: outcome.payload,
            coalesced: materialized.coalesced,
            expiresAtIso: materialized.request.expiresAt.toISOString(),
          },
          interruptResolution: null,
          finalization: {
            attempted: false,
            succeeded: true,
            fallbackUsed: false,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
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
      goto: 'refresh_task_state',
      update: {
        pendingWriteCall: null,
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
        goto: routeAfterTaskStateRefresh(state, graphConfig),
        update: {},
      });
    }

    const runtimeContext = resolveRuntimeContext(state, config);
    if (state.pendingInterrupt.kind === 'continue_prompt') {
      const resume = interrupt({
        kind: 'continue_prompt',
        continuationId: state.pendingInterrupt.continuationId,
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
        return new Command({
          goto: 'finalize_turn',
          update: {
            resumeContext: resumedContext,
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
              fallbackUsed: false,
              returnedToolCallCount: 0,
              completedAt: nowIso(),
              terminationReason: 'continue_prompt',
            },
          },
        });
      }

      const consumed = await consumeGraphContinuationSession({
        id: resume.continuationId,
        latestTraceId: resumedContext.traceId,
      });
      if (!consumed) {
        return new Command({
          goto: 'finalize_turn',
          update: {
            replyText:
              state.replyText.trim() ||
              'That continuation is no longer available. Start a fresh request if you want me to keep going.',
            resumeContext: resumedContext,
            graphStatus: 'completed',
            terminationReason: 'continue_prompt',
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
              fallbackUsed: false,
              returnedToolCallCount: 0,
              completedAt: nowIso(),
              terminationReason: 'continue_prompt',
            },
          },
        });
      }

      return new Command({
        goto: isTaskStateValid(state.taskState) ? state.pendingInterrupt.resumeNode : 'frame_task',
        update: {
          replyText: '',
          draftReplyText: '',
          repairHint: '',
          answerRepairCount: 0,
          resumeContext: resumedContext,
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
          startedAtEpochMs: Date.now(),
          taskState:
            state.taskState.status === 'paused'
              ? {
                  ...state.taskState,
                  status: 'executing',
                }
              : state.taskState,
          finalization: {
            attempted: false,
            succeeded: true,
            fallbackUsed: false,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
            terminationReason: 'assistant_reply',
          },
        },
      });
    }

    const approvalInterrupt = state.pendingInterrupt;
    const resume = interrupt({
      requestId: approvalInterrupt.requestId,
      kind: approvalInterrupt.payload.kind,
      coalesced: approvalInterrupt.coalesced,
      expiresAtIso: approvalInterrupt.expiresAtIso,
    }) as GraphResumeInput;
    if (resume.interruptKind !== 'approval_review') {
      throw new Error('Approval interrupt resumed with incompatible payload.');
    }
    const resumedContext: AgentGraphRuntimeContext = {
      ...runtimeContext,
      traceId: resume.resumeTraceId?.trim() || runtimeContext.traceId,
    };

    if (resume.status !== 'approved') {
      const result: SerializedToolResult = {
        name: approvalInterrupt.call.name,
        success: false,
        error:
          resume.status === 'rejected'
            ? resume.decisionReasonText?.trim()
              ? `Approval rejected: ${resume.decisionReasonText.trim()}`
              : 'Approval rejected.'
            : 'Approval expired before execution.',
        errorType: 'execution',
        latencyMs: 0,
      };
      const toolMessage = buildToolMessageFromOutcome({
        toolName: approvalInterrupt.call.name,
        callId: approvalInterrupt.call.id,
        content: JSON.stringify({
          status: resume.status,
          decisionReasonText: resume.decisionReasonText ?? null,
        }),
        result,
        files: [],
        status: 'error',
      });

      return new Command({
        goto: 'refresh_task_state',
        update: {
          messages: [toolMessage],
          resumeContext: resumedContext,
          graphStatus: 'running',
          interruptResolution: {
            kind: 'approval_review',
            requestId: approvalInterrupt.requestId,
            decision: resume.status,
            status: resume.status,
            reviewerId: resume.reviewerId ?? null,
            decisionReasonText: resume.decisionReasonText ?? null,
          },
          pendingInterrupt: null,
          toolResults: [result],
        },
      });
    }

    const executed = await executeApprovedReviewTask({
      requestId: approvalInterrupt.requestId,
      toolName: approvalInterrupt.call.name,
      callId: approvalInterrupt.call.id,
      reviewerId: resume.reviewerId ?? null,
      decisionReasonText: resume.decisionReasonText ?? null,
      resumeTraceId: resume.resumeTraceId ?? null,
      maxResultChars: graphConfig.maxResultChars,
    });
    const resolvedStatus = normalizeResolvedApprovalStatus({
      decision: resume.status,
      actionStatus: executed.status,
      errorText: executed.result.error ?? null,
    });
    const toolMessage = buildToolMessageFromOutcome({
      toolName: executed.toolName,
      callId: executed.callId,
      content: executed.content,
      result: executed.result,
      files: executed.files,
      status: executed.result.success ? 'success' : 'error',
    });

    return new Command({
      goto: 'refresh_task_state',
      update: {
        messages: [toolMessage],
        resumeContext: resumedContext,
        graphStatus: 'running',
        interruptResolution: {
          kind: 'approval_review',
          requestId: approvalInterrupt.requestId,
          decision: resume.status,
          status: resolvedStatus,
          reviewerId: resume.reviewerId ?? null,
          decisionReasonText: resume.decisionReasonText ?? null,
          errorText: executed.result.error ?? null,
        },
        pendingInterrupt: null,
        toolResults: [executed.result],
        files: executed.files,
      },
    });
  };

  const refreshTaskStateNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    const refreshed = await invokeStructuredTaskStateStep({
      kind: 'refresh',
      state,
      runtimeContext,
      config,
    });
    const nextTaskState = refreshed.taskState;
    const nextWorkingSummary = refreshed.workingSummary;
    const nextReplyText = nextTaskState.status === 'needs_user_input' ? refreshed.replyText : '';
    const nextState: AgentGraphState = {
      ...state,
      taskState: nextTaskState,
      workingSummary: nextWorkingSummary,
      replyText: nextReplyText,
      draftReplyText: '',
      repairHint: '',
      answerRepairCount: 0,
    };
    const nextRoute = routeAfterTaskStateRefresh(nextState, graphConfig);
    const finalization =
      nextRoute === 'finalize_turn'
        ? {
            attempted: true,
            succeeded: !refreshed.strictFailure,
            fallbackUsed: refreshed.strictFailure,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
            terminationReason: 'assistant_reply' as const,
            rebudgeting: refreshed.rebudgeting,
          }
        : state.finalization;
    return new Command({
      goto: nextRoute,
      update: {
        taskState: nextTaskState,
        workingSummary: nextWorkingSummary,
        replyText: nextReplyText,
        draftReplyText: '',
        repairHint: '',
        answerRepairCount: 0,
        resumeContext: runtimeContext,
        finalization,
      },
    });
  };

  const finalizeAnswerNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    const promptMessages = [
      new SystemMessage({
        content: [
          'You are writing the final user-facing answer for the current task.',
          'Do not call tools.',
          'Respond in plain text only.',
          'Resolve the objective directly using the verified evidence already gathered.',
          'If exactly one user detail is still required, ask one concise clarifying question instead of giving a partial answer.',
        ].join(' '),
      }),
      ...(state.messages as BaseMessage[]),
    ];
    const prepared = buildRebudgetingEvent(
      promptMessages,
      runtimeContext.model,
      runtimeContext.maxTokens,
      {
        workingSummary: state.workingSummary,
        taskState: isTaskStateValid(state.taskState) ? state.taskState : null,
      },
    );
    const fallbackText =
      state.draftReplyText.trim() ||
      state.workingSummary.trim() ||
      buildFallbackWorkingSummary(state);

    try {
      const responseMessage = await createGraphChatModel({
        model: runtimeContext.model,
        apiKey: runtimeContext.apiKey,
        temperature: Math.max(0, runtimeContext.temperature - 0.15),
        timeoutMs: runtimeContext.timeoutMs,
        maxTokens: runtimeContext.maxTokens,
      }).invoke(prepared.trimmedMessages, config);
      const aiMessage = AIMessage.isInstance(responseMessage)
        ? responseMessage
        : new AIMessage({ content: extractMessageText(responseMessage as BaseMessage) });
      const replyText = extractMessageText(aiMessage).trim() || fallbackText;
      const isQuestion = isConciseClarifyingQuestion(replyText);
      const taskState = normalizeTaskState({
        raw: {
          status: isQuestion ? 'needs_user_input' : 'completed',
          nextAction: isQuestion ? 'Wait for the user to answer the clarification question.' : 'No further action is required.',
        },
        previous: state.taskState,
        fallbackObjective: buildFallbackObjective(state.messages as BaseMessage[]),
      });
      return new Command({
        goto: 'finalize_turn',
        update: {
          messages: [aiMessage],
          replyText,
          workingSummary: deriveWorkingSummary(taskState, state.workingSummary || fallbackText),
          taskState,
          draftReplyText: '',
          repairHint: '',
          answerRepairCount: 0,
          terminationReason: 'assistant_reply',
          finalization: {
            attempted: true,
            succeeded: true,
            fallbackUsed: replyText === fallbackText && extractMessageText(aiMessage).trim().length === 0,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
            terminationReason: 'assistant_reply',
            rebudgeting: prepared.rebudgeting,
          },
          resumeContext: runtimeContext,
        },
      });
    } catch (error) {
      logger.warn(
        { error, traceId: runtimeContext.traceId },
        'Final answer generation failed; using working summary fallback',
      );
      const taskState = normalizeTaskState({
        raw: {
          status: 'completed',
        },
        previous: state.taskState,
        fallbackObjective: buildFallbackObjective(state.messages as BaseMessage[]),
      });
      return new Command({
        goto: 'finalize_turn',
        update: {
          replyText: fallbackText,
          workingSummary: deriveWorkingSummary(taskState, state.workingSummary || fallbackText),
          taskState,
          draftReplyText: '',
          repairHint: '',
          answerRepairCount: 0,
          terminationReason: 'assistant_reply',
          finalization: {
            attempted: true,
            succeeded: false,
            fallbackUsed: true,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
            terminationReason: 'assistant_reply',
            rebudgeting: prepared.rebudgeting,
          },
          resumeContext: runtimeContext,
        },
      });
    }
  };

  const pauseForContinueNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    const nextCompletedWindows = state.completedWindows + 1;
    const summary = await buildContinuationSummary({
      state,
      runtimeContext,
      config,
    });

    if (nextCompletedWindows >= GRAPH_CONTINUATION_MAX_WINDOWS) {
      return new Command({
        goto: 'finalize_turn',
        update: {
          replyText: `${summary.summaryText}\n\nI reached the continuation limit for this request. Ask me in a new message if you want me to keep going from here.`,
          workingSummary: summary.workingSummary,
          completedWindows: nextCompletedWindows,
          graphStatus: 'completed',
          terminationReason: 'max_windows_reached',
          finalization: {
            attempted: true,
            succeeded: true,
            fallbackUsed: false,
            returnedToolCallCount: 0,
            completedAt: nowIso(),
            terminationReason: 'max_windows_reached',
            rebudgeting: summary.rebudgeting,
          },
        },
      });
    }

    const continuation = await createGraphContinuationSession({
      threadId: runtimeContext.threadId,
      originTraceId: runtimeContext.originTraceId,
      latestTraceId: runtimeContext.traceId,
      guildId: runtimeContext.guildId,
      channelId: runtimeContext.channelId,
      requestedByUserId: runtimeContext.userId,
      pauseKind: isTimedOut(state, graphConfig) ? 'graph_timeout' : 'step_window_exhausted',
      completedWindows: nextCompletedWindows,
      maxWindows: GRAPH_CONTINUATION_MAX_WINDOWS,
      summaryText: summary.summaryText,
      resumeNode: resolveContinueResumeNode(state),
    });

    return new Command({
      goto: 'resume_interrupt',
      update: {
        replyText: summary.summaryText,
        workingSummary: summary.workingSummary,
        taskState: {
          ...state.taskState,
          status: 'paused',
        },
        completedWindows: nextCompletedWindows,
        graphStatus: 'interrupted',
        terminationReason: 'continue_prompt',
        pendingInterrupt: {
          kind: 'continue_prompt',
          continuationId: continuation.id,
          requestedByUserId: continuation.requestedByUserId,
          channelId: continuation.channelId,
          guildId: continuation.guildId,
          summaryText: continuation.summaryText,
          completedWindows: continuation.completedWindows,
          maxWindows: continuation.maxWindows,
          expiresAtIso: continuation.expiresAt.toISOString(),
          resumeNode: continuation.resumeNode as 'llm_call' | 'route_tool_phase',
        },
        interruptResolution: null,
        finalization: {
          attempted: true,
          succeeded: true,
          fallbackUsed: false,
          returnedToolCallCount: 0,
          completedAt: nowIso(),
          terminationReason: 'continue_prompt',
          rebudgeting: summary.rebudgeting,
        },
      },
    });
  };

  const finalizeTurnNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => ({
    graphStatus: state.graphStatus === 'failed' ? 'failed' : 'completed',
    pendingWriteCall: null,
  });

  return new StateGraph({
    state: AgentGraphStateSchema,
    context: AgentGraphConfigurableSchema,
  })
    .addNode('frame_task', frameTaskNode, {
      ends: ['llm_call', 'finalize_answer', 'finalize_turn'],
    })
    .addNode('llm_call', callModelNode, {
      ends: ['route_tool_phase', 'pause_for_continue', 'finalize_answer', 'finalize_turn', 'llm_call'],
    })
    .addNode('route_tool_phase', routeToolPhaseNode, {
      ends: ['execute_read_tools', 'approval_gate', 'llm_call'],
    })
    .addNode('execute_read_tools', executeReadToolsNode, {
      ends: ['approval_gate', 'refresh_task_state'],
    })
    .addNode('approval_gate', approvalGateNode, {
      ends: ['resume_interrupt', 'refresh_task_state'],
    })
    .addNode('refresh_task_state', refreshTaskStateNode, {
      ends: ['llm_call', 'pause_for_continue', 'finalize_answer', 'finalize_turn'],
    })
    .addNode('finalize_answer', finalizeAnswerNode, {
      ends: ['finalize_turn'],
    })
    .addNode('pause_for_continue', pauseForContinueNode, {
      ends: ['resume_interrupt', 'finalize_turn'],
    })
    .addNode('resume_interrupt', resumeInterruptNode, {
      ends: ['frame_task', 'llm_call', 'route_tool_phase', 'finalize_turn', 'pause_for_continue', 'finalize_answer'],
    })
    .addNode('finalize_turn', finalizeTurnNode)
    .addEdge(START, 'frame_task')
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
    (state.terminationReason === 'approval_interrupt' || state.terminationReason === 'continue_prompt')
  );
}

function coerceInterruptedState(value: unknown): AgentGraphState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const state = value as Partial<AgentGraphState>;
  if (
    state.graphStatus !== 'interrupted' ||
    (state.terminationReason !== 'approval_interrupt' && state.terminationReason !== 'continue_prompt')
  ) {
    return null;
  }

  const pendingInterrupt = state.pendingInterrupt;
  if (!pendingInterrupt || typeof pendingInterrupt !== 'object' || typeof pendingInterrupt.kind !== 'string') {
    return null;
  }
  if (pendingInterrupt.kind === 'approval_review') {
    if (typeof pendingInterrupt.requestId !== 'string' || pendingInterrupt.requestId.trim().length === 0) {
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
    reason: 'stream_error' | 'missing_final_state';
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

    logger.warn(
      {
        traceId: state.resumeContext.traceId,
        threadId: state.resumeContext.threadId,
        interruptKind: pendingInterrupt.kind,
        interruptId,
        recoveryReason: context.reason,
        streamError: context.streamError instanceof Error ? context.streamError.message : undefined,
      },
      'Recovered interrupted graph state from LangGraph checkpoint after stream did not yield a terminal value',
    );
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
          reason: 'stream_error',
          streamError: new Error('LangGraph emitted an interrupt sentinel instead of a terminal state chunk.'),
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

function buildInitialState(params: StartAgentGraphTurnParams): AgentGraphState {
  return {
    messages: params.messages,
    resumeContext: createRuntimeContext(params),
    pendingWriteCall: null,
    replyText: '',
    draftReplyText: '',
    repairHint: '',
    answerRepairCount: 0,
    toolResults: [],
    files: [],
    roundsCompleted: 0,
    completedWindows: 0,
    totalRoundsCompleted: 0,
    workingSummary: '',
    taskState: getDefaultTaskState(),
    deduplicatedCallCount: 0,
    truncatedCallCount: 0,
    guardrailBlockedCallCount: 0,
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
    graphStatus: 'running',
    startedAtEpochMs: Date.now(),
    pendingInterrupt: null,
    interruptResolution: null,
  };
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
          params.resume.interruptKind === 'approval_review' ? params.resume.status : params.resume.decision,
      },
    }),
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(runId));
}

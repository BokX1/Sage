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
  ApprovalResumeInput,
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
  terminationReason: z.enum(['assistant_reply', 'step_limit', 'graph_timeout', 'approval_interrupt']),
  rebudgeting: GraphRebudgetEventSchema.optional(),
});

const ApprovalInterruptStateSchema = z.object({
  requestId: z.string(),
  call: GraphToolCallDescriptorSchema,
  payload: z.unknown(),
  coalesced: z.boolean().optional(),
  expiresAtIso: z.string().optional(),
});

const ApprovalResolutionStateSchema = z.object({
  requestId: z.string(),
  decision: z.enum(['approved', 'rejected', 'expired']),
  status: z.enum(['approved', 'rejected', 'expired', 'executed', 'failed']),
  reviewerId: z.string().nullable().optional(),
  decisionReasonText: z.string().nullable().optional(),
  errorText: z.string().nullable().optional(),
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
  toolResults: new ReducedValue(z.array(SerializedToolResultSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  files: new ReducedValue(z.array(GraphToolFileSchema).default([]), {
    reducer: (left, right) => [...left, ...right],
  }),
  roundsCompleted: new ReducedValue(z.number().default(0), {
    reducer: (left, right) => left + right,
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
    .enum(['assistant_reply', 'step_limit', 'graph_timeout', 'approval_interrupt'])
    .default('assistant_reply'),
  graphStatus: z.enum(['running', 'interrupted', 'completed', 'failed']).default('running'),
  startedAtEpochMs: z.number().default(0),
  approvalInterrupt: z.union([ApprovalInterruptStateSchema, z.null()]).default(null),
  approvalResolution: z.union([ApprovalResolutionStateSchema, z.null()]).default(null),
});

type GraphNodeName =
  | 'llm_call'
  | 'route_tool_phase'
  | 'execute_read_tools'
  | 'approval_gate'
  | 'execute_approved_write'
  | 'finalize_reply'
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
  roundEvents: ToolCallRoundEvent[];
  finalization: ToolCallFinalizationEvent;
  terminationReason: GraphTurnTerminationReason;
  graphStatus: AgentGraphState['graphStatus'];
  approvalInterrupt: AgentGraphState['approvalInterrupt'];
  approvalResolution: AgentGraphState['approvalResolution'];
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
    deduplicatedCallCount: state.deduplicatedCallCount,
    truncatedCallCount: state.truncatedCallCount,
    guardrailBlockedCallCount: state.guardrailBlockedCallCount,
    roundEvents: state.roundEvents,
    finalization: state.finalization,
    terminationReason: state.terminationReason,
    graphStatus: state.graphStatus,
    approvalInterrupt: state.approvalInterrupt,
    approvalResolution: state.approvalResolution,
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

function normalizeResolvedApprovalStatus(params: {
  decision: ApprovalResumeInput['status'];
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
    approvalRequestId: state.approvalInterrupt?.requestId ?? null,
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

function routeAfterToolExecution(
  state: AgentGraphState,
  graphConfig: AgentGraphConfig,
): GraphNodeName {
  if (isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.maxSteps) {
    return 'finalize_reply';
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
    const toolCalls = getLastAiToolCalls([aiMessage]);
    const nextTerminationReason =
      toolCalls.length === 0
        ? 'assistant_reply'
        : isTimedOut(state, graphConfig)
          ? 'graph_timeout'
          : state.roundsCompleted >= graphConfig.maxSteps
            ? 'step_limit'
            : state.terminationReason;

    return new Command({
      goto:
        toolCalls.length === 0
          ? 'finalize_turn'
          : isTimedOut(state, graphConfig) || state.roundsCompleted >= graphConfig.maxSteps
            ? 'finalize_reply'
            : 'route_tool_phase',
      update: {
        messages: [aiMessage],
        replyText: toolCalls.length === 0 ? extractMessageText(aiMessage) : state.replyText,
        terminationReason: nextTerminationReason,
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
        roundsCompleted: executedAny ? 1 : 0,
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
      goto: state.pendingWriteCall ? 'approval_gate' : routeAfterToolExecution(state, graphConfig),
      update,
    });
  };

  const approvalGateNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    if (!state.pendingWriteCall) {
      return new Command({ goto: routeAfterToolExecution(state, graphConfig), update: {} });
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
        goto: 'execute_approved_write',
        update: {
          pendingWriteCall: null,
          replyText: '',
          graphStatus: 'interrupted',
          terminationReason: 'approval_interrupt',
          approvalInterrupt: {
            requestId: materialized.request.id,
            call: outcome.call,
            payload: outcome.payload,
            coalesced: materialized.coalesced,
            expiresAtIso: materialized.request.expiresAt.toISOString(),
          },
          approvalResolution: null,
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
      goto: routeAfterToolExecution(state, graphConfig),
      update: {
        pendingWriteCall: null,
        messages: [toolMessage],
        toolResults: [outcome.result],
        files: outcome.files,
      },
    });
  };

  const approvalResumeNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    if (!state.approvalInterrupt?.requestId) {
      return new Command({ goto: routeAfterToolExecution(state, graphConfig), update: {} });
    }

    const runtimeContext = resolveRuntimeContext(state, config);
    const resume = interrupt({
      requestId: state.approvalInterrupt.requestId,
      kind: state.approvalInterrupt.payload.kind,
      coalesced: state.approvalInterrupt.coalesced,
      expiresAtIso: state.approvalInterrupt.expiresAtIso,
    }) as ApprovalResumeInput;
    const resumedContext: AgentGraphRuntimeContext = {
      ...runtimeContext,
      traceId: resume.resumeTraceId?.trim() || runtimeContext.traceId,
    };

    if (resume.status !== 'approved') {
      const result: SerializedToolResult = {
        name: state.approvalInterrupt.call.name,
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
        toolName: state.approvalInterrupt.call.name,
        callId: state.approvalInterrupt.call.id,
        content: JSON.stringify({
          status: resume.status,
          decisionReasonText: resume.decisionReasonText ?? null,
        }),
        result,
        files: [],
        status: 'error',
      });

      return new Command({
        goto: routeAfterToolExecution(state, graphConfig),
        update: {
          messages: [toolMessage],
          resumeContext: resumedContext,
          graphStatus: 'running',
          approvalResolution: {
            requestId: state.approvalInterrupt.requestId,
            decision: resume.status,
            status: resume.status,
            reviewerId: resume.reviewerId ?? null,
            decisionReasonText: resume.decisionReasonText ?? null,
          },
          approvalInterrupt: null,
          toolResults: [result],
        },
      });
    }

    const executed = await executeApprovedReviewTask({
      requestId: state.approvalInterrupt.requestId,
      toolName: state.approvalInterrupt.call.name,
      callId: state.approvalInterrupt.call.id,
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
      goto: routeAfterToolExecution(state, graphConfig),
      update: {
        messages: [toolMessage],
        resumeContext: resumedContext,
        graphStatus: 'running',
        approvalResolution: {
          requestId: state.approvalInterrupt.requestId,
          decision: resume.status,
          status: resolvedStatus,
          reviewerId: resume.reviewerId ?? null,
          decisionReasonText: resume.decisionReasonText ?? null,
          errorText: executed.result.error ?? null,
        },
        approvalInterrupt: null,
        toolResults: [executed.result],
        files: executed.files,
      },
    });
  };

  const forcedFinalizeNode = async (
    state: AgentGraphState,
    config: RunnableConfig,
  ): Promise<Command<unknown, Partial<AgentGraphState>, GraphNodeName>> => {
    const runtimeContext = resolveRuntimeContext(state, config);
    let replyText = 'I could not finalize a plain-text answer after tool execution. Please try again.';
    const finalization: ToolCallFinalizationEvent = {
      attempted: true,
      succeeded: true,
      fallbackUsed: false,
      returnedToolCallCount: 0,
      completedAt: nowIso(),
      terminationReason: state.terminationReason,
    };

    try {
      const prepared = buildRebudgetingEvent(
        [
          ...(state.messages as BaseMessage[]),
          new SystemMessage({
            content:
              'Tool-call steps are exhausted. Do not call tools. Return one final plain-text answer grounded only in prior context and tool results.',
          }),
        ],
        runtimeContext.model,
        runtimeContext.maxTokens,
      );
      const responseMessage = await createGraphChatModel({
        model: runtimeContext.model,
        apiKey: runtimeContext.apiKey,
        temperature: Math.max(0, runtimeContext.temperature - 0.1),
        timeoutMs: runtimeContext.timeoutMs,
        maxTokens: runtimeContext.maxTokens,
      }).invoke(prepared.trimmedMessages, config);
      const aiMessage = AIMessage.isInstance(responseMessage)
        ? responseMessage
        : new AIMessage({ content: extractMessageText(responseMessage as BaseMessage) });
      const returnedToolCalls = getLastAiToolCalls([aiMessage]);
      finalization.rebudgeting = prepared.rebudgeting;
      finalization.returnedToolCallCount = returnedToolCalls.length;
      finalization.completedAt = nowIso();
      if (returnedToolCalls.length > 0) {
        finalization.succeeded = false;
        finalization.fallbackUsed = true;
      } else {
        replyText = extractMessageText(aiMessage);
      }
    } catch (error) {
      logger.warn({ error, traceId: runtimeContext.traceId }, 'Agent graph forced finalization failed');
      finalization.succeeded = false;
      finalization.fallbackUsed = true;
      finalization.completedAt = nowIso();
    }

    return new Command({
      goto: 'finalize_turn',
      update: {
        replyText,
        finalization,
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
    .addNode('llm_call', callModelNode, {
      ends: ['route_tool_phase', 'finalize_reply', 'finalize_turn'],
    })
    .addNode('route_tool_phase', routeToolPhaseNode, {
      ends: ['execute_read_tools', 'approval_gate', 'llm_call'],
    })
    .addNode('execute_read_tools', executeReadToolsNode, {
      ends: ['approval_gate', 'llm_call', 'finalize_reply'],
    })
    .addNode('approval_gate', approvalGateNode, {
      ends: ['execute_approved_write', 'llm_call', 'finalize_reply'],
    })
    .addNode('execute_approved_write', approvalResumeNode, {
      ends: ['llm_call', 'finalize_reply'],
    })
    .addNode('finalize_reply', forcedFinalizeNode, {
      ends: ['finalize_turn'],
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

function isRecoverableApprovalInterruptState(state: AgentGraphState): boolean {
  return (
    state.graphStatus === 'interrupted' &&
    state.terminationReason === 'approval_interrupt' &&
    !!state.approvalInterrupt?.requestId
  );
}

function coerceInterruptedApprovalState(value: unknown): AgentGraphState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const state = value as Partial<AgentGraphState>;
  if (state.graphStatus !== 'interrupted' || state.terminationReason !== 'approval_interrupt') {
    return null;
  }

  const approvalInterrupt = state.approvalInterrupt;
  if (
    !approvalInterrupt ||
    typeof approvalInterrupt !== 'object' ||
    typeof approvalInterrupt.requestId !== 'string' ||
    approvalInterrupt.requestId.trim().length === 0
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
    reason: 'stream_error' | 'missing_final_state';
    streamError?: unknown;
  },
  ): Promise<AgentGraphState | null> {
  try {
    const snapshot = await graph.getState(config);
    const state = coerceInterruptedApprovalState(snapshot.values);
    if (!state || !isRecoverableApprovalInterruptState(state)) {
      return null;
    }

    logger.warn(
      {
        traceId: state.resumeContext.traceId,
        threadId: state.resumeContext.threadId,
        approvalRequestId: state.approvalInterrupt?.requestId,
        recoveryReason: context.reason,
        streamError: context.streamError instanceof Error ? context.streamError.message : undefined,
      },
      'Recovered interrupted approval state from LangGraph checkpoint after stream did not yield a terminal value',
    );
    return state;
  } catch (error) {
    logger.warn(
      {
        error,
        reason: context.reason,
        streamError: context.streamError instanceof Error ? context.streamError.message : undefined,
      },
      'Failed to recover interrupted approval state from LangGraph checkpoint',
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
    toolResults: [],
    files: [],
    roundsCompleted: 0,
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
    approvalInterrupt: null,
    approvalResolution: null,
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
  const runId = params.resumeTraceId?.trim() || params.threadId;
  const output = await runGraphValueStream(
    runtime.graph,
    new Command({
      resume: {
        status: params.decision,
        reviewerId: params.reviewerId ?? null,
        decisionReasonText: params.decisionReasonText ?? null,
        resumeTraceId: params.resumeTraceId ?? null,
      } satisfies ApprovalResumeInput,
    }),
    buildRunnableConfig({
      threadId: params.threadId,
      recursionLimit: runtime.config.recursionLimit,
      runId,
      runName: 'sage_agent_approval_resume',
      context: {
        threadId: params.threadId,
        traceId: runId,
      },
      callbacks: telemetry.callbacks,
      tags: ['sage', 'agent-runtime', 'approval-resume'],
      metadata: {
        threadId: params.threadId,
        decision: params.decision,
      },
    }),
  );
  await telemetry.flush();
  return normalizeGraphResult(output, telemetry.getRunReferences(runId));
}

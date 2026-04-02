import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import { task } from '@langchain/langgraph';
import type { ToolCall } from '@langchain/core/messages/tool';
import { z } from 'zod';
import { executeToolWithTimeout, type ToolResult } from '../toolCallExecution';
import type { ApprovalInterruptPayload } from '../toolControlSignals';
import { ApprovalRequiredSignal } from '../toolControlSignals';
import type { ToolDefinition, ToolExecutionContext } from '../runtimeToolContract';
import { getRuntimeSurfaceTool } from '../runtimeSurface';
import type { GraphToolFile, SerializedToolResult } from './types';

export interface GraphToolCallDescriptor {
  id?: string;
  name: string;
  args: unknown;
}

export interface DurableToolTaskInput {
  activeToolNames: string[];
  call: GraphToolCallDescriptor;
  context: ToolExecutionContext;
  timeoutMs: number;
}

export type DurableToolTaskOutput =
  | {
      kind: 'tool_result';
      toolName: string;
      callId?: string;
      content: string;
      result: SerializedToolResult;
      files: GraphToolFile[];
    }
  | {
      kind: 'approval_required';
      toolName: string;
      callId?: string;
      payload: ApprovalInterruptPayload;
      call: GraphToolCallDescriptor;
      latencyMs: number;
    };

export interface ActiveToolCatalog {
  allTools: DynamicStructuredTool[];
  readOnlyTools: DynamicStructuredTool[];
  definitions: Map<string, ToolDefinition<unknown>>;
  providerAllowedToolNames: string[];
  parallelToolCallsAllowed: boolean;
}

export interface ReadOnlyToolExecutionPlan {
  parallelCalls: GraphToolCallDescriptor[];
  sequentialCalls: GraphToolCallDescriptor[];
}

export interface PlannedApprovalInterrupt {
  toolName: string;
  callId?: string;
  call: GraphToolCallDescriptor;
  payload: ApprovalInterruptPayload;
  approvalGroupKey: string;
}

export const RUNTIME_REQUEST_USER_INPUT_TOOL_NAME = 'runtime_request_user_input';
export const RUNTIME_CANCEL_TURN_TOOL_NAME = 'runtime_cancel_turn';

const RuntimeRequestUserInputArgsSchema = z.object({
  prompt: z.string().trim().min(1),
});

const RuntimeCancelTurnArgsSchema = z.object({
  replyText: z.string().trim().min(1),
});

export type RuntimeControlSignal =
  | {
      kind: 'user_input_pending';
      replyText: string;
      toolName: typeof RUNTIME_REQUEST_USER_INPUT_TOOL_NAME;
    }
  | {
      kind: 'cancelled';
      replyText: string;
      toolName: typeof RUNTIME_CANCEL_TURN_TOOL_NAME;
    };

export interface ResolvedRuntimeControlSignal {
  signal: RuntimeControlSignal | null;
  controlCount: number;
  externalCount: number;
  invalid: boolean;
}

function buildInternalRuntimeTool(params: {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
}): DynamicStructuredTool {
  return tool(
    async () => 'Internal runtime control tool.',
    {
      name: params.name,
      description: params.description,
      schema: params.schema,
    },
  ) as DynamicStructuredTool;
}

function normalizeToolCallArgs(call: ToolCall | GraphToolCallDescriptor): unknown {
  return 'args' in call ? call.args : {};
}

function isRuntimeControlToolName(name: string): boolean {
  return name === RUNTIME_REQUEST_USER_INPUT_TOOL_NAME || name === RUNTIME_CANCEL_TURN_TOOL_NAME;
}

export function buildRuntimeControlTools(): DynamicStructuredTool[] {
  return [
    buildInternalRuntimeTool({
      name: RUNTIME_REQUEST_USER_INPUT_TOOL_NAME,
      description:
        'Use this when Sage needs one specific user reply before it can continue. The prompt becomes the visible message and the runtime enters waiting_user_input.',
      schema: RuntimeRequestUserInputArgsSchema,
    }),
    buildInternalRuntimeTool({
      name: RUNTIME_CANCEL_TURN_TOOL_NAME,
      description:
        'Use this when Sage must cancel the current task cleanly. replyText becomes the visible terminal message and the runtime marks the turn cancelled.',
      schema: RuntimeCancelTurnArgsSchema,
    }),
  ];
}

export function resolveRuntimeControlSignal(
  calls: Array<ToolCall | GraphToolCallDescriptor>,
): ResolvedRuntimeControlSignal {
  const controlCalls = calls.filter((call) => isRuntimeControlToolName(call.name));
  const externalCount = calls.length - controlCalls.length;

  if (controlCalls.length === 0) {
    return {
      signal: null,
      controlCount: 0,
      externalCount,
      invalid: false,
    };
  }

  if (controlCalls.length !== 1) {
    return {
      signal: null,
      controlCount: controlCalls.length,
      externalCount,
      invalid: true,
    };
  }

  const [controlCall] = controlCalls;
  if (!controlCall) {
    return {
      signal: null,
      controlCount: controlCalls.length,
      externalCount,
      invalid: true,
    };
  }

  if (controlCall.name === RUNTIME_REQUEST_USER_INPUT_TOOL_NAME) {
    const parsed = RuntimeRequestUserInputArgsSchema.safeParse(normalizeToolCallArgs(controlCall));
    return {
      signal: parsed.success
        ? {
            kind: 'user_input_pending',
            replyText: parsed.data.prompt,
            toolName: RUNTIME_REQUEST_USER_INPUT_TOOL_NAME,
          }
        : null,
      controlCount: 1,
      externalCount,
      invalid: !parsed.success,
    };
  }

  const parsed = RuntimeCancelTurnArgsSchema.safeParse(normalizeToolCallArgs(controlCall));
  return {
    signal: parsed.success
      ? {
          kind: 'cancelled',
          replyText: parsed.data.replyText,
          toolName: RUNTIME_CANCEL_TURN_TOOL_NAME,
        }
      : null,
    controlCount: 1,
    externalCount,
    invalid: !parsed.success,
  };
}

function sanitizeToolResultForModel(value: unknown, depth = 0): unknown {
  if (depth >= 6) return '[…]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [REDACTED]')
      .replace(/\bBot\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bot [REDACTED]');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolResultForModel(item, depth + 1));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      out[key] = /(?:authorization|api[_-]?key|token|secret|password|cookie|session)/i.test(key)
        ? '[REDACTED]'
        : sanitizeToolResultForModel(entry, depth + 1);
    }
    return out;
  }
  return String(value);
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function serializeToolResult(result: ToolResult): SerializedToolResult {
  return {
    ...result,
    artifactsMeta: result.artifacts?.map((artifact) => ({
      kind: artifact.kind,
      filename: artifact.filename,
      mimetype: artifact.mimetype,
      byteLength: artifact.data?.length,
      visibleSummary: artifact.visibleSummary,
    })),
  };
}

function collectFiles(result: ToolResult): GraphToolFile[] {
  if (!result.success || !result.artifacts?.length) {
    return [];
  }

  return result.artifacts
    .filter((artifact) => artifact.kind === 'file' && artifact.data && artifact.filename)
    .map((artifact) => ({
      name: artifact.filename as string,
      dataBase64: (artifact.data as Buffer).toString('base64'),
      mimetype: artifact.mimetype,
    }));
}

function buildToolMessageContent(result: ToolResult): string {
  if (!result.success) {
    return result.error ?? 'Tool execution failed.';
  }

  if (result.modelSummary?.trim()) {
    return result.modelSummary.trim();
  }

  if (result.telemetry.observationPolicy === 'artifact-only') {
    return 'Artifact created.';
  }

  try {
    const sanitized = sanitizeToolResultForModel(result.structuredContent);
    const serialized = safeJsonStringify(sanitized);
    if (!serialized) {
      return sanitized === undefined ? 'null' : '[unserializable tool result]';
    }
    return serialized;
  } catch {
    return '[unserializable tool result]';
  }
}

function isReadOnlyCall(
  definition: ToolDefinition<unknown> | undefined,
  args: unknown,
  context: ToolExecutionContext,
): boolean {
  if (!definition) {
    return false;
  }

  const predicate = definition.runtime.readOnlyPredicate;
  if (typeof predicate === 'function') {
    try {
      return predicate(args, context);
    } catch {
      return false;
    }
  }

  return definition.runtime.readOnly === true;
}

export function isParallelSafeToolCall(params: {
  definitions: Map<string, ToolDefinition<unknown>>;
  call: ToolCall | GraphToolCallDescriptor;
  context: ToolExecutionContext;
}): boolean {
  const definition = params.definitions.get(params.call.name);
  if (!isReadOnlyCall(definition, params.call.args, params.context)) {
    return false;
  }
  return definition?.annotations?.parallelSafe === true;
}

export function planReadOnlyToolExecution(params: {
  definitions: Map<string, ToolDefinition<unknown>>;
  calls: GraphToolCallDescriptor[];
  context: ToolExecutionContext;
}): ReadOnlyToolExecutionPlan {
  const parallelCalls: GraphToolCallDescriptor[] = [];
  const sequentialCalls: GraphToolCallDescriptor[] = [];

  for (const call of params.calls) {
    if (isParallelSafeToolCall({
      definitions: params.definitions,
      call,
      context: params.context,
    })) {
      parallelCalls.push(call);
    } else {
      sequentialCalls.push(call);
    }
  }

  return {
    parallelCalls,
    sequentialCalls,
  };
}

export const executeDurableToolTask = task(
  { name: 'sage_execute_tool_call' },
  async (input: DurableToolTaskInput): Promise<DurableToolTaskOutput> => {
    const definition = getRuntimeSurfaceTool(input.call.name);
    if (!definition || !input.activeToolNames.includes(input.call.name)) {
      return {
        kind: 'tool_result',
        toolName: input.call.name,
        callId: input.call.id,
        content: `Unknown or inactive tool "${input.call.name}".`,
        result: {
          name: input.call.name,
          success: false,
          error: `Unknown or inactive tool "${input.call.name}".`,
          errorType: 'validation',
          telemetry: { latencyMs: 0 },
        },
        files: [],
      };
    }

    const startedAt = Date.now();
    try {
      const rawResult = await executeToolWithTimeout(
        definition,
        {
          name: input.call.name,
          args: input.call.args,
        },
        input.context,
        input.timeoutMs,
      );
      return {
        kind: 'tool_result',
        toolName: input.call.name,
        callId: input.call.id,
        content: buildToolMessageContent(rawResult),
        result: serializeToolResult(rawResult),
        files: collectFiles(rawResult),
      };
    } catch (error) {
      if (error instanceof ApprovalRequiredSignal) {
        return {
          kind: 'approval_required',
          toolName: input.call.name,
          callId: input.call.id,
          payload: error.payload,
          call: input.call,
          latencyMs: Math.max(0, Date.now() - startedAt),
        };
      }
      throw error;
    }
  },
);

export const executeApprovedReviewTask = task(
  { name: 'sage_execute_approved_review_request' },
  async (input: {
    requestId: string;
    toolName: string;
    callId?: string;
    reviewerId?: string | null;
    decisionReasonText?: string | null;
    resumeTraceId?: string | null;
  }) => {
    const { executeApprovedReviewRequest } = await import('../../admin/adminActionService');
    const startedAt = Date.now();
    const action = await executeApprovedReviewRequest({
      requestId: input.requestId,
      reviewerId: input.reviewerId ?? null,
      decisionReasonText: input.decisionReasonText ?? null,
      resumeTraceId: input.resumeTraceId ?? null,
    });

    const status = action?.status ?? 'failed';
    const contentPayload = sanitizeToolResultForModel({
      requestId: input.requestId,
      status,
      kind: action?.kind ?? null,
      result: action?.resultJson ?? null,
      errorText: action?.errorText ?? null,
    });
    const serializedContentPayload = safeJsonStringify(contentPayload);
    const content = serializedContentPayload ?? '[unserializable approval execution result]';

    return {
      status,
      content,
      result: {
        name: input.toolName,
        success: status === 'executed',
        structuredContent: action?.resultJson ?? { status },
        error:
          status === 'executed'
            ? undefined
            : action?.errorText ?? `Approval request resolved with status "${status}".`,
        telemetry: { latencyMs: Math.max(0, Date.now() - startedAt) },
      } satisfies SerializedToolResult,
      files: [] as GraphToolFile[],
      callId: input.callId,
      toolName: input.toolName,
    };
  },
);

export async function prepareToolApprovalInterrupt(params: {
  activeToolNames: string[];
  call: GraphToolCallDescriptor;
  context: ToolExecutionContext;
}): Promise<PlannedApprovalInterrupt | null> {
  void params;
  return null;
}

function buildLangChainTool(params: {
  definition: ToolDefinition<unknown>;
  activeToolNames: string[];
  context: ToolExecutionContext;
  timeoutMs: number;
}): DynamicStructuredTool {
  const { definition, activeToolNames, context, timeoutMs } = params;

  return tool(
    async (input) => {
      const outcome = await executeDurableToolTask({
        activeToolNames,
        call: {
          name: definition.name,
          args: input,
        },
        context,
        timeoutMs,
      });

      if (outcome.kind !== 'tool_result') {
        return [
          `Tool call "${definition.name}" requires approval and cannot run in the read-only batch.`,
          {
            approvalRequired: true,
            payload: outcome.payload,
            result: {
              name: definition.name,
              success: false,
              error: `Tool call "${definition.name}" requires approval.`,
              errorType: 'execution',
              telemetry: { latencyMs: 0 },
            } satisfies SerializedToolResult,
            files: [] as GraphToolFile[],
          },
        ] as const;
      }

      return [
        outcome.content,
        {
          result: outcome.result,
          files: outcome.files,
        },
      ] as const;
    },
    {
      name: definition.name,
      description: definition.description,
      schema: definition.inputValidator,
      responseFormat: 'content_and_artifact',
    },
  ) as DynamicStructuredTool;
}

export function buildActiveToolCatalog(params: {
  activeToolNames: string[];
  context: ToolExecutionContext;
  timeoutMs: number;
}): ActiveToolCatalog {
  const definitions = new Map<string, ToolDefinition<unknown>>();
  const allTools: DynamicStructuredTool[] = [];
  const readOnlyTools: DynamicStructuredTool[] = [];
  let parallelToolCallsAllowed = false;

  for (const toolName of params.activeToolNames) {
    const definition = getRuntimeSurfaceTool(toolName);
    if (!definition) {
      continue;
    }

    definitions.set(toolName, definition);
    const langChainTool = buildLangChainTool({
      definition,
      activeToolNames: params.activeToolNames,
      context: params.context,
      timeoutMs: params.timeoutMs,
    });
    allTools.push(langChainTool);
    if (
      definition.annotations?.parallelSafe === true &&
      isReadOnlyCall(definition, {}, params.context)
    ) {
      parallelToolCallsAllowed = true;
      readOnlyTools.push(langChainTool);
    }
  }

  return {
    allTools,
    readOnlyTools,
    definitions,
    providerAllowedToolNames: [...definitions.keys()],
    parallelToolCallsAllowed,
  };
}

export function isReadOnlyToolCall(params: {
  definitions: Map<string, ToolDefinition<unknown>>;
  call: ToolCall | GraphToolCallDescriptor;
  context: ToolExecutionContext;
}): boolean {
  const definition = params.definitions.get(params.call.name);
  return isReadOnlyCall(definition, params.call.args, params.context);
}

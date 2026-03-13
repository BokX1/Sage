import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import { task } from '@langchain/langgraph';
import type { ToolCall } from '@langchain/core/messages/tool';
import { executeToolWithTimeout, type ToolResult } from '../toolCallExecution';
import type { ApprovalInterruptPayload } from '../toolControlSignals';
import { ApprovalRequiredSignal } from '../toolControlSignals';
import { globalToolRegistry, type ToolDefinition, type ToolExecutionContext } from '../toolRegistry';
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
  maxResultChars: number;
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
    };

export interface ActiveToolCatalog {
  allTools: DynamicStructuredTool[];
  readOnlyTools: DynamicStructuredTool[];
  definitions: Map<string, ToolDefinition<unknown>>;
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

function truncateText(value: string, maxChars: number): string {
  const cap = Math.max(1, Math.floor(maxChars));
  if (value.length <= cap) {
    return value;
  }
  return `${value.slice(0, Math.max(0, cap - 1))}…`;
}

function serializeToolResult(result: ToolResult): SerializedToolResult {
  return {
    ...result,
    attachmentsMeta: result.attachments?.map((attachment) => ({
      filename: attachment.filename,
      mimetype: attachment.mimetype,
      byteLength: attachment.data.length,
    })),
  };
}

function collectFiles(result: ToolResult): GraphToolFile[] {
  if (!result.success || !result.attachments?.length) {
    return [];
  }

  return result.attachments.map((attachment) => ({
    name: attachment.filename,
    dataBase64: attachment.data.toString('base64'),
    mimetype: attachment.mimetype,
  }));
}

function buildToolMessageContent(result: ToolResult, maxResultChars: number): string {
  if (!result.success) {
    return truncateText(result.error ?? 'Tool execution failed.', Math.max(240, Math.floor(maxResultChars / 2)));
  }

  try {
    return truncateText(
      JSON.stringify(sanitizeToolResultForModel(result.result)),
      maxResultChars,
    );
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

  const predicate = definition.metadata?.readOnlyPredicate;
  if (typeof predicate === 'function') {
    try {
      return predicate(args, context);
    } catch {
      return false;
    }
  }

  return definition.metadata?.readOnly === true;
}

export const executeDurableToolTask = task(
  { name: 'sage_execute_tool_call' },
  async (input: DurableToolTaskInput): Promise<DurableToolTaskOutput> => {
    if (!input.activeToolNames.includes(input.call.name)) {
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
          latencyMs: 0,
        },
        files: [],
      };
    }

    try {
      const result = await executeToolWithTimeout(
        globalToolRegistry,
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
        content: buildToolMessageContent(result, input.maxResultChars),
        result: serializeToolResult(result),
        files: collectFiles(result),
      };
    } catch (error) {
      if (error instanceof ApprovalRequiredSignal) {
        return {
          kind: 'approval_required',
          toolName: input.call.name,
          callId: input.call.id,
          payload: error.payload,
          call: input.call,
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
    maxResultChars: number;
  }) => {
    const { executeApprovedReviewRequest } = await import('../../admin/adminActionService');
    const action = await executeApprovedReviewRequest({
      requestId: input.requestId,
      reviewerId: input.reviewerId ?? null,
      decisionReasonText: input.decisionReasonText ?? null,
      resumeTraceId: input.resumeTraceId ?? null,
    });

    const status = action?.status ?? 'failed';
    const content = truncateText(
      JSON.stringify(
        sanitizeToolResultForModel({
          requestId: input.requestId,
          status,
          kind: action?.kind ?? null,
          result: action?.resultJson ?? null,
          errorText: action?.errorText ?? null,
        }),
      ),
      input.maxResultChars,
    );

    return {
      status,
      content,
      result: {
        name: input.toolName,
        success: status === 'executed',
        result: action?.resultJson ?? { status },
        error:
          status === 'executed'
            ? undefined
            : action?.errorText ?? `Approval request resolved with status "${status}".`,
        latencyMs: 0,
      } satisfies SerializedToolResult,
      files: [] as GraphToolFile[],
      callId: input.callId,
      toolName: input.toolName,
    };
  },
);

function buildLangChainTool(params: {
  definition: ToolDefinition<unknown>;
  activeToolNames: string[];
  context: ToolExecutionContext;
  timeoutMs: number;
  maxResultChars: number;
}): DynamicStructuredTool {
  const { definition, activeToolNames, context, timeoutMs, maxResultChars } = params;

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
        maxResultChars,
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
              latencyMs: 0,
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
      schema: definition.schema,
      responseFormat: 'content_and_artifact',
    },
  ) as DynamicStructuredTool;
}

export function buildActiveToolCatalog(params: {
  activeToolNames: string[];
  context: ToolExecutionContext;
  timeoutMs: number;
  maxResultChars: number;
}): ActiveToolCatalog {
  const definitions = new Map<string, ToolDefinition<unknown>>();
  const allTools: DynamicStructuredTool[] = [];
  const readOnlyTools: DynamicStructuredTool[] = [];

  for (const toolName of params.activeToolNames) {
    const definition = globalToolRegistry.get(toolName);
    if (!definition) {
      continue;
    }

    definitions.set(toolName, definition);
    const langChainTool = buildLangChainTool({
      definition,
      activeToolNames: params.activeToolNames,
      context: params.context,
      timeoutMs: params.timeoutMs,
      maxResultChars: params.maxResultChars,
    });
    allTools.push(langChainTool);
    if (isReadOnlyCall(definition, {}, params.context) || definition.metadata?.readOnlyPredicate) {
      readOnlyTools.push(langChainTool);
    }
  }

  return {
    allTools,
    readOnlyTools,
    definitions,
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

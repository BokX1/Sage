/**
 * Register, validate, and expose tool definitions for runtime execution.
 */
import { z } from 'zod';
import { buildToolErrorDetails, extractToolErrorDetails, type ToolErrorDetails } from './toolErrors';
import type { CurrentTurnContext, ReplyTargetContext } from './continuityContext';
import { isToolControlSignal, type ApprovalInterruptPayload } from './toolControlSignals';
import { buildRoutedToolRepairGuidance, getToolValidationHint } from './toolDocs';

// Guardrail against runaway or malicious tool payloads (for example oversized base64 blobs).
// Must be large enough to support legitimate multipart/file workflows.
const MAX_ARGS_SIZE = 256 * 1024;

function formatZodIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path.map((part) => String(part)).join('.');
}

function formatZodIssues(issues: z.ZodIssue[], maxIssues = 10): { text: string; truncated: boolean } {
  const formatted: string[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const push = (path: PropertyKey[], message: string): void => {
    if (formatted.length >= maxIssues) {
      truncated = true;
      return;
    }
    const normalized = message.trim();
    if (!normalized) return;
    const line = `${formatZodIssuePath(path)}: ${normalized}`;
    if (seen.has(line)) return;
    seen.add(line);
    formatted.push(line);
  };

  const visit = (issue: z.ZodIssue): void => {
    if (formatted.length >= maxIssues) {
      truncated = true;
      return;
    }

    const unionErrors = (issue as unknown as { unionErrors?: Array<{ issues?: z.ZodIssue[] }> }).unionErrors;
    if (Array.isArray(unionErrors) && unionErrors.length > 0) {
      for (const unionError of unionErrors) {
        const nestedIssues = Array.isArray(unionError?.issues) ? unionError.issues : [];
        for (const nestedIssue of nestedIssues) {
          visit(nestedIssue);
          if (formatted.length >= maxIssues) {
            truncated = true;
            return;
          }
        }
      }
      return;
    }

    push(issue.path, issue.message);
  };

  for (const issue of issues) {
    visit(issue);
    if (formatted.length >= maxIssues) {
      truncated = true;
      break;
    }
  }

  if (formatted.length === 0) {
    return { text: 'Invalid input.', truncated: false };
  }

  return { text: formatted.join('; '), truncated };
}

function buildValidationHint(toolName: string): string | undefined {
  return getToolValidationHint(toolName.trim().toLowerCase());
}

function buildValidationErrorDetails(toolName: string, args: unknown): ToolErrorDetails {
  return buildToolErrorDetails({
    category: 'validation',
    hint: buildValidationHint(toolName),
    repair: buildRoutedToolRepairGuidance(toolName, args),
  });
}

/** Carry immutable context passed into every tool execution. */
export interface ToolExecutionContext {
  traceId: string;
  graphThreadId?: string;
  graphRunKind?: 'turn' | 'approval_resume';
  graphStep?: number;
  approvalRequestId?: string | null;
  approvalResume?: {
    requestId: string;
    decision: 'approved' | 'rejected' | 'expired';
    reviewerId?: string | null;
    decisionReasonText?: string | null;
    resumeTraceId?: string | null;
  } | null;
  userId: string;
  channelId: string;
  guildId?: string | null;
  apiKey?: string;
  /** Whether the current turn was initiated by an admin-capable caller. */
  invokerIsAdmin?: boolean;
  /** Whether the caller has moderation-capable Discord permissions for moderation workflows. */
  invokerCanModerate?: boolean;
  /** Invocation source used for tool-policy decisions. */
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  /** Optional route metadata for route-aware tool behavior. */
  routeKind?: string;
  /** Structured current-turn context carried into Discord-aware tools. */
  currentTurn?: CurrentTurnContext;
  /** Direct reply target surfaced in the runtime prompt, when present. */
  replyTarget?: ReplyTargetContext | null;
  /** Optional abort signal to check for timeout/cancellation. Tools should check signal.aborted periodically. */
  signal?: AbortSignal;
}

export type ToolActionMutability = 'read' | 'write';

export interface ToolActionPolicy<TArgs = unknown> {
  mutability: ToolActionMutability;
  approvalMode?: 'none' | 'required';
  approvalGroupKey?: string;
  timeoutMs?: number;
  retryClass?: 'none' | 'default' | 'safe-idempotent';
  resultBudget?: 'default' | 'large';
  idempotencyKey?: string | ((args: TArgs, ctx: ToolExecutionContext) => string | null | undefined);
  prepareApproval?: (args: TArgs, ctx: ToolExecutionContext) => Promise<ApprovalInterruptPayload>;
}

export interface ResolvedToolActionPolicy<TArgs = unknown> {
  tool: ToolDefinition<TArgs>;
  args: TArgs;
  policy: ToolActionPolicy<TArgs>;
}

/** Optional metadata attached to each tool definition for execution behavior. */
export interface ToolMetadata {
  /**
   * Marks tools safe for read-only parallelization and in-round deduplication.
   * Missing metadata defaults to non-read-only execution.
   */
  readOnly?: boolean;
  /**
   * Optional per-call read-only predicate. When provided, it supersedes the static
   * `readOnly` flag and is evaluated against the untrusted tool args payload.
   *
   * Implementations must be side-effect free and conservative: return `true`
   * only when the call is guaranteed to be read-only.
  */
  readOnlyPredicate?: (args: unknown, ctx: ToolExecutionContext) => boolean;
  /** Access tier for tool visibility and invocation. Missing value defaults to public. */
  access?: 'public' | 'admin';
  /**
   * Optional execution policy for write-phase orchestration. This is the graph-owned
   * contract for approval preparation and future retry or idempotency hints.
   */
  actionPolicy?: (
    args: unknown,
    ctx: ToolExecutionContext,
  ) => ToolActionPolicy<unknown> | Promise<ToolActionPolicy<unknown>>;
}

/** Define one runtime tool with schema validation and async execution. */
export interface ToolDefinition<TArgs = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<TArgs>;
  metadata?: ToolMetadata;
  execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<unknown>;
}

/** Return shape for validating tool calls before execution. */
export type ToolValidationResult<TArgs = unknown> =
  | { success: true; args: TArgs }
  | { success: false; error: string; errorDetails?: ToolErrorDetails };

/** Return shape for tool execution outcomes. */
export type ToolExecutionResult =
  | { success: true; result: unknown }
  | {
      success: false;
      error: string;
      errorType: 'validation' | 'execution';
      errorDetails?: ToolErrorDetails;
    };

/**
 * Provide a mutable registry for runtime tool definitions.
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition<unknown>> = new Map();

  /**
   * Register a tool definition.
   *
   * @param tool - Tool definition keyed by `tool.name`.
   * @returns Nothing.
   * @throws Error when a duplicate tool name is registered.
   */
  register<TArgs>(tool: ToolDefinition<TArgs>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as ToolDefinition<unknown>);
  }

  /** Get a tool definition by name. */
  get(name: string): ToolDefinition<unknown> | undefined {
    return this.tools.get(name);
  }

  /** Return whether a named tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** List all registered tool names. */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Validate an inbound tool call against registry and schema constraints.
   *
   * @param call - Tool name and untrusted args payload.
   * @returns Validation result with parsed args on success.
   */
  validateToolCall<TArgs = unknown>(call: {
    name: string;
    args: unknown;
  }): ToolValidationResult<TArgs> {
    const { name, args } = call;

    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: "${name}". Allowed tools: ${this.listNames().join(', ') || 'none'}`,
      };
    }

    let argsJson: string | undefined;
    try {
      argsJson = JSON.stringify(args);
    } catch {
      return {
        success: false,
        error: `Tool arguments for "${name}" must be JSON-serializable`,
      };
    }

    if (typeof argsJson !== 'string') {
      return {
        success: false,
        error: `Tool arguments for "${name}" must be JSON-serializable`,
      };
    }

    if (argsJson.length > MAX_ARGS_SIZE) {
      return {
        success: false,
        error: `Tool arguments exceed maximum size (${argsJson.length} > ${MAX_ARGS_SIZE} bytes)`,
      };
    }

    const parseResult = tool.schema.safeParse(args);
    if (!parseResult.success) {
      const formatted = formatZodIssues(parseResult.error.issues);
      const issues = formatted.truncated ? `${formatted.text}; (+more)` : formatted.text;
      return {
        success: false,
        error: `Invalid arguments for tool "${name}": ${issues}`,
        errorDetails: buildValidationErrorDetails(name, args),
      };
    }

    return {
      success: true,
      args: parseResult.data as TArgs,
    };
  }

  /**
   * Resolve a validated per-call execution policy.
   *
   * Returns `null` when the tool is unknown or the call fails validation so callers can
   * safely fall back to normal execution-path error handling.
   */
  async resolveActionPolicy<TArgs = unknown>(
    call: { name: string; args: unknown },
    ctx: ToolExecutionContext,
  ): Promise<ResolvedToolActionPolicy<TArgs> | null> {
    const validation = this.validateToolCall<TArgs>(call);
    if (!validation.success) {
      return null;
    }

    const tool = this.tools.get(call.name) as ToolDefinition<TArgs> | undefined;
    if (!tool) {
      return null;
    }

    const readOnlyPredicate = tool.metadata?.readOnlyPredicate;
    let mutability: ToolActionMutability = tool.metadata?.readOnly === true ? 'read' : 'write';
    if (typeof readOnlyPredicate === 'function') {
      try {
        mutability = readOnlyPredicate(validation.args, ctx) ? 'read' : 'write';
      } catch {
        mutability = 'write';
      }
    }

    const resolved = tool.metadata?.actionPolicy
      ? ((await tool.metadata.actionPolicy(validation.args, ctx)) as ToolActionPolicy<TArgs>)
      : null;

    return {
      tool,
      args: validation.args,
      policy:
        resolved ?? {
          mutability,
          approvalMode: 'none',
        },
    };
  }

  /**
   * Validate and execute a tool call.
   *
   * @param call - Tool name and untrusted args payload.
   * @param ctx - Runtime execution context.
   * @returns Execution result with validation/exception normalization.
   */
  async executeValidated<TArgs = unknown>(
    call: { name: string; args: unknown },
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const validation = this.validateToolCall<TArgs>(call);
    if (!validation.success) {
      // TS should narrow this, but if not, we access error safely
      const error = 'error' in validation ? validation.error : 'Validation failed';
      return {
        success: false,
        error,
        errorType: 'validation',
        errorDetails: buildToolErrorDetails({
          category: 'validation',
          hint: validation.errorDetails?.hint ?? buildValidationHint(call.name),
          repair: validation.errorDetails?.repair,
        }),
      };
    }

    const tool = this.tools.get(call.name)!;
    try {
      const result = await tool.execute(validation.args, ctx);
      return { success: true, result };
    } catch (err) {
      if (isToolControlSignal(err)) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const errorDetails = extractToolErrorDetails(err) ?? undefined;
      return {
        success: false,
        error: `Tool execution failed: ${message}`,
        errorType: 'execution',
        errorDetails,
      };
    }
  }
}

/** Provide the process-global registry used by the LangGraph runtime. */
export const globalToolRegistry = new ToolRegistry();

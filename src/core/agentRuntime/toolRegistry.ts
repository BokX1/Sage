/**
 * Register, validate, and expose tool definitions for runtime execution.
 */
import { z } from 'zod';
import { sanitizeJsonSchemaForProvider } from '../utils/json-schema';

// Guardrail against runaway or malicious tool payloads (for example oversized base64 blobs).
// Must be large enough to support legitimate multipart/file workflows.
const MAX_ARGS_SIZE = 256 * 1024;

/** Carry immutable context passed into every tool execution. */
export interface ToolExecutionContext {
  traceId: string;
  userId: string;
  channelId: string;
  guildId?: string | null;
  apiKey?: string;
  /** Whether the current turn was initiated by an admin-capable caller. */
  invokerIsAdmin?: boolean;
  /** Invocation source used for tool-policy decisions. */
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
  /** Optional route metadata for route-aware tool behavior. */
  routeKind?: string;
  /**
   * Optional execution profile used to enforce deterministic provider/tooling
   * behavior for specific runtime paths (for example search-high).
   */
  toolExecutionProfile?: 'default' | 'search_high';
  /** Optional abort signal to check for timeout/cancellation. Tools should check signal.aborted periodically. */
  signal?: AbortSignal;
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
  | { success: false; error: string };

/** Return shape for tool execution outcomes. */
export type ToolExecutionResult =
  | { success: true; result: unknown }
  | { success: false; error: string; errorType: 'validation' | 'execution' };

/** Describe tool schema format expected by OpenAI-compatible providers. */
export interface OpenAIToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

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

  /** Convert registered tools into OpenAI function-tool specifications. */
  listOpenAIToolSpecs(): OpenAIToolSpec[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: sanitizeJsonSchemaForProvider(
          z.toJSONSchema(tool.schema as z.ZodTypeAny),
        ),
      },
    }));
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
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return {
        success: false,
        error: `Invalid arguments for tool "${name}": ${issues}`,
      };
    }

    return {
      success: true,
      args: parseResult.data as TArgs,
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
      return { success: false, error, errorType: 'validation' };
    }

    const tool = this.tools.get(call.name)!;
    try {
      const result = await tool.execute(validation.args, ctx);
      return { success: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Tool execution failed: ${message}`,
        errorType: 'execution',
      };
    }
  }
}

/** Provide process-global registry used by the runtime tool loop. */
export const globalToolRegistry = new ToolRegistry();

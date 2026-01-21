import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const MAX_ARGS_SIZE = 10 * 1024;
/**
 * Define execution metadata for tool calls.
 *
 * Details: includes identifiers used for tracing, logging, and access checks.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ToolExecutionContext {
  traceId: string;
  userId: string;
  channelId: string;
}

/**
 * Define a tool contract with schema-validated arguments.
 *
 * Details: a tool must declare a unique name, describe itself for the LLM, and
 * supply a Zod schema for argument validation.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ToolDefinition<TArgs = unknown> {
  /** Unique tool name (must match allowlist). */
  name: string;
  /** Human-readable description for the LLM. */
  description: string;
  /** Zod schema for argument validation. */
  schema: z.ZodType<TArgs>;
  /** Execute the tool with validated arguments. */
  execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<unknown>;
}

/**
 * Represent validation outcomes for a tool call.
 *
 * Details: success carries validated arguments; failure carries a human-readable
 * error message.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export type ToolValidationResult<TArgs = unknown> =
  | { success: true; args: TArgs }
  | { success: false; error: string };

/**
 * Describe a tool in OpenAI-compatible JSON schema format.
 *
 * Details: used to advertise registered tools to LLM providers.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface OpenAIToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

const toJsonSchema = zodToJsonSchema as unknown as (
  schema: z.ZodTypeAny,
  options?: Record<string, unknown>,
) => object;

/**
 * Manage registered tools with validation and allowlisting.
 *
 * Details: enforces name uniqueness, argument schema validation, and maximum
 * serialized argument size before execution.
 *
 * Side effects: none.
 * Error behavior: throws on duplicate registration; returns validation failures
 * for invalid tool calls.
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition<unknown>> = new Map();

  /**
   * Register a tool definition.
   *
   * Details: name collisions are rejected to preserve the allowlist invariant.
   *
   * Side effects: mutates the registry.
   * Error behavior: throws when a tool name is already registered.
   *
   * @param tool - Tool definition to register.
   */
  register<TArgs>(tool: ToolDefinition<TArgs>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as ToolDefinition<unknown>);
  }

  /**
   * Look up a tool by name.
   *
   * Details: returns undefined when the tool is not registered.
   *
   * Side effects: none.
   * Error behavior: none.
   *
   * @param name - Tool name to look up.
   * @returns The tool definition if registered.
   */
  get(name: string): ToolDefinition<unknown> | undefined {
    return this.tools.get(name);
  }

  /**
   * Check whether a tool name is allowlisted.
   *
   * Details: returns true only for registered tool names.
   *
   * Side effects: none.
   * Error behavior: none.
   *
   * @param name - Tool name to check.
   * @returns True when the tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List registered tool names.
   *
   * Details: order matches Map insertion order.
   *
   * Side effects: none.
   * Error behavior: none.
   *
   * @returns Tool names in registration order.
   */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Build OpenAI-compatible tool specifications.
   *
   * Details: converts each Zod schema into JSON Schema using the local
   * $refStrategy to avoid provider issues.
   *
   * Side effects: none.
   * Error behavior: none.
   *
   * @returns Tool specs for all registered tools.
   */
  listOpenAIToolSpecs(): OpenAIToolSpec[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toJsonSchema(tool.schema as z.ZodTypeAny, {
          $refStrategy: 'none',
        }),
      },
    }));
  }

  /**
   * Validate a tool call payload.
   *
   * Details: enforces allowlist membership, argument size limits, and schema
   * validation.
   *
   * Side effects: none.
   * Error behavior: returns a failure result with a human-readable message.
   *
   * @param call - Tool call payload with name and arguments.
   * @returns Validation result with validated arguments on success.
   */
  validateToolCall<TArgs = unknown>(call: {
    name: string;
    args: unknown;
  }): ToolValidationResult<TArgs> {
    const { name, args } = call;

    // 1. Allowlist check
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: "${name}". Allowed tools: ${this.listNames().join(', ') || 'none'}`,
      };
    }

    // 2. Args size limit check
    const argsJson = JSON.stringify(args);
    if (argsJson.length > MAX_ARGS_SIZE) {
      return {
        success: false,
        error: `Tool arguments exceed maximum size (${argsJson.length} > ${MAX_ARGS_SIZE} bytes)`,
      };
    }

    // 3. Schema validation
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
   * Execute a tool call after validation.
   *
   * Details: validates name, argument size, and schema before execution.
   *
   * Side effects: executes tool code and any downstream effects it performs.
   * Error behavior: returns a failure result when validation or execution fails.
   *
   * @param call - Tool call payload with name and arguments.
   * @param ctx - Execution context passed to the tool.
   * @returns Success or failure result with tool output or error message.
   */
  async executeValidated<TArgs = unknown>(
    call: { name: string; args: unknown },
    ctx: ToolExecutionContext,
  ): Promise<{ success: true; result: unknown } | { success: false; error: string }> {
    const validation = this.validateToolCall<TArgs>(call);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const tool = this.tools.get(call.name)!;
    try {
      const result = await tool.execute(validation.args, ctx);
      return { success: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Tool execution failed: ${message}` };
    }
  }
}

/**
 * Provide the shared tool registry instance.
 *
 * Details: tools are expected to register during startup before runtime calls.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export const globalToolRegistry = new ToolRegistry();

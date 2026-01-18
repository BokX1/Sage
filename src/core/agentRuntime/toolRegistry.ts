import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Maximum JSON string length for tool arguments (10KB) */
const MAX_ARGS_SIZE = 10 * 1024;

/** Context passed to tool execution */
export interface ToolExecutionContext {
  traceId: string;
  userId: string;
  channelId: string;
}

/** Definition of a tool with typed arguments */
export interface ToolDefinition<TArgs = unknown> {
  /** Unique tool name (must match allowlist) */
  name: string;
  /** Human-readable description for LLM */
  description: string;
  /** Zod schema for argument validation */
  schema: z.ZodType<TArgs>;
  /** Execute the tool with validated arguments */
  execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<unknown>;
}

/** Validation result for a tool call */
export type ToolValidationResult<TArgs = unknown> =
  | { success: true; args: TArgs }
  | { success: false; error: string };

/** OpenAI-compatible tool specification */
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
 * Tool registry with strict validation.
 * Enforces: allowlist (only registered tools), schema validation, args size limits.
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition<unknown>> = new Map();

  /**
   * Register a tool. Throws if name already registered.
   */
  register<TArgs>(tool: ToolDefinition<TArgs>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as ToolDefinition<unknown>);
  }

  /**
   * Get a tool by name. Returns undefined if not found.
   */
  get(name: string): ToolDefinition<unknown> | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered (allowlist check).
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tool names.
   */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Generate OpenAI-compatible tool specifications for all registered tools.
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
   * Validate a tool call.
   * Checks: allowlist, args size, schema validation.
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
   * Execute a tool with validation.
   * Returns the tool result or throws on validation/execution error.
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
 * Global tool registry instance.
 * Tools should be registered at startup.
 */
export const globalToolRegistry = new ToolRegistry();

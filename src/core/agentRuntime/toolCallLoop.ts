import { LLMChatMessage, LLMClient } from '../llm/types';
import { ToolRegistry, ToolExecutionContext } from './toolRegistry';
import { logger } from '../utils/logger';

/**
 * Define the JSON envelope for provider-agnostic tool calls.
 *
 * Details: tools are requested by name with JSON arguments; the runtime validates
 * and executes them before continuing the conversation.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ToolCallEnvelope {
  type: 'tool_calls';
  calls: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

/**
 * Capture the outcome of a tool execution attempt.
 *
 * Details: successful calls include a result payload; failures include an error
 * message suitable for LLM consumption.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ToolResult {
  name: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Configure the tool call loop limits.
 *
 * Details: caps the number of tool rounds and calls per round, and enforces a
 * timeout for each tool execution.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ToolCallLoopConfig {
  /** Maximum number of tool rounds (default: 2). */
  maxRounds?: number;
  /** Maximum tool calls per round (default: 3). */
  maxCallsPerRound?: number;
  /** Tool execution timeout in ms (default: 10000). */
  toolTimeoutMs?: number;
}

const DEFAULT_CONFIG: Required<ToolCallLoopConfig> = {
  maxRounds: 2,
  maxCallsPerRound: 3,
  toolTimeoutMs: 10_000,
};

/**
 * Provide the retry prompt for invalid tool-call JSON.
 *
 * Details: instructs the LLM to return only a tool envelope or a plain text
 * answer when tools are not needed.
 *
 * Side effects: none.
 * Error behavior: none.
 */
const RETRY_PROMPT = `Your previous response was not valid JSON. Output ONLY valid JSON matching the exact schema:
{
  "type": "tool_calls",
  "calls": [{ "name": "<tool_name>", "args": { ... } }]
}
OR respond with a plain text answer if you don't need to use tools.`;

/**
 * Strip markdown code fences from an LLM response.
 *
 * Details: unwraps ``` or ```json blocks so JSON parsing can proceed.
 *
 * Side effects: none.
 * Error behavior: none.
 */
function stripCodeFences(text: string): string {
  const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const match = text.trim().match(fencePattern);
  return match ? match[1].trim() : text.trim();
}

/**
 * Check whether text plausibly contains JSON.
 *
 * Details: used to decide whether to trigger a deterministic retry prompt.
 *
 * Side effects: none.
 * Error behavior: none.
 */
function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    (trimmed.includes('"type"') || trimmed.includes('"name"') || trimmed.includes('"calls"'))
  );
}

/**
 * Parse a tool call envelope from an LLM response.
 *
 * Details: validates the expected shape before returning the parsed envelope.
 *
 * Side effects: none.
 * Error behavior: returns null on parse or validation failure.
 */
function parseToolCallEnvelope(text: string): ToolCallEnvelope | null {
  try {
    const stripped = stripCodeFences(text);
    const parsed = JSON.parse(stripped);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      parsed.type === 'tool_calls' &&
      Array.isArray(parsed.calls)
    ) {
      const validCalls = parsed.calls.every(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as { name?: unknown }).name === 'string' &&
          typeof (c as { args?: unknown }).args === 'object',
      );
      if (validCalls) {
        return parsed as ToolCallEnvelope;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Execute a tool with a timeout guard.
 *
 * Details: races the tool execution against a timeout to prevent stalled calls.
 *
 * Side effects: executes tool code and any downstream effects it performs.
 * Error behavior: returns a failure result on timeout or tool errors.
 */
async function executeToolWithTimeout(
  registry: ToolRegistry,
  call: { name: string; args: unknown },
  ctx: ToolExecutionContext,
  timeoutMs: number,
): Promise<ToolResult> {
  const timeoutPromise = new Promise<ToolResult>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Tool "${call.name}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  const executionPromise = registry.executeValidated(call, ctx).then((result) => ({
    name: call.name,
    success: result.success,
    result: result.success ? result.result : undefined,
    error: result.success ? undefined : result.error,
  }));

  try {
    return await Promise.race([executionPromise, timeoutPromise]);
  } catch (err) {
    return {
      name: call.name,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Format tool results as an LLM user message.
 *
 * Details: uses a user-role message for compatibility with providers that
 * mishandle tool-role messages.
 *
 * Side effects: none.
 * Error behavior: none.
 */
function formatToolResultsMessage(results: ToolResult[]): LLMChatMessage {
  const content = results
    .map((r) => {
      if (r.success) {
        return `Tool "${r.name}" result: ${JSON.stringify(r.result)}`;
      }
      return `Tool "${r.name}" error: ${r.error}`;
    })
    .join('\n');

  return {
    role: 'user',
    content: `[Tool Results]\n${content}`,
  };
}

/**
 * Define inputs to the tool call loop.
 *
 * Details: includes the LLM client, seed messages, and tool execution context.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ToolCallLoopParams {
  /** LLM client to use. */
  client: LLMClient;
  /** Initial messages (system + context). */
  messages: LLMChatMessage[];
  /** Tool registry with registered tools. */
  registry: ToolRegistry;
  /** Execution context for tools. */
  ctx: ToolExecutionContext;
  /** LLM model to use (optional). */
  model?: string;
  /** Configuration overrides. */
  config?: ToolCallLoopConfig;
}

/**
 * Describe the tool call loop outcome.
 *
 * Details: includes the final reply text and any tool results produced.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ToolCallLoopResult {
  /** Final reply text from the LLM. */
  replyText: string;
  /** Whether tools were executed. */
  toolsExecuted: boolean;
  /** Number of tool rounds completed. */
  roundsCompleted: number;
  /** All tool results from all rounds. */
  toolResults: ToolResult[];
}

/**
 * Run the tool call loop.
 *
 * Details: requests tool envelopes from the LLM, executes tools, and continues
 * until a final response or round limit is reached.
 *
 * Side effects: triggers LLM calls and executes registered tools.
 * Error behavior: returns a final response even when tool parsing fails by
 * treating the LLM output as a plain reply.
 *
 * @param params - Tool loop inputs including client, messages, and registry.
 * @returns Final reply text and tool execution details.
 */
export async function runToolCallLoop(params: ToolCallLoopParams): Promise<ToolCallLoopResult> {
  const { client, registry, ctx, model } = params;
  const config = { ...DEFAULT_CONFIG, ...params.config };

  const messages = [...params.messages];
  let roundsCompleted = 0;
  const allToolResults: ToolResult[] = [];
  let retryAttempted = false;

  while (roundsCompleted < config.maxRounds) {
    const response = await client.chat({
      messages,
      model,
      temperature: 0.7,
    });

    const responseText = response.content;

    let envelope = parseToolCallEnvelope(responseText);

    if (!envelope && !retryAttempted && looksLikeJson(responseText)) {
      retryAttempted = true;
      logger.debug(
        { responseText: responseText.slice(0, 200) },
        'JSON parse failed, attempting retry',
      );

      messages.push({ role: 'assistant', content: responseText });
      messages.push({ role: 'user', content: RETRY_PROMPT });

      const retryResponse = await client.chat({
        messages,
        model,
        temperature: 0,
      });

      envelope = parseToolCallEnvelope(retryResponse.content);

      if (!envelope) {
        return {
          replyText: retryResponse.content,
          toolsExecuted: false,
          roundsCompleted,
          toolResults: allToolResults,
        };
      }
    }

    if (!envelope) {
      return {
        replyText: responseText,
        toolsExecuted: allToolResults.length > 0,
        roundsCompleted,
        toolResults: allToolResults,
      };
    }

    // Cap calls per round to avoid unbounded tool execution from oversized envelopes.
    const calls = envelope.calls.slice(0, config.maxCallsPerRound);
    if (envelope.calls.length > config.maxCallsPerRound) {
      logger.warn(
        { requested: envelope.calls.length, limit: config.maxCallsPerRound },
        'Truncating tool calls to limit',
      );
    }

    const roundResults: ToolResult[] = [];
    for (const call of calls) {
      const result = await executeToolWithTimeout(registry, call, ctx, config.toolTimeoutMs);
      roundResults.push(result);
    }

    allToolResults.push(...roundResults);
    roundsCompleted++;

    messages.push({ role: 'assistant', content: responseText });
    messages.push(formatToolResultsMessage(roundResults));
  }

  const finalResponse = await client.chat({
    messages,
    model,
    temperature: 0.7,
  });

  return {
    replyText: finalResponse.content,
    toolsExecuted: allToolResults.length > 0,
    roundsCompleted,
    toolResults: allToolResults,
  };
}

import { LLMChatMessage, LLMClient } from '../llm/types';
import { ToolRegistry, ToolExecutionContext } from './toolRegistry';
import { logger } from '../utils/logger';
import { executeToolWithTimeout, ToolResult } from './toolCallExecution';
import { looksLikeJson, parseToolCallEnvelope, RETRY_PROMPT } from './toolCallParser';

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
  /** Optional API Key (BYOP). */
  apiKey?: string;
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
  const { client, registry, ctx, model, apiKey } = params;
  const config = { ...DEFAULT_CONFIG, ...params.config };

  const messages = [...params.messages];
  let roundsCompleted = 0;
  const allToolResults: ToolResult[] = [];
  let retryAttempted = false;

  while (roundsCompleted < config.maxRounds) {
    const response = await client.chat({
      messages,
      model,
      apiKey,
      temperature: 0.7,
    });

    const responseText = response.content;

    let envelope = parseToolCallEnvelope(responseText);

    if (!envelope && !retryAttempted && looksLikeJson(responseText)) {
      retryAttempted = true;
      logger.debug(
        { responseLength: responseText.length },
        'JSON parse failed, attempting retry',
      );

      messages.push({ role: 'assistant', content: responseText });
      messages.push({ role: 'user', content: RETRY_PROMPT });

      const retryResponse = await client.chat({
        messages,
        model,
        apiKey,
        temperature: 0,
      });

      envelope = parseToolCallEnvelope(retryResponse.content);

      if (!envelope) {
        logger.warn(
          { traceId: ctx.traceId, responseLength: retryResponse.content.length },
          'Retry tool call envelope parsing failed, returning response',
        );
        return {
          replyText: retryResponse.content,
          toolsExecuted: false,
          roundsCompleted,
          toolResults: allToolResults,
        };
      }
    }

    if (!envelope) {
      if (looksLikeJson(responseText)) {
        logger.warn(
          { traceId: ctx.traceId, responseLength: responseText.length },
          'Tool call envelope parsing failed, returning response',
        );
      }
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
    apiKey,
    temperature: 0.7,
  });

  return {
    replyText: finalResponse.content,
    toolsExecuted: allToolResults.length > 0,
    roundsCompleted,
    toolResults: allToolResults,
  };
}

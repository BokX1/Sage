/** Run iterative model-tool-model loops until a final natural-language response is produced. */
import { LLMChatMessage, LLMClient } from '../llm/types';
import { ToolRegistry, ToolExecutionContext } from './toolRegistry';
import { logger } from '../utils/logger';
import { executeToolWithTimeout, ToolResult } from './toolCallExecution';
import { looksLikeJson, parseToolCallEnvelope, RETRY_PROMPT } from './toolCallParser';


/** Configure loop bounds and tool timeout behavior. */
export interface ToolCallLoopConfig {

  maxRounds?: number;

  maxCallsPerRound?: number;

  toolTimeoutMs?: number;
}

const DEFAULT_CONFIG: Required<ToolCallLoopConfig> = {
  maxRounds: 2,
  maxCallsPerRound: 3,
  toolTimeoutMs: 10_000,
};



type ToolErrorType = 'timeout' | 'not_found' | 'rate_limited' | 'validation' | 'unknown';


function classifyErrorType(error: string): ToolErrorType {
  const lowerError = error.toLowerCase();
  if (lowerError.includes('timeout') || lowerError.includes('timed out')) return 'timeout';
  if (lowerError.includes('not found') || lowerError.includes('404')) return 'not_found';
  if (lowerError.includes('rate limit') || lowerError.includes('429') || lowerError.includes('too many')) return 'rate_limited';
  if (lowerError.includes('validation') || lowerError.includes('invalid')) return 'validation';
  return 'unknown';
}


function getRecoverySuggestion(errorType: ToolErrorType, toolName: string): string {
  switch (errorType) {
    case 'timeout':
      return `The ${toolName} tool timed out. You may try again with a simpler query, or explain to the user that this operation is taking longer than expected.`;
    case 'not_found':
      return `The ${toolName} tool could not find the requested information. Try a different search query or let the user know the information is not available.`;
    case 'rate_limited':
      return `The ${toolName} tool hit a rate limit. Wait before retrying or use cached/known information instead.`;
    case 'validation':
      return `The ${toolName} tool received invalid parameters. Check your input format and try again with corrected parameters.`;
    case 'unknown':
      return `The ${toolName} tool encountered an error. You can try again, use a different approach, or explain the limitation to the user.`;
  }
}


function formatToolResultsMessage(results: ToolResult[]): LLMChatMessage {
  const successResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  const parts: string[] = [];


  if (successResults.length > 0) {
    const successTexts = successResults.map(r =>
      `✅ Tool "${r.name}" succeeded: ${JSON.stringify(r.result)}`
    );
    parts.push(successTexts.join('\n'));
  }


  if (failedResults.length > 0) {
    const failedTexts = failedResults.map(r => {
      const errorType = classifyErrorType(r.error || 'unknown');
      const suggestion = getRecoverySuggestion(errorType, r.name);
      return `❌ Tool "${r.name}" failed (${errorType}): ${r.error}\n   💡 Suggestion: ${suggestion}`;
    });
    parts.push(failedTexts.join('\n'));
  }

  return {
    role: 'user',
    content: `[Tool Results]\n${parts.join('\n\n')}`,
  };
}


/** Provide dependencies and request context for one tool-call loop run. */
export interface ToolCallLoopParams {

  client: LLMClient;

  messages: LLMChatMessage[];

  registry: ToolRegistry;

  ctx: ToolExecutionContext;

  model?: string;

  apiKey?: string;

  config?: ToolCallLoopConfig;
}


/** Return final response and execution telemetry for the tool loop. */
export interface ToolCallLoopResult {

  replyText: string;

  toolsExecuted: boolean;

  roundsCompleted: number;

  toolResults: ToolResult[];
}


/**
 * Execute iterative tool-call rounds until model output no longer requests tools.
 *
 * @param params - Client, messages, registry, and optional loop overrides.
 * @returns Final assistant text plus tool execution metadata.
 *
 * Side effects:
 * - Calls the LLM multiple times and executes registered tools.
 *
 * Error behavior:
 * - Invalid JSON envelopes trigger one retry prompt before falling back.
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

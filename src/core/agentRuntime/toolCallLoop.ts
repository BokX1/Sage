import { LLMChatMessage, LLMClient } from '../llm/llm-types';
import { ToolRegistry, ToolExecutionContext } from './toolRegistry';
import { logger } from '../utils/logger';
import { executeToolWithTimeout, ToolResult } from './toolCallExecution';
import { looksLikeJson, parseToolCallEnvelope, RETRY_PROMPT } from './toolCallParser';
import { evaluateToolPolicy, ToolPolicyConfig } from './toolPolicy';
import { ToolResultCache } from './toolCache';
import { limitConcurrency } from '../utils/concurrency';


/** Configure loop bounds and tool timeout behavior. */
export interface ToolCallLoopConfig {

  maxRounds?: number;

  maxCallsPerRound?: number;

  toolTimeoutMs?: number;

  cacheEnabled?: boolean;

  cacheMaxEntries?: number;

  parallelReadOnlyTools?: boolean;

  maxParallelReadOnlyTools?: number;

  maxToolResultChars?: number;
}

const DEFAULT_CONFIG: Required<ToolCallLoopConfig> = {
  maxRounds: 2,
  maxCallsPerRound: 3,
  toolTimeoutMs: 45_000,
  cacheEnabled: true,
  cacheMaxEntries: 50,
  parallelReadOnlyTools: true,
  maxParallelReadOnlyTools: 3,
  maxToolResultChars: 4_000,
};



type ToolErrorType = 'timeout' | 'not_found' | 'rate_limited' | 'validation' | 'unknown';

function assertPositiveInteger(value: number, field: keyof Required<ToolCallLoopConfig>): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}

function getValidatedConfig(config: Required<ToolCallLoopConfig>): Required<ToolCallLoopConfig> {
  assertPositiveInteger(config.maxRounds, 'maxRounds');
  assertPositiveInteger(config.maxCallsPerRound, 'maxCallsPerRound');
  assertPositiveInteger(config.toolTimeoutMs, 'toolTimeoutMs');
  assertPositiveInteger(config.cacheMaxEntries, 'cacheMaxEntries');
  assertPositiveInteger(config.maxParallelReadOnlyTools, 'maxParallelReadOnlyTools');
  assertPositiveInteger(config.maxToolResultChars, 'maxToolResultChars');
  return config;
}


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


function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const headChars = Math.max(300, Math.floor(maxChars * 0.65));
  const tailChars = Math.max(120, Math.floor(maxChars * 0.25));
  const omittedChars = Math.max(0, value.length - headChars - tailChars);
  return (
    `${value.slice(0, headChars).trimEnd()}\n` +
    `[... ${omittedChars.toLocaleString()} chars omitted ...]\n` +
    `${value.slice(-tailChars).trimStart()}`
  );
}

function stringifyResult(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable tool result]';
  }
}

function formatToolResultsMessage(results: ToolResult[], maxToolResultChars: number): LLMChatMessage {
  const successResults = results.filter((r) => r.success);
  const failedResults = results.filter((r) => !r.success);

  const parts: string[] = [];


  if (successResults.length > 0) {
    const successTexts = successResults.map((r) => {
      const serialized = stringifyResult(r.result);
      return `[OK] Tool "${r.name}" succeeded: ${truncateText(serialized, maxToolResultChars)}`;
    });
    parts.push(successTexts.join('\n'));
  }


  if (failedResults.length > 0) {
    const failedTexts = failedResults.map((r) => {
      const errorType = classifyErrorType(r.error || 'unknown');
      const suggestion = getRecoverySuggestion(errorType, r.name);
      const errorText = truncateText(r.error ?? 'Unknown tool error', Math.max(240, Math.floor(maxToolResultChars / 2)));
      return `[ERROR] Tool "${r.name}" failed (${errorType}): ${errorText}\nSuggestion: ${suggestion}`;
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

  temperature?: number;

  timeoutMs?: number;

  maxTokens?: number;

  /**
   * Optional pre-fetched assistant response content to consume as the first
   * loop turn. Useful when the caller already received a tool envelope.
   */
  initialAssistantResponseText?: string;

  config?: ToolCallLoopConfig;

  toolPolicy?: ToolPolicyConfig;
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
  const config = getValidatedConfig({ ...DEFAULT_CONFIG, ...params.config });
  const loopTemperature = Number.isFinite(params.temperature) ? Math.max(0, params.temperature as number) : 0.7;
  const openAiToolSpecs = registry.listOpenAIToolSpecs();
  const toolSpecs = openAiToolSpecs.length > 0
    ? openAiToolSpecs.map((tool) => ({
      type: tool.type,
      function: {
        ...tool.function,
        parameters: tool.function.parameters as Record<string, unknown>,
      },
    }))
    : undefined;

  const messages = [...params.messages];
  const cache = config.cacheEnabled ? new ToolResultCache(config.cacheMaxEntries) : null;
  let roundsCompleted = 0;
  const allToolResults: ToolResult[] = [];
  let retryAttempted = false;
  let seededResponseText = params.initialAssistantResponseText;

  while (roundsCompleted < config.maxRounds) {
    const responseText =
      typeof seededResponseText === 'string'
        ? seededResponseText
        : (
            await client.chat({
              messages,
              model,
              apiKey,
              temperature: loopTemperature,
              timeout: params.timeoutMs,
              maxTokens: params.maxTokens,
              tools: toolSpecs,
              toolChoice: toolSpecs ? 'auto' : undefined,
            })
          ).content;
    seededResponseText = undefined;

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
        temperature: loopTemperature,
        timeout: params.timeoutMs,
        maxTokens: params.maxTokens,
        tools: toolSpecs,
        toolChoice: toolSpecs ? 'auto' : undefined,
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

    type PendingCall = {
      index: number;
      call: (typeof calls)[number];
    };

    const roundResultsByIndex: Array<ToolResult | null> = new Array(calls.length).fill(null);
    const readOnlyPending: PendingCall[] = [];
    const sideEffectPending: PendingCall[] = [];

    const executePendingCall = async (pending: PendingCall): Promise<void> => {
      const result = await executeToolWithTimeout(registry, pending.call, ctx, config.toolTimeoutMs);
      roundResultsByIndex[pending.index] = result;
      if (result.success && cache) {
        cache.set(pending.call.name, pending.call.args, result.result);
      }
    };

    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const cached = cache?.get(call.name, call.args) ?? null;
      if (cached) {
        roundResultsByIndex[index] = {
          name: call.name,
          success: true,
          result: cached.result,
          latencyMs: 0,
        };
        continue;
      }

      const policyDecision = evaluateToolPolicy(call.name, params.toolPolicy);
      if (!policyDecision.allow) {
        logger.warn(
          {
            traceId: ctx.traceId,
            toolName: call.name,
            risk: policyDecision.risk,
            reason: policyDecision.reason,
          },
          'Tool call denied by policy',
        );
        roundResultsByIndex[index] = {
          name: call.name,
          success: false,
          error: policyDecision.reason ?? `Tool "${call.name}" denied by policy`,
          errorType: 'validation',
          latencyMs: 0,
        };
        continue;
      }

      if (config.parallelReadOnlyTools && policyDecision.risk === 'read_only') {
        readOnlyPending.push({ index, call });
      } else {
        sideEffectPending.push({ index, call });
      }
    }

    if (readOnlyPending.length > 0) {
      if (config.parallelReadOnlyTools && readOnlyPending.length > 1) {
        const runWithLimit = limitConcurrency(config.maxParallelReadOnlyTools);
        await Promise.all(readOnlyPending.map((pending) => runWithLimit(() => executePendingCall(pending))));
      } else {
        for (const pending of readOnlyPending) {
          await executePendingCall(pending);
        }
      }
    }

    for (const pending of sideEffectPending) {
      await executePendingCall(pending);
    }

    const roundResults = roundResultsByIndex.filter((result): result is ToolResult => result !== null);
    allToolResults.push(...roundResults);
    roundsCompleted++;

    messages.push({ role: 'assistant', content: responseText });
    messages.push(formatToolResultsMessage(roundResults, config.maxToolResultChars));
  }

  const finalResponse = await client.chat({
    messages,
    model,
    apiKey,
    temperature: loopTemperature,
    timeout: params.timeoutMs,
    maxTokens: params.maxTokens,
    tools: toolSpecs,
    toolChoice: toolSpecs ? 'auto' : undefined,
  });

  return {
    replyText: finalResponse.content,
    toolsExecuted: allToolResults.length > 0,
    roundsCompleted,
    toolResults: allToolResults,
  };
}

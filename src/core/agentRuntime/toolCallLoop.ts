import { LLMChatMessage, LLMClient } from '../llm/llm-types';
import { ToolRegistry, ToolExecutionContext } from './toolRegistry';
import { logger } from '../utils/logger';
import { executeToolWithTimeout, ToolResult } from './toolCallExecution';
import { looksLikeJson, parseToolCallEnvelope, RETRY_PROMPT } from './toolCallParser';
import { buildToolCacheKey, ToolResultCache } from './toolCache';
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


function getRecoverySuggestion(errorType: ToolErrorType): string {
  switch (errorType) {
    case 'timeout':
      return 'The tool timed out. Try again with a simpler query, or explain that the operation is taking longer than expected.';
    case 'not_found':
      return 'The tool could not find the requested information. Try a different query or explain that the information is not available.';
    case 'rate_limited':
      return 'The tool hit a rate limit. Wait before retrying or use cached or known information instead.';
    case 'validation':
      return 'The tool received invalid parameters. Check input format and retry with corrected parameters.';
    case 'unknown':
      return 'The tool encountered an error. Try again, use a different approach, or explain the limitation to the user.';
  }
}

function getToolSpecificRecoverySuggestion(
  toolName: string,
  errorType: ToolErrorType,
  errorText: string,
): string {
  const lowerToolName = toolName.trim().toLowerCase();
  const lowerErrorText = errorText.toLowerCase();
  const isGitHubFileLookup = lowerToolName === 'github_get_file';
  const isNotFound =
    errorType === 'not_found' ||
    lowerErrorText.includes('404') ||
    lowerErrorText.includes('not found');

  if (isGitHubFileLookup && isNotFound) {
    return 'GitHub file lookup failed. Use github_search_code (or github_get_repository) to find candidate paths/branch details, then retry github_get_file with exact path/ref and line ranges when needed. If still missing, ask the user for exact repo/path/ref.';
  }

  return getRecoverySuggestion(errorType);
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
    return JSON.stringify(sanitizeToolResultForModel(value));
  } catch {
    return '[unserializable tool result]';
  }
}

const SENSITIVE_TOOL_KEY_PATTERN = /(?:authorization|api[_-]?key|token|secret|password|cookie|session)/i;

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
      out[key] = SENSITIVE_TOOL_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : sanitizeToolResultForModel(entry, depth + 1);
    }
    return out;
  }
  return String(value);
}

function escapeXmlContent(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatToolNameLabel(name: string): string {
  return JSON.stringify(name);
}

function formatUntrustedExternalDataBlock(source: string, payload: string): string {
  const escapedSource = escapeXmlContent(source);
  const escapedPayload = escapeXmlContent(payload);
  return `<untrusted_external_data source="${escapedSource}" trust_level="low">\n${escapedPayload}\n</untrusted_external_data>`;
}

function formatToolResultsMessage(results: ToolResult[], maxToolResultChars: number): LLMChatMessage {
  const successResults = results.filter((r) => r.success);
  const failedResults = results.filter((r) => !r.success);

  const parts: string[] = [];


  if (successResults.length > 0) {
    const successTexts = successResults.map((r) => {
      const serialized = stringifyResult(r.result);
      const truncated = truncateText(serialized, maxToolResultChars);
      const toolLabel = formatToolNameLabel(r.name);
      return `[OK] Tool ${toolLabel} succeeded:\n${formatUntrustedExternalDataBlock(r.name, truncated)}`;
    });
    parts.push(successTexts.join('\n'));
  }


  if (failedResults.length > 0) {
    const failedTexts = failedResults.map((r) => {
      const errorType = classifyErrorType(r.error || 'unknown');
      const errorText = truncateText(r.error ?? 'Unknown tool error', Math.max(240, Math.floor(maxToolResultChars / 2)));
      const suggestion = getToolSpecificRecoverySuggestion(r.name, errorType, errorText);
      const toolLabel = formatToolNameLabel(r.name);
      return `[ERROR] Tool ${toolLabel} failed (${errorType}):\n${formatUntrustedExternalDataBlock(r.name, errorText)}\nSuggestion: ${suggestion}`;
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
}

/** Return final response and execution telemetry for the tool loop. */
export interface ToolCallLoopResult {

  replyText: string;

  toolsExecuted: boolean;

  roundsCompleted: number;

  toolResults: ToolResult[];

  deduplicatedCallCount?: number;

  truncatedCallCount?: number;
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
  let deduplicatedCallCount = 0;
  let truncatedCallCount = 0;
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
          deduplicatedCallCount,
          truncatedCallCount,
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
        deduplicatedCallCount,
        truncatedCallCount,
      };
    }


    const requestedCalls = envelope.calls;
    const calls = requestedCalls.slice(0, config.maxCallsPerRound);
    if (requestedCalls.length > config.maxCallsPerRound) {
      logger.warn(
        { requested: requestedCalls.length, limit: config.maxCallsPerRound },
        'Truncating tool calls to limit',
      );
      truncatedCallCount += requestedCalls.length - config.maxCallsPerRound;
    }

    type PendingCall = {
      index: number;
      call: (typeof calls)[number];
    };

    const roundResultsByIndex: Array<ToolResult | null> = new Array(calls.length).fill(null);
    const readOnlyPending: PendingCall[] = [];
    const sideEffectPending: PendingCall[] = [];
    const dedupePrimaryIndexByKey = new Map<string, number>();
    const dedupeFollowerIndexesByKey = new Map<string, number[]>();

    const isReadOnlyToolCall = (call: { name: string; args: unknown }): boolean => {
      const tool = registry.get(call.name);
      const metadata = tool?.metadata;
      if (!metadata) return false;

      if (typeof metadata.readOnlyPredicate === 'function') {
        try {
          return metadata.readOnlyPredicate(call.args, ctx) === true;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          logger.warn(
            { traceId: ctx.traceId, toolName: call.name, errorMessage },
            'Read-only predicate threw; treating tool call as side-effecting',
          );
          return false;
        }
      }

      return metadata.readOnly === true;
    };

    const executePendingCall = async (pending: PendingCall): Promise<void> => {
      const readOnly = isReadOnlyToolCall(pending.call);

      const runOnce = () =>
        executeToolWithTimeout(registry, pending.call, ctx, config.toolTimeoutMs);

      let result = await runOnce();

      if (!result.success && readOnly && !ctx.signal?.aborted) {
        const errorText = result.error ?? '';
        const classified = classifyErrorType(errorText);
        const retryable = result.errorType !== 'validation' && (classified === 'timeout' || classified === 'rate_limited');

        if (retryable) {
          const delayMs = classified === 'rate_limited' ? 250 : 0;
          logger.warn(
            { traceId: ctx.traceId, toolName: pending.call.name, errorType: classified, delayMs },
            'Retrying read-only tool call once',
          );
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          result = await runOnce();
        }
      }

      roundResultsByIndex[pending.index] = result;
      if (result.success && cache) {
        cache.set(pending.call.name, pending.call.args, result.result);
      }
      const dedupeKey = buildToolCacheKey(pending.call.name, pending.call.args);
      const followerIndexes = dedupeFollowerIndexesByKey.get(dedupeKey) ?? [];
      for (const followerIndex of followerIndexes) {
        roundResultsByIndex[followerIndex] = {
          ...result,
          latencyMs: 0,
        };
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

      const dedupeEligible = isReadOnlyToolCall(call);
      if (dedupeEligible) {
        const dedupeKey = buildToolCacheKey(call.name, call.args);
        const primaryIndex = dedupePrimaryIndexByKey.get(dedupeKey);
        if (primaryIndex !== undefined) {
          const followers = dedupeFollowerIndexesByKey.get(dedupeKey) ?? [];
          followers.push(index);
          dedupeFollowerIndexesByKey.set(dedupeKey, followers);
          deduplicatedCallCount += 1;
          continue;
        }
        dedupePrimaryIndexByKey.set(dedupeKey, index);
      }

      if (
        config.parallelReadOnlyTools &&
        dedupeEligible
      ) {
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
  let finalReplyText = finalResponse.content;
  if (parseToolCallEnvelope(finalReplyText)) {
    logger.warn(
      { traceId: ctx.traceId, roundsCompleted, maxRounds: config.maxRounds },
      'Tool loop reached round limit with another tool envelope; forcing a plain-text finalization pass',
    );
    try {
      const plainTextFinalization = await client.chat({
        messages: [
          ...messages,
          { role: 'assistant', content: finalReplyText },
          {
            role: 'system',
            content:
              'Tool-call rounds are exhausted. Do not call tools. ' +
              'Return one final plain-text answer grounded only in prior tool results and context.',
          },
        ],
        model,
        apiKey,
        temperature: Math.max(0, loopTemperature - 0.1),
        timeout: params.timeoutMs,
        maxTokens: params.maxTokens,
      });
      finalReplyText = plainTextFinalization.content;
    } catch (finalizationError) {
      logger.warn(
        { traceId: ctx.traceId, roundsCompleted, maxRounds: config.maxRounds, error: finalizationError },
        'Tool loop plain-text finalization pass failed; returning a safe fallback message',
      );
      finalReplyText =
        'I could not finalize a plain-text answer after tool execution. Please try again.';
    }
    if (parseToolCallEnvelope(finalReplyText)) {
      logger.warn(
        { traceId: ctx.traceId, roundsCompleted, maxRounds: config.maxRounds },
        'Tool loop plain-text finalization still returned an envelope; returning a safe fallback message',
      );
      finalReplyText =
        'I could not finalize a plain-text answer after tool execution. Please try again.';
    }
  }

  return {
    replyText: finalReplyText,
    toolsExecuted: allToolResults.length > 0,
    roundsCompleted,
    toolResults: allToolResults,
    deduplicatedCallCount,
    truncatedCallCount,
  };
}

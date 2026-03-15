import {
  LLMClient,
  LLMContentPart,
  LLMMessageContent,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  ToolDefinition,
} from './llm-types';
import { CircuitBreaker } from './circuit-breaker';
import { logger } from '../logging/logger';
import { metrics } from '../../shared/observability/metrics';
import { estimateMessagesTokens } from './context-budgeter';
import { sanitizeJsonSchemaForProvider } from '../../shared/validation/json-schema';
import { normalizeTimeoutMs } from '../../shared/utils/timeout';

interface AiProviderClientConfigInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface AiProviderClientConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxRetries: number;
}

interface CompatibleChatCompletionsPayload {
  model: string;
  messages: CompatibleChatMessage[];
  temperature: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
  tools?: ToolDefinition[];
  tool_choice?: string | object;
}

type CompatibleChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: LLMMessageContent;
  tool_calls?: CompatibleChatToolCall[];
  tool_call_id?: string;
};

type CompatibleChatToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type CompatibleChatResponseMessage = {
  content?: string;
  tool_calls?: CompatibleChatToolCall[];
};

const DEFAULT_TIMEOUT_MS = 180_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES = 5;
const JSON_ONLY_INSTRUCTION =
  ' IMPORTANT: You must output strictly valid JSON only. Do not wrap in markdown blocks. No other text.';

function resolveMaxRetries(rawMaxRetries: number | undefined): number {
  if (typeof rawMaxRetries !== 'number' || !Number.isFinite(rawMaxRetries)) {
    return DEFAULT_MAX_RETRIES;
  }

  const normalized = Math.floor(rawMaxRetries);
  if (normalized < 0) {
    return 0;
  }

  return Math.min(normalized, MAX_RETRIES);
}

function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    timeoutId.unref?.();

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || /aborted|aborterror/i.test(error.message);
  }
  return false;
}

function composeAbortSignal(parentSignal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!parentSignal) return timeoutSignal;
  if (parentSignal.aborted) return parentSignal;

  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', abort, { once: true });

  if (timeoutSignal.aborted) {
    controller.abort();
  }

  return controller.signal;
}

function extractSystemText(content: CompatibleChatMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      return '';
    })
    .filter((value) => value.length > 0)
    .join('\n');
}

function collapseSystemMessages(messages: CompatibleChatMessage[]): CompatibleChatMessage[] {
  const systemParts: string[] = [];
  const nonSystemMessages: CompatibleChatMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      const systemText = extractSystemText(message.content).trim();
      if (systemText.length > 0) {
        systemParts.push(systemText);
      }
      continue;
    }
    nonSystemMessages.push(message);
  }

  if (systemParts.length === 0) {
    return nonSystemMessages;
  }

  return [
    {
      role: 'system',
      content: systemParts.join('\n\n'),
    },
    ...nonSystemMessages,
  ];
}

function toContentParts(content: LLMMessageContent): LLMContentPart[] {
  if (Array.isArray(content)) {
    return content;
  }
  return [{ type: 'text', text: content }];
}

function mergeMessageContents(prev: LLMMessageContent, next: LLMMessageContent): LLMMessageContent {
  if (typeof prev === 'string' && typeof next === 'string') {
    return `${prev}\n\n${next}`;
  }

  const prevParts = toContentParts(prev);
  const nextParts = toContentParts(next);

  const merged: LLMContentPart[] = [];
  merged.push(...prevParts);
  merged.push({ type: 'text', text: '\n\n' });
  merged.push(...nextParts);
  return merged;
}

function serializeToolCallsForApi(toolCalls: LLMToolCall[] | undefined): CompatibleChatToolCall[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args ?? {}),
    },
  }));
}

function normalizeMessagesForApi(messages: LLMRequest['messages']): CompatibleChatMessage[] {
  const messagesWithSingleSystem = collapseSystemMessages(
    messages.map((message) => ({
      role: message.role,
      content: message.content,
      tool_calls: serializeToolCallsForApi(message.toolCalls),
      tool_call_id: message.toolCallId,
    })),
  );
  const normalizedMessages: CompatibleChatMessage[] = [];

  for (const message of messagesWithSingleSystem) {
    if (normalizedMessages.length === 0) {
      normalizedMessages.push(message);
      continue;
    }

    const previous = normalizedMessages[normalizedMessages.length - 1];
    const shouldMerge =
      previous.role === message.role &&
      previous.role !== 'tool' &&
      !previous.tool_calls?.length &&
      !message.tool_calls?.length &&
      !previous.tool_call_id &&
      !message.tool_call_id;

    if (shouldMerge) {
      previous.content = mergeMessageContents(previous.content, message.content);
    } else {
      normalizedMessages.push(message);
    }
  }

  let firstNonSystemIndex = -1;
  for (let index = 0; index < normalizedMessages.length; index += 1) {
    if (normalizedMessages[index].role !== 'system') {
      firstNonSystemIndex = index;
      break;
    }
  }

  if (firstNonSystemIndex !== -1) {
    const firstMessage = normalizedMessages[firstNonSystemIndex];
    if (firstMessage.role === 'assistant' || firstMessage.role === 'tool') {
      normalizedMessages.splice(firstNonSystemIndex, 0, {
        role: 'user',
        content: '(Consulting memory/context...)',
      });
    }
  }

  return normalizedMessages;
}

function assertSafeBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI provider base URL must use HTTP(S).');
  }
  return parsed.toString().replace(/\/$/, '');
}

function sanitizeToolDefinitionsForProvider(tools: ToolDefinition[] | undefined): ToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return tools;
  }

  return tools.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      parameters: sanitizeJsonSchemaForProvider(tool.function.parameters),
    },
  }));
}

export class AiProviderClient implements LLMClient {
  private config: AiProviderClientConfig;
  private breaker: CircuitBreaker;

  constructor(config: AiProviderClientConfigInput) {
    const normalizedBaseUrl = config.baseUrl?.trim();
    if (!normalizedBaseUrl) {
      throw new Error('AI provider base URL must be configured.');
    }
    const normalizedModel = config.model?.trim();
    if (!normalizedModel) {
      throw new Error('AI provider model must be configured.');
    }

    const baseUrl = assertSafeBaseUrl(normalizedBaseUrl);
    const timeoutMs = normalizeTimeoutMs(config.timeoutMs, {
      fallbackMs: DEFAULT_TIMEOUT_MS,
      minMs: MIN_TIMEOUT_MS,
      maxMs: MAX_TIMEOUT_MS,
    });
    const maxRetries = resolveMaxRetries(config.maxRetries);

    if (config.timeoutMs !== undefined && timeoutMs !== Math.floor(config.timeoutMs)) {
      logger.warn(
        { providedTimeoutMs: config.timeoutMs, appliedTimeoutMs: timeoutMs, minTimeoutMs: MIN_TIMEOUT_MS, maxTimeoutMs: MAX_TIMEOUT_MS },
        '[AiProviderClient] Invalid timeout override detected; using sanitized timeout',
      );
    }

    if (config.maxRetries !== undefined && maxRetries !== Math.floor(config.maxRetries)) {
      logger.warn(
        { providedMaxRetries: config.maxRetries, appliedMaxRetries: maxRetries, maxRetriesCap: MAX_RETRIES },
        '[AiProviderClient] Invalid maxRetries override detected; using sanitized retry count',
      );
    }

    this.config = {
      baseUrl,
      model: normalizedModel,
      apiKey: config.apiKey,
      timeoutMs,
      maxRetries,
    };
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 60000,
    });
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    return this.breaker.execute(() => this._chat(request));
  }

  private normalizeToolCalls(toolCalls: CompatibleChatToolCall[] | undefined): LLMToolCall[] | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return undefined;
    }

    return toolCalls.map((toolCall) => {
      const toolName = toolCall.function?.name?.trim() || 'unknown_tool';
      const rawArgs = toolCall.function?.arguments ?? '{}';
      try {
        const args = JSON.parse(rawArgs);
        return {
          id: typeof toolCall.id === 'string' && toolCall.id.trim().length > 0 ? toolCall.id.trim() : undefined,
          name: toolName,
          args,
        };
      } catch (error) {
        logger.error(
          {
            toolName,
            rawArgs: String(rawArgs).slice(0, 200),
            error: error instanceof Error ? error.message : String(error),
          },
          '[AiProviderClient] Malformed tool call arguments JSON',
        );
        throw new Error(`AI provider returned malformed JSON arguments for tool "${toolName}".`, {
          cause: error,
        });
      }
    });
  }

  private async _chat(request: LLMRequest): Promise<LLMResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const rawModel = request.model || this.config.model;
    const model = rawModel.trim();
    if (!model) {
      throw new Error('AI provider request model must be configured.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = request.apiKey || this.config.apiKey;
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const normalizedMessages = normalizeMessagesForApi(request.messages);
    logger.debug(
      {
        model,
        messageCount: request.messages.length,
        estimatedTokens: estimateMessagesTokens(request.messages),
      },
      '[Budget] Preflight only; message trimming disabled',
    );

    const payload: CompatibleChatCompletionsPayload = {
      model,
      messages: normalizedMessages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      response_format:
        request.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
      tools: sanitizeToolDefinitionsForProvider(request.tools),
      tool_choice: request.toolChoice,
    };

    logger.debug({ url, model, messageCount: request.messages.length }, '[AiProviderClient] Request');
    metrics.increment('llm_calls_total', { model, provider: 'ai_provider' });

    let attempt = 0;
    let lastError: Error | undefined;
    const maxAttempts = this.config.maxRetries + 1;
    let hasRetriedForJson = false;

    while (attempt < maxAttempts) {
      try {
        const controller = new AbortController();
        const timeout = normalizeTimeoutMs(request.timeout, {
          fallbackMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          minMs: MIN_TIMEOUT_MS,
          maxMs: MAX_TIMEOUT_MS,
        });
        const id = setTimeout(() => controller.abort(), timeout);
        id.unref?.();

        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: composeAbortSignal(request.signal, controller.signal),
          });
        } finally {
          clearTimeout(id);
        }

        if (!response.ok) {
          const text = await response.text();

          if (
            !hasRetriedForJson &&
            (response.status === 400 || response.status === 422) &&
            payload.response_format &&
            /response_format|json_object|unknown field|unsupported/i.test(text)
          ) {
            logger.warn(
              { status: response.status, error: text.slice(0, 100) },
              '[AiProviderClient] JSON mode rejected. Retrying with shim...',
            );

            hasRetriedForJson = true;
            delete payload.response_format;
            const systemMsg = payload.messages.find((message) => message.role === 'system');

            if (systemMsg) {
              if (
                typeof systemMsg.content === 'string' &&
                !systemMsg.content.includes(JSON_ONLY_INSTRUCTION.trim())
              ) {
                systemMsg.content += JSON_ONLY_INSTRUCTION;
              }
            } else {
              payload.messages.unshift({ role: 'system', content: JSON_ONLY_INSTRUCTION });
            }

            continue;
          }

          if (response.status === 400 && /model|validation/i.test(text)) {
            const err = new Error(`AI provider model error: ${text}`);
            logger.error(
              {
                status: response.status,
                model,
                error: text,
              },
              '[AiProviderClient] Invalid model - aborting retries',
            );
            throw err;
          }

          const err = new Error(
            `AI provider API error: ${response.status} ${response.statusText} - ${text.slice(0, 200)}`,
          );
          logger.warn(
            { status: response.status, error: err.message, timeout },
            '[AiProviderClient] API error',
          );
          throw err;
        }

        const data = (await response.json()) as {
          choices?: { message?: CompatibleChatResponseMessage }[];
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };
        const message = data.choices?.[0]?.message;
        const content = typeof message?.content === 'string' ? message.content : '';
        const toolCalls = this.normalizeToolCalls(message?.tool_calls);
        const reasoningText =
          toolCalls && toolCalls.length > 0 && content.trim().length > 0
            ? content.trim()
            : undefined;

        if (reasoningText) {
          logger.debug(
            { reasoningLength: reasoningText.length },
            '[AiProviderClient] Preserving model reasoning alongside native tool calls',
          );
        }

        if (toolCalls && toolCalls.length > 0) {
          logger.debug({ count: toolCalls.length }, '[AiProviderClient] Native tool calls detected');
        }
        logger.debug({ usage: data.usage }, '[AiProviderClient] Success');

        return {
          text: toolCalls && toolCalls.length > 0 ? '' : content,
          toolCalls,
          reasoningText,
          usage: data.usage
            ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
            : undefined,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (isAbortError(err) || request.signal?.aborted) {
          throw lastError;
        }

        if (lastError.message.includes('AI provider model error')) {
          throw lastError;
        }

        attempt += 1;

        if (attempt < maxAttempts) {
          metrics.increment('llm_failures_total', { model, type: 'retry' });
          logger.warn({ attempt, error: lastError.message }, '[AiProviderClient] Retry');
          await sleep(500 * Math.pow(2, attempt), request.signal);
        }
      }
    }

    metrics.increment('llm_failures_total', { model, type: 'exhausted' });
    logger.error({ error: lastError }, '[AiProviderClient] Failed after retries');
    throw lastError;
  }
}

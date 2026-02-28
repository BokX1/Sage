import { LLMClient, LLMRequest, LLMResponse, ToolDefinition } from './llm-types';
import { CircuitBreaker } from './circuit-breaker';
import { logger } from '../../core/utils/logger';
import { metrics } from '../../core/utils/metrics';
import { getModelBudgetConfig } from './model-budget-config';
import { planBudget, trimMessagesToBudget } from './context-budgeter';
import { sanitizeJsonSchemaForProvider } from '../utils/json-schema';
import { normalizeTimeoutMs } from '../utils/timeout';

interface PollinationsConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface PollinationsPayload {
  model: string;
  messages: LLMRequest['messages'];
  temperature: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
  tools?: ToolDefinition[];
  tool_choice?: string | object;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES = 5;
const JSON_ONLY_INSTRUCTION =
  ' IMPORTANT: You must output strictly valid JSON only. Do not wrap in markdown blocks. No other text.';
const TOOL_AVAILABILITY_INSTRUCTION =
  ' You have access to google_search tool for real-time info/web. Never deny using it.';

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

function isGeminiSearchModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'gemini-search';
}

function withSystemInstruction(
  messages: LLMRequest['messages'],
  instruction: string,
): LLMRequest['messages'] {
  const cloned = messages.map((message) => ({ ...message }));
  const systemMessage = cloned.find((message) => message.role === 'system');

  if (systemMessage) {
    if (typeof systemMessage.content === 'string') {
      if (!systemMessage.content.includes(instruction.trim())) {
        systemMessage.content += instruction;
      }
    } else if (Array.isArray(systemMessage.content)) {
      const alreadyPresent = systemMessage.content.some(
        (part) => part.type === 'text' && part.text.includes(instruction.trim()),
      );
      if (!alreadyPresent) {
        systemMessage.content = [...systemMessage.content, { type: 'text', text: instruction.trim() }];
      }
    }
    return cloned;
  }

  return [{ role: 'system', content: instruction.trim() }, ...cloned];
}

function extractSystemText(content: LLMRequest['messages'][number]['content']): string {
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

/**
 * Ensure provider calls receive one consolidated system prompt block.
 * This prevents scattered system instructions from being dropped or reordered.
 */
function collapseSystemMessages(messages: LLMRequest['messages']): LLMRequest['messages'] {
  const systemParts: string[] = [];
  const nonSystemMessages: LLMRequest['messages'] = [];

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

function assertSafeBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:') {
    throw new Error('LLM base URL must use HTTPS.');
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

export class PollinationsClient implements LLMClient {
  private config: PollinationsConfig;
  private breaker: CircuitBreaker;

  constructor(config: Partial<PollinationsConfig> = {}) {
    const baseUrl = assertSafeBaseUrl(config.baseUrl || 'https://gen.pollinations.ai/v1');
    const timeoutMs = normalizeTimeoutMs(config.timeoutMs, {
      fallbackMs: DEFAULT_TIMEOUT_MS,
      minMs: MIN_TIMEOUT_MS,
      maxMs: MAX_TIMEOUT_MS,
    });
    const maxRetries = resolveMaxRetries(config.maxRetries);

    if (config.timeoutMs !== undefined && timeoutMs !== Math.floor(config.timeoutMs)) {
      logger.warn(
        { providedTimeoutMs: config.timeoutMs, appliedTimeoutMs: timeoutMs, minTimeoutMs: MIN_TIMEOUT_MS, maxTimeoutMs: MAX_TIMEOUT_MS },
        '[Pollinations] Invalid timeout override detected; using sanitized timeout',
      );
    }

    if (config.maxRetries !== undefined && maxRetries !== Math.floor(config.maxRetries)) {
      logger.warn(
        { providedMaxRetries: config.maxRetries, appliedMaxRetries: maxRetries, maxRetriesCap: MAX_RETRIES },
        '[Pollinations] Invalid maxRetries override detected; using sanitized retry count',
      );
    }

    this.config = {
      baseUrl,
      model: (config.model || 'kimi').toLowerCase(),
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

  private async _chat(request: LLMRequest): Promise<LLMResponse> {
    // Build final URL - strict guarantee of single /chat/completions
    const url = `${this.config.baseUrl}/chat/completions`;
    const rawModel = request.model || this.config.model;
    const model = rawModel.trim().toLowerCase();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = request.apiKey || this.config.apiKey;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const modelConfig = getModelBudgetConfig(model);
    const plan = planBudget(modelConfig, {
      reservedOutputTokens: request.maxTokens ?? modelConfig.maxOutputTokens,
    });
    const { trimmed, stats } = trimMessagesToBudget(request.messages, plan, {
      keepSystemMessages: true,
      keepLastUserTurns: 4,
      visionFadeKeepLastUserImages: modelConfig.visionFadeKeepLastUserImages,
      attachmentTextMaxTokens: modelConfig.attachmentTextMaxTokens,
      estimator: modelConfig.estimation,
      visionEnabled: modelConfig.visionEnabled,
    });

    // Normalize messages to enforce strict alternation (S? -> U -> A -> U...).
    const messagesWithSingleSystem = collapseSystemMessages(trimmed);
    const normalizedMessages: LLMRequest['messages'] = [];

    for (const msg of messagesWithSingleSystem) {
      if (normalizedMessages.length === 0) {
        normalizedMessages.push(msg);
        continue;
      }

      const prev = normalizedMessages[normalizedMessages.length - 1];

      // Merge adjacent same-role messages.
      if (prev.role === msg.role) {
        if (Array.isArray(prev.content) && Array.isArray(msg.content)) {
          prev.content = [...prev.content, ...msg.content];
        } else if (typeof prev.content === 'string' && typeof msg.content === 'string') {
          prev.content += '\n\n' + msg.content;
        } else {
          // Mixed types are stringified so both payloads are retained.
          const prevText = typeof prev.content === 'string' ? prev.content : JSON.stringify(prev.content);
          const currText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          prev.content = `${prevText}\n\n${currText}`;
        }
      } else {
        normalizedMessages.push(msg);
      }
    }

    // Ensure first non-system message is user.
    let firstNonSystemIndex = -1;
    for (let i = 0; i < normalizedMessages.length; i++) {
      if (normalizedMessages[i].role !== 'system') {
        firstNonSystemIndex = i;
        break;
      }
    }

    if (firstNonSystemIndex !== -1) {
      const firstMsg = normalizedMessages[firstNonSystemIndex];
      if (firstMsg.role === 'assistant') {
        normalizedMessages.splice(firstNonSystemIndex, 0, {
          role: 'user',
          content: '(Consulting memory/context...)'
        });
      }
    }


    if (stats.droppedCount > 0 || stats.notes.length > 0) {
      logger.info(
        {
          model,
          beforeCount: stats.beforeCount,
          afterCount: stats.afterCount,
          estimatedTokensBefore: stats.estimatedTokensBefore,
          estimatedTokensAfter: stats.estimatedTokensAfter,
          availableInputTokens: plan.availableInputTokens,
          notes: stats.notes,
        },
        '[Budget] Trim applied',
      );
    } else {
      logger.debug(
        {
          model,
          messageCount: stats.afterCount,
          estimatedTokens: stats.estimatedTokensAfter,
          availableInputTokens: plan.availableInputTokens,
        },
        '[Budget] Budget ok',
      );
    }

    const payload: PollinationsPayload = {
      model,
      messages: normalizedMessages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      response_format:
        request.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
      tools: sanitizeToolDefinitionsForProvider(request.tools),
      tool_choice: request.toolChoice,
    };

    // WORKAROUND: gemini-search models reject response_format='json_object'.
    // Apply the shim only for gemini-search family so other models keep native JSON mode.
    if (isGeminiSearchModel(model) && payload.response_format?.type === 'json_object') {
      logger.info(
        { model, hasTools: !!payload.tools?.length },
        '[Pollinations] gemini-search does not support JSON mode. Disabling API JSON mode and injecting prompt instructions.',
      );

      delete payload.response_format;

      const instruction =
        payload.tools && payload.tools.length > 0
          ? `${TOOL_AVAILABILITY_INSTRUCTION}${JSON_ONLY_INSTRUCTION}`
          : JSON_ONLY_INSTRUCTION;
      payload.messages = withSystemInstruction(payload.messages, instruction);
    }

    // Safe URL logging (no headers)
    logger.debug({ url, model, messageCount: trimmed.length }, '[Pollinations] Request');
    metrics.increment('llm_calls_total', { model, provider: 'pollinations' });

    let attempt = 0;
    let lastError: Error | undefined;
    const maxAttempts = this.config.maxRetries! + 1; // +1 for the first try
    let hasRetriedForJson = false;

    while (attempt < maxAttempts) {
      try {
        const controller = new AbortController();
        // Use request-specific timeout if provided, then sanitize to safe bounds.
        const timeout = normalizeTimeoutMs(request.timeout, {
          fallbackMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          minMs: MIN_TIMEOUT_MS,
          maxMs: MAX_TIMEOUT_MS,
        });
        const id = setTimeout(() => controller.abort(), timeout);

        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(id);
        }

        if (!response.ok) {
          const text = await response.text();

          // 1. JSON Mode Compatibility Check
          // If rejection is due to response_format/json_object, retry ONCE without it
          if (
            !hasRetriedForJson &&
            (response.status === 400 || response.status === 422) &&
            payload.response_format &&
            /response_format|json_object|unknown field|unsupported/i.test(text)
          ) {
            logger.warn(
              { status: response.status, error: text.slice(0, 100) },
              '[Pollinations] JSON mode rejected. Retrying with shim...',
            );

            hasRetriedForJson = true;

            // Modify payload for compatibility retry
            delete payload.response_format;
            // Strengthen system prompt to ensure JSON output
            const systemMsg = payload.messages.find((m) => m.role === 'system');

            // Avoid duplicate instructions
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

            // Continue loop immediately to retry with new payload
            continue;
          }

          // 2. Fail Fast on Model Validation Errors (400)
          // Only if we passed the JSON check or it wasn't a JSON error
          if (response.status === 400 && /model|validation/i.test(text)) {
            const err = new Error(`Pollinations Model Error: ${text}`);
            logger.error(
              {
                status: response.status,
                model,
                error: text,
              },
              '[Pollinations] Invalid Model - Aborting Retries',
            );
            throw err; // invalidating retry loop by throwing out
          }

          const err = new Error(
            `Pollinations API error: ${response.status} ${response.statusText} - ${text.slice(0, 200)}`,
          );
          logger.warn(
            { status: response.status, error: err.message, timeout },
            '[Pollinations] API Error',
          );
          throw err;
        }

        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };
        const message = data.choices?.[0]?.message;
        let content = message?.content || '';

        // Handle native tool calls from OpenAI-compatible APIs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCalls = (message as any)?.tool_calls;

        if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
          logger.debug({ count: toolCalls.length }, '[Pollinations] Native tool calls detected, serializing to envelope');

          const envelope = {
            type: 'tool_calls',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            calls: toolCalls.map((tc: any) => {
              let args: unknown;
              try {
                args = JSON.parse(tc.function.arguments);
              } catch {
                args = {};
                logger.warn(
                  { toolName: tc.function.name, rawArgs: String(tc.function.arguments).slice(0, 200) },
                  '[Pollinations] Malformed tool call arguments JSON, defaulting to empty object',
                );
              }
              return { name: tc.function.name, args };
            }),
          };

          // If tool calls are present, we MUST return strict JSON for the agentRuntime to parse.
          // Any text content (thought chain) must be discarded because agentRuntime expects 
          // either pure text OR a JSON envelope, not both.
          content = JSON.stringify(envelope, null, 2);
        }
        logger.debug({ usage: data.usage }, '[Pollinations] Success');

        return {
          content,
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

        // If it's the model validation error we threw above, stop retrying
        if (lastError.message.includes('Pollinations Model Error')) {
          throw lastError;
        }

        attempt++;

        if (attempt < maxAttempts) {
          metrics.increment('llm_failures_total', { model, type: 'retry' });
          logger.warn({ attempt, error: lastError.message }, '[Pollinations] Retry');

          // Simple backoff
          await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
        }
      }
    }

    metrics.increment('llm_failures_total', { model, type: 'exhausted' });
    logger.error({ error: lastError }, '[Pollinations] Failed after retries');
    throw lastError;
  }
}

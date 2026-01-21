import { LLMClient, LLMRequest, LLMResponse, ToolDefinition, LLMChatMessage } from '../types';
import { CircuitBreaker } from '../circuitBreaker';
import { logger } from '../../utils/logger';
import { metrics } from '../../utils/metrics';

interface PollinationsConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface PollinationsPayload {
  model: string;
  messages: LLMChatMessage[];
  temperature: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
  tools?: ToolDefinition[];
  tool_choice?: string | object;
}

export class PollinationsClient implements LLMClient {
  private config: PollinationsConfig;
  private breaker: CircuitBreaker;

  constructor(config: Partial<PollinationsConfig> = {}) {
    let baseUrl = config.baseUrl || 'https://gen.pollinations.ai/v1';
    // Normalize: trim, remove trailing slash, remove /chat/completions suffix
    baseUrl = baseUrl
      .trim()
      .replace(/\/$/, '')
      .replace(/\/chat\/completions$/, '');

    this.config = {
      baseUrl,
      model: (config.model || 'gemini').toLowerCase(),
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs || 180000,
      maxRetries: config.maxRetries ?? 2,
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
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const payload: PollinationsPayload = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      response_format:
        request.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
      tools: request.tools,
      tool_choice: request.toolChoice,
    };

    // WORKAROUND: Gemini/Vertex AI crashes if both tools and response_format='json_object' are sent.
    // We detect this case, disable API-level JSON mode, and enforce it via system prompt instead.
    if (
      payload.response_format?.type === 'json_object' &&
      payload.tools &&
      payload.tools.length > 0
    ) {
      logger.info(
        { model },
        '[Pollinations] Detected Tools + JSON Mode. Disabling API JSON mode and injecting prompt instructions to prevent upstream crash.',
      );

      // 1. Disable API-level JSON mode
      delete payload.response_format;

      // 2. Inject instructions
      const jsonInstruction =
        ' IMPORTANT: You must output strictly valid JSON only. Do not wrap in markdown blocks. No other text.';
      const toolInstruction =
        ' You have access to google_search tool for real-time info/web. Never deny using it.';

      const systemMsg = payload.messages.find((m) => m.role === 'system');
      if (systemMsg) {
        if (typeof systemMsg.content === 'string') {
          systemMsg.content += toolInstruction + jsonInstruction;
        }
      } else {
        payload.messages.unshift({ role: 'system', content: toolInstruction + jsonInstruction });
      }
    }

    // Safe URL logging (no headers)
    logger.debug({ url, model, messageCount: request.messages.length }, '[Pollinations] Request');
    metrics.increment('llm_calls_total', { model, provider: 'pollinations' });

    let attempt = 0;
    let lastError: Error | undefined;
    const maxAttempts = this.config.maxRetries! + 1; // +1 for the first try
    let hasRetriedForJson = false;

    while (attempt < maxAttempts) {
      try {
        const controller = new AbortController();
        // Use request-specific timeout if provided (e.g., chat vs. memory), else default
        const timeout = request.timeout || this.config.timeoutMs;
        const id = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(id);

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
            const jsonInstruction =
              ' IMPORTANT: You must output strictly valid JSON only. Do not wrap in markdown blocks. No other text.';
            const systemMsg = payload.messages.find((m) => m.role === 'system');

            // Avoid duplicate instructions
            if (systemMsg) {
              if (
                typeof systemMsg.content === 'string' &&
                !systemMsg.content.includes('valid JSON only')
              ) {
                systemMsg.content += jsonInstruction;
              }
            } else {
              payload.messages.unshift({ role: 'system', content: jsonInstruction });
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
        const content = data.choices?.[0]?.message?.content || '';

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

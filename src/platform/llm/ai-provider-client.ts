import {
  LLMClient,
  LLMMessageContent,
  LLMRequest,
  LLMResponse,
  ProviderAllowedTool,
  LLMToolCall,
  ProviderToolDefinition,
} from './llm-types';
import { CircuitBreaker } from './circuit-breaker';
import { logger } from '../logging/logger';
import { metrics } from '../../shared/observability/metrics';
import { countMessagesTokens } from './context-budgeter';
import { sanitizeJsonSchemaForProvider } from '../../shared/validation/json-schema';
import { normalizeTimeoutMs } from '../../shared/utils/timeout';
import { AppError } from '../../shared/errors/app-error';
import { handleHostCodexProviderAuthFailure } from '../../features/auth/hostCodexAuthService';

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
  tools?: ProviderToolDefinition[];
  parallel_tool_calls?: boolean;
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

type CodexInputContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'auto' };

type CodexInputItem =
  | { role: 'user'; content: CodexInputContentPart[] }
  | {
      type: 'message';
      role: 'assistant';
      content: Array<{ type: 'output_text'; text: string; annotations: unknown[] }>;
      status: 'completed';
      id: string;
    }
  | {
      type: 'function_call';
      id: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    };

type CodexToolDefinition = {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: boolean;
};

type CodexResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  [key: string]: unknown;
};

type CodexResponseEvent =
  | {
      type: 'response.completed';
      response?: { usage?: CodexResponseUsage; status?: string };
    }
  | {
      type: 'response.output_item.added';
      item?: { type?: string; id?: string; call_id?: string; name?: string; arguments?: string };
    }
  | { type: 'response.output_text.delta'; delta?: string }
  | { type: 'response.reasoning_summary_text.delta'; delta?: string }
  | { type: 'response.function_call_arguments.delta'; delta?: string }
  | { type: 'response.function_call_arguments.done'; arguments?: string }
  | { type: 'error'; code?: string; message?: string }
  | {
      type: 'response.failed';
      response?: {
        error?: { code?: string; message?: string };
        incomplete_details?: { reason?: string };
      };
    }
  | { type?: string; [key: string]: unknown };

const DEFAULT_TIMEOUT_MS = 180_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES = 5;
const providerToolControlsSupportCache = new Map<string, boolean>();
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const CODEX_RESPONSES_BETA = 'responses=experimental';
const CODEX_ACCOUNT_ID_CLAIM = 'https://api.openai.com/auth';

function buildProviderToolControlsCacheKey(baseUrl: string, model: string): string {
  return `${baseUrl}::${model.trim().toLowerCase()}`;
}

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

function extractTextContent(content: LLMMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .filter((value) => value.trim().length > 0)
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
  return collapseSystemMessages(
    messages.map((message) => ({
      role: message.role,
      content: message.content,
      tool_calls: serializeToolCallsForApi(message.toolCalls),
      tool_call_id: message.toolCallId,
    })),
  );
}

function assertSafeBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI provider base URL must use HTTP(S).');
  }
  return parsed.toString().replace(/\/$/, '');
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractCodexAccountId(token: string): string {
  const payload = decodeJwtPayload(token);
  const authClaim = payload?.[CODEX_ACCOUNT_ID_CLAIM];
  if (authClaim && typeof authClaim === 'object' && !Array.isArray(authClaim)) {
    const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
    if (typeof accountId === 'string' && accountId.trim().length > 0) {
      return accountId.trim();
    }
  }

  throw new AppError(
    'AI_PROVIDER_AUTH',
    'Host Codex auth token is missing the required ChatGPT account id claim.',
  );
}

function normalizeCodexIdentifier(rawValue: string, prefix: string): string {
  const sanitized = rawValue.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const prefixed = sanitized.length > 0 ? sanitized : `${prefix}_${Date.now().toString(36)}`;
  const normalized = prefixed.startsWith(prefix) ? prefixed : `${prefix}_${prefixed}`;
  return normalized.slice(0, 64);
}

function normalizeCodexToolChoice(
  toolChoice: LLMRequest['toolChoice'],
): string | { type: 'function'; name: string } | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (typeof toolChoice === 'string') {
    return toolChoice;
  }

  if (
    toolChoice &&
    typeof toolChoice === 'object' &&
    !Array.isArray(toolChoice) &&
    toolChoice.type === 'function' &&
    toolChoice.function &&
    typeof toolChoice.function === 'object' &&
    typeof (toolChoice.function as { name?: unknown }).name === 'string'
  ) {
    const name = (toolChoice.function as { name: string }).name.trim();
    if (name.length > 0) {
      return { type: 'function', name };
    }
  }

  return undefined;
}

function normalizeCodexInputMessages(messages: LLMRequest['messages']): {
  instructions?: string;
  input: CodexInputItem[];
} {
  const collapsedMessages = collapseSystemMessages(
    messages.map((message) => ({
      role: message.role,
      content: message.content,
      tool_calls: serializeToolCallsForApi(message.toolCalls),
      tool_call_id: message.toolCallId,
    })),
  );

  const instructions =
    collapsedMessages[0]?.role === 'system'
      ? extractSystemText(collapsedMessages[0].content).trim() || undefined
      : undefined;
  const conversationalMessages =
    collapsedMessages[0]?.role === 'system' ? collapsedMessages.slice(1) : collapsedMessages;

  const input: CodexInputItem[] = [];

  conversationalMessages.forEach((message, messageIndex) => {
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        input.push({
          role: 'user',
          content: [{ type: 'input_text', text: message.content }],
        });
        return;
      }

      const content = message.content.flatMap<CodexInputContentPart>((part) => {
        if (part.type === 'text') {
          return part.text.trim().length > 0 ? [{ type: 'input_text', text: part.text }] : [];
        }
        return [{ type: 'input_image', image_url: part.image_url.url, detail: 'auto' }];
      });

      if (content.length > 0) {
        input.push({ role: 'user', content });
      }
      return;
    }

    if (message.role === 'assistant') {
      const assistantText = extractSystemText(message.content).trim();
      if (assistantText.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: assistantText, annotations: [] }],
          status: 'completed',
          id: normalizeCodexIdentifier(`msg_${messageIndex}`, 'msg'),
        });
      }

      for (const [toolIndex, toolCall] of (message.tool_calls ?? []).entries()) {
        const rawCallId = toolCall.id?.trim() || `call_${messageIndex}_${toolIndex}`;
        const callId = normalizeCodexIdentifier(rawCallId, 'call');
        input.push({
          type: 'function_call',
          id: normalizeCodexIdentifier(`${rawCallId}_item`, 'fc'),
          call_id: callId,
          name: toolCall.function?.name?.trim() || 'unknown_tool',
          arguments: toolCall.function?.arguments ?? '{}',
        });
      }
      return;
    }

    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: normalizeCodexIdentifier(message.tool_call_id?.trim() || `call_${messageIndex}`, 'call'),
        output: extractTextContent(message.content).trim() || '(empty tool result)',
      });
    }
  });

  return { instructions, input };
}

function normalizeCodexTools(tools: ProviderToolDefinition[] | undefined): CodexToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }));
}

function resolveCodexResponsesUrl(rawBaseUrl: string): string {
  const normalized = assertSafeBaseUrl(rawBaseUrl || CODEX_BASE_URL).replace(/\/+$/, '');
  if (normalized.endsWith('/codex/responses')) {
    return normalized;
  }
  if (normalized.endsWith('/codex')) {
    return `${normalized}/responses`;
  }
  return `${normalized}/codex/responses`;
}

async function* parseServerSentEvents(response: Response): AsyncGenerator<CodexResponseEvent, void, void> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf('\n\n');

      while (separatorIndex !== -1) {
        const chunk = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const payload = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
          .trim();

        if (payload && payload !== '[DONE]') {
          try {
            yield JSON.parse(payload) as CodexResponseEvent;
          } catch {
            // Ignore malformed chunks.
          }
        }

        separatorIndex = buffer.indexOf('\n\n');
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cleanup failures.
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore cleanup failures.
    }
  }
}

function sanitizeToolDefinitionsForProvider(
  tools: ProviderToolDefinition[] | undefined,
): ProviderToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return tools;
  }

  const normalizeToolParameters = (toolName: string, parameters: Record<string, unknown>): Record<string, unknown> => {
    const sanitized = sanitizeJsonSchemaForProvider(parameters);
    if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
      throw new Error(
        `Tool "${toolName}" must expose Chat Completions parameters as a JSON-schema object.`,
      );
    }
    const objectSchema = { ...sanitized } as Record<string, unknown>;
    for (const key of ['oneOf', 'anyOf', 'allOf', 'not']) {
      if (key in objectSchema) {
        throw new Error(
          `Tool "${toolName}" uses unsupported top-level schema keyword "${key}" for Chat Completions tool calling.`,
        );
      }
    }
    if (objectSchema.type !== 'object') {
      throw new Error(
        `Tool "${toolName}" must expose top-level parameters with type="object".`,
      );
    }
    if (!objectSchema.properties || typeof objectSchema.properties !== 'object' || Array.isArray(objectSchema.properties)) {
      throw new Error(
        `Tool "${toolName}" must expose top-level object properties for Chat Completions tool calling.`,
      );
    }
    if ('required' in objectSchema && !Array.isArray(objectSchema.required)) {
      throw new Error(
        `Tool "${toolName}" must declare "required" as an array when provided.`,
      );
    }
    return objectSchema;
  };

  return tools.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      parameters: normalizeToolParameters(tool.function.name, tool.function.parameters),
    },
  }));
}

function filterToolsByAllowedTools(
  tools: ProviderToolDefinition[] | undefined,
  allowedTools: ProviderAllowedTool[] | undefined,
): ProviderToolDefinition[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) {
    return tools;
  }
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return tools;
  }

  const allowedNames = new Set(
    allowedTools
      .map((tool) => tool.function?.name?.trim())
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
  );
  if (allowedNames.size === 0) {
    return tools;
  }

  return tools.filter((tool) => allowedNames.has(tool.function.name));
}

function parseProviderErrorDetails(bodyText: string): {
  message: string;
  code: string | null;
  type: string | null;
  param: string | null;
} {
  const trimmedBody = bodyText.slice(0, 500);
  try {
    const parsed = JSON.parse(bodyText) as
      | { error?: { message?: unknown; code?: unknown; type?: unknown; param?: unknown } }
      | { message?: unknown; code?: unknown; type?: unknown; param?: unknown };
    const parsedRecord = parsed as {
      error?: { message?: unknown; code?: unknown; type?: unknown; param?: unknown };
      message?: unknown;
      code?: unknown;
      type?: unknown;
      param?: unknown;
    };
    const candidate =
      parsedRecord && typeof parsedRecord === 'object' && parsedRecord.error && typeof parsedRecord.error === 'object'
        ? parsedRecord.error
        : parsedRecord;
    return {
      message:
        typeof candidate?.message === 'string' && candidate.message.trim().length > 0
          ? candidate.message.trim()
          : trimmedBody,
      code:
        typeof candidate?.code === 'string' && candidate.code.trim().length > 0
          ? candidate.code.trim().toLowerCase()
          : null,
      type:
        typeof candidate?.type === 'string' && candidate.type.trim().length > 0
          ? candidate.type.trim().toLowerCase()
          : null,
      param:
        typeof candidate?.param === 'string' && candidate.param.trim().length > 0
          ? candidate.param.trim().toLowerCase()
          : null,
    };
  } catch {
    return {
      message: trimmedBody,
      code: null,
      type: null,
      param: null,
    };
  }
}

function isStructuredProviderModelError(details: { code: string | null; type: string | null }): boolean {
  const normalized = [details.code, details.type].filter((value): value is string => Boolean(value));
  return normalized.some((value) =>
    new Set([
      'invalid_model',
      'model_not_found',
      'unsupported_model',
      'invalid_tool_schema',
      'invalid_schema',
      'tool_validation_error',
      'validation_error',
    ]).has(value),
  );
}

function shouldRetryWithoutProviderToolControls(details: {
  code: string | null;
  type: string | null;
  param: string | null;
}): boolean {
  const normalized = new Set([details.code, details.type].filter((value): value is string => Boolean(value)));
  if (normalized.has('invalid_tool_schema') || normalized.has('tool_validation_error')) {
    return false;
  }
  if (
    !normalized.has('unknown_parameter')
    && !normalized.has('unsupported_parameter')
    && !normalized.has('invalid_request_error')
    && !normalized.has('unsupported_feature')
  ) {
    return false;
  }
  return details.param === 'parallel_tool_calls' || details.param === 'tool_choice';
}

function classifyAiProviderHttpError(status: number, statusText: string, bodyText: string): AppError {
  const details = parseProviderErrorDetails(bodyText);
  const trimmedBody = details.message;
  if (status === 400) {
    if (isStructuredProviderModelError(details)) {
      return new AppError('AI_PROVIDER_MODEL', `AI provider model error: ${trimmedBody}`, undefined, {
        status,
        statusText,
      });
    }
    return new AppError('AI_PROVIDER_BAD_REQUEST', `AI provider bad request: ${trimmedBody}`, undefined, {
      status,
      statusText,
    });
  }
  if (status === 401 || status === 403) {
    return new AppError('AI_PROVIDER_AUTH', `AI provider auth error: ${trimmedBody}`, undefined, {
      status,
      statusText,
    });
  }
  if (status === 404) {
    if (isStructuredProviderModelError(details)) {
      return new AppError('AI_PROVIDER_MODEL', `AI provider model error: ${trimmedBody}`, undefined, {
        status,
        statusText,
      });
    }
    return new AppError('AI_PROVIDER_ENDPOINT', `AI provider endpoint error: ${trimmedBody}`, undefined, {
      status,
      statusText,
    });
  }
  if (status === 408 || status === 504) {
    return new AppError('AI_PROVIDER_TIMEOUT', `AI provider API error: ${status} ${statusText} - ${trimmedBody}`, undefined, {
      status,
      statusText,
    });
  }
  if (status === 409 || status === 425 || status === 429) {
    return new AppError('AI_PROVIDER_RATE_LIMIT', `AI provider rate limit: ${trimmedBody}`, undefined, {
      status,
      statusText,
    });
  }
  if (status >= 500) {
    return new AppError('AI_PROVIDER_UPSTREAM', `AI provider API error: ${status} ${statusText} - ${trimmedBody}`, undefined, {
      status,
      statusText,
    });
  }
  return new AppError('EXTERNAL_CALL_FAILED', `AI provider API error: ${status} ${statusText} - ${trimmedBody}`, undefined, {
    status,
    statusText,
  });
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

  static resetProviderToolControlsSupportCacheForTests(): void {
    providerToolControlsSupportCache.clear();
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

  private async _chat(request: LLMRequest, authRecoveryAttempted = false): Promise<LLMResponse> {
    const effectiveProviderId = request.providerId ?? 'default';
    if (effectiveProviderId === 'openai_codex') {
      return this._chatOpenAICodexResponses(request, authRecoveryAttempted);
    }
    return this._chatCompatibleCompletions(request, authRecoveryAttempted);
  }

  private async retryWithFallbackRoute(
    request: LLMRequest,
    authRecoveryAttempted: boolean,
  ): Promise<LLMResponse | null> {
    if (
      authRecoveryAttempted ||
      request.authSource !== 'host_codex_auth' ||
      !request.fallbackRoute?.apiKey?.trim()
    ) {
      return null;
    }

    return this._chat(
      {
        ...request,
        providerId: request.fallbackRoute.providerId,
        baseUrl: request.fallbackRoute.baseUrl,
        model: request.fallbackRoute.model,
        apiKey: request.fallbackRoute.apiKey.trim(),
        authSource: request.fallbackRoute.authSource,
        fallbackRoute: undefined,
      },
      true,
    );
  }

  private async parseCodexResponsesStream(response: Response): Promise<LLMResponse> {
    let text = '';
    let reasoningText = '';
    let usage: CodexResponseUsage | undefined;
    let status: string | undefined;
    let currentFunctionCallId: string | null = null;
    let currentFunctionCallItemId: string | null = null;
    let currentFunctionName: string | null = null;
    let currentFunctionArgs = '';
    const toolCalls = new Map<string, LLMToolCall>();

    for await (const event of parseServerSentEvents(response)) {
      switch (event.type) {
        case 'response.output_item.added': {
          const item = (
            event as Extract<CodexResponseEvent, { type: 'response.output_item.added' }>
          ).item;
          if (item?.type === 'function_call') {
            currentFunctionCallId = item.call_id?.trim() || null;
            currentFunctionCallItemId = item.id?.trim() || null;
            currentFunctionName = item.name?.trim() || null;
            currentFunctionArgs = item.arguments ?? '';
          }
          break;
        }
        case 'response.output_text.delta':
          text += event.delta ?? '';
          break;
        case 'response.reasoning_summary_text.delta':
          reasoningText += event.delta ?? '';
          break;
        case 'response.function_call_arguments.delta':
          if (currentFunctionCallId) {
            currentFunctionArgs += (
              event as Extract<CodexResponseEvent, { type: 'response.function_call_arguments.delta' }>
            ).delta ?? '';
          }
          break;
        case 'response.function_call_arguments.done':
          if (currentFunctionCallId) {
            currentFunctionArgs = (
              event as Extract<CodexResponseEvent, { type: 'response.function_call_arguments.done' }>
            ).arguments ?? currentFunctionArgs;
            let args: unknown;
            try {
              args = JSON.parse(currentFunctionArgs || '{}');
            } catch (error) {
              throw new AppError(
                'AI_PROVIDER_BAD_REQUEST',
                `AI provider returned malformed JSON arguments for tool "${currentFunctionName || 'unknown_tool'}".`,
                error instanceof Error ? error : undefined,
              );
            }
            toolCalls.set(currentFunctionCallId, {
              id: currentFunctionCallItemId ?? currentFunctionCallId,
              name: currentFunctionName || 'unknown_tool',
              args,
            });
          }
          currentFunctionCallId = null;
          currentFunctionCallItemId = null;
          currentFunctionName = null;
          currentFunctionArgs = '';
          break;
        case 'response.completed': {
          const responseEvent = event as Extract<CodexResponseEvent, { type: 'response.completed' }>;
          usage = responseEvent.response?.usage;
          status = responseEvent.response?.status;
          break;
        }
        case 'response.failed': {
          const failedEvent = event as Extract<CodexResponseEvent, { type: 'response.failed' }>;
          const message =
            failedEvent.response?.error?.message
            || failedEvent.response?.incomplete_details?.reason
            || 'Codex response failed.';
          throw new AppError('AI_PROVIDER_UPSTREAM', `AI provider API error: ${message}`);
        }
        case 'error': {
          const errorEvent = event as Extract<CodexResponseEvent, { type: 'error' }>;
          const message = errorEvent.message || errorEvent.code || 'Unknown Codex error.';
          throw new AppError('AI_PROVIDER_UPSTREAM', `AI provider API error: ${message}`);
        }
        default:
          break;
      }
    }

    const normalizedToolCalls = Array.from(toolCalls.values());
    const finalReasoningText = reasoningText.trim();
    const finalText = text.trim();

    return {
      text: normalizedToolCalls.length > 0 ? '' : finalText,
      toolCalls: normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined,
      reasoningText:
        normalizedToolCalls.length > 0
          ? finalReasoningText || (finalText.length > 0 ? finalText : undefined)
          : finalReasoningText || undefined,
      usage: usage
        ? {
            promptTokens: usage.input_tokens ?? 0,
            completionTokens: usage.output_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
            cachedTokens: usage.input_tokens_details?.cached_tokens,
            raw: {
              ...usage,
              status,
            },
          }
        : undefined,
    };
  }

  private async _chatOpenAICodexResponses(
    request: LLMRequest,
    authRecoveryAttempted = false,
  ): Promise<LLMResponse> {
    const effectiveBaseUrl = assertSafeBaseUrl(request.baseUrl?.trim() || this.config.baseUrl);
    const effectiveProviderId = request.providerId ?? 'openai_codex';
    const model = (request.model || this.config.model).trim();
    if (!model) {
      throw new Error('AI provider request model must be configured.');
    }

    const apiKey = request.apiKey || this.config.apiKey;
    if (!apiKey?.trim()) {
      throw new AppError('AI_PROVIDER_AUTH', 'Host Codex auth token is missing.');
    }

    const accountId = extractCodexAccountId(apiKey.trim());
    const url = resolveCodexResponsesUrl(effectiveBaseUrl || CODEX_BASE_URL);
    const normalizedMessages = normalizeCodexInputMessages(request.messages);
    const normalizedTools = normalizeCodexTools(
      sanitizeToolDefinitionsForProvider(filterToolsByAllowedTools(request.tools, request.allowedTools)),
    );
    const tokenCount = countMessagesTokens(request.messages, model);

    logger.debug(
      {
        model,
        messageCount: request.messages.length,
        estimatedTokens: tokenCount.totalTokens,
        tokenCountSource: tokenCount.source,
        tokenizerEncoding: tokenCount.encodingName,
        imageTokenReserve: tokenCount.imageTokenReserve,
      },
      '[Budget] Preflight token count',
    );

    metrics.increment('llm_calls_total', { model, provider: String(effectiveProviderId) });
    logger.debug({ url, model, messageCount: request.messages.length }, '[AiProviderClient] Codex request');

    const payload: Record<string, unknown> = {
      model,
      store: false,
      stream: true,
      instructions: normalizedMessages.instructions || 'You are Sage, a helpful assistant.',
      input: normalizedMessages.input,
      text: { verbosity: 'medium' },
      include: ['reasoning.encrypted_content'],
    };

    if (normalizedTools && normalizedTools.length > 0) {
      payload.tools = normalizedTools;
    }

    const normalizedToolChoice = normalizeCodexToolChoice(request.toolChoice);
    if (normalizedToolChoice !== undefined) {
      payload.tool_choice = normalizedToolChoice;
    }

    if (typeof request.parallelToolCalls === 'boolean') {
      payload.parallel_tool_calls = request.parallelToolCalls;
    }

    if (typeof request.temperature === 'number' && Number.isFinite(request.temperature)) {
      payload.temperature = request.temperature;
    }

    let attempt = 0;
    let lastError: AppError | undefined;
    const maxAttempts = this.config.maxRetries + 1;

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
            headers: {
              Authorization: `Bearer ${apiKey.trim()}`,
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              'OpenAI-Beta': CODEX_RESPONSES_BETA,
              'chatgpt-account-id': accountId,
              originator: 'pi',
            },
            body: JSON.stringify(payload),
            signal: composeAbortSignal(request.signal, controller.signal),
          });
        } finally {
          clearTimeout(id);
        }

        if (!response.ok) {
          const text = await response.text();
          const err = classifyAiProviderHttpError(response.status, response.statusText, text);
          if (response.status === 401 || response.status === 403) {
            await handleHostCodexProviderAuthFailure({ errorText: err.message });
            const fallbackResponse = await this.retryWithFallbackRoute(request, authRecoveryAttempted);
            if (fallbackResponse) {
              return fallbackResponse;
            }
          }
          throw err;
        }

        const parsed = await this.parseCodexResponsesStream(response);
        logger.debug({ usage: parsed.usage }, '[AiProviderClient] Codex success');
        return parsed;
      } catch (err: unknown) {
        if (isAbortError(err) || request.signal?.aborted) {
          lastError =
            err instanceof AppError
              ? err
              : new AppError('AI_PROVIDER_TIMEOUT', 'AI provider request aborted.', err);
          throw lastError;
        }

        lastError =
          err instanceof AppError
            ? err
            : new AppError('AI_PROVIDER_NETWORK', err instanceof Error ? err.message : String(err), err);

        if (
          lastError.code === 'AI_PROVIDER_MODEL'
          || lastError.code === 'AI_PROVIDER_ENDPOINT'
          || lastError.code === 'AI_PROVIDER_AUTH'
          || lastError.code === 'AI_PROVIDER_BAD_REQUEST'
        ) {
          throw lastError;
        }

        attempt += 1;

        if (attempt < maxAttempts) {
          metrics.increment('llm_failures_total', { model, type: 'retry', provider: String(effectiveProviderId) });
          logger.warn({ attempt, error: lastError.message }, '[AiProviderClient] Codex retry');
          await sleep(500 * Math.pow(2, attempt), request.signal);
        }
      }
    }

    metrics.increment('llm_failures_total', { model, type: 'exhausted', provider: String(effectiveProviderId) });
    logger.error({ error: lastError }, '[AiProviderClient] Codex failed after retries');
    throw lastError;
  }

  private async _chatCompatibleCompletions(request: LLMRequest, authRecoveryAttempted = false): Promise<LLMResponse> {
    const effectiveBaseUrl = assertSafeBaseUrl(request.baseUrl?.trim() || this.config.baseUrl);
    const effectiveProviderId = request.providerId ?? 'default';
    const url = `${effectiveBaseUrl}/chat/completions`;
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
    const tokenCount = countMessagesTokens(request.messages, model);
    logger.debug(
      {
        model,
        messageCount: request.messages.length,
        estimatedTokens: tokenCount.totalTokens,
        tokenCountSource: tokenCount.source,
        tokenizerEncoding: tokenCount.encodingName,
        imageTokenReserve: tokenCount.imageTokenReserve,
      },
      '[Budget] Preflight token count',
    );

    const requestedProviderToolControls = typeof request.parallelToolCalls === 'boolean';
    const providerToolControlsCacheKey = buildProviderToolControlsCacheKey(effectiveBaseUrl, model);
    const cachedProviderToolControlsSupport = providerToolControlsSupportCache.get(providerToolControlsCacheKey);
    let includeProviderToolControls =
      requestedProviderToolControls && cachedProviderToolControlsSupport !== false;
    const buildPayload = (): CompatibleChatCompletionsPayload => ({
      model,
      messages: normalizedMessages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      tools: sanitizeToolDefinitionsForProvider(filterToolsByAllowedTools(request.tools, request.allowedTools)),
      parallel_tool_calls: includeProviderToolControls ? request.parallelToolCalls : undefined,
      tool_choice: request.toolChoice,
    });

    if (requestedProviderToolControls && cachedProviderToolControlsSupport === false) {
        logger.debug(
        { model, baseUrl: effectiveBaseUrl },
        '[AiProviderClient] Skipping provider tool controls because this provider/model was previously marked unsupported',
      );
    }

    logger.debug({ url, model, messageCount: request.messages.length }, '[AiProviderClient] Request');
    metrics.increment('llm_calls_total', { model, provider: String(effectiveProviderId) });

    let attempt = 0;
    let lastError: AppError | undefined;
    const maxAttempts = this.config.maxRetries + 1;

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
            body: JSON.stringify(buildPayload()),
            signal: composeAbortSignal(request.signal, controller.signal),
          });
        } finally {
          clearTimeout(id);
        }

        if (!response.ok) {
          const text = await response.text();
          const errorDetails = parseProviderErrorDetails(text);

          if (
            response.status === 400 &&
            includeProviderToolControls &&
            shouldRetryWithoutProviderToolControls(errorDetails)
          ) {
            providerToolControlsSupportCache.set(providerToolControlsCacheKey, false);
            includeProviderToolControls = false;
            logger.warn(
              { status: response.status, model, code: errorDetails.code, type: errorDetails.type, param: errorDetails.param },
              '[AiProviderClient] Provider rejected allowed_tools/parallel_tool_calls; retrying without provider tool controls',
            );
            continue;
          }

          const err = classifyAiProviderHttpError(response.status, response.statusText, text);
          if (
            !authRecoveryAttempted &&
            request.authSource === 'host_codex_auth' &&
            (response.status === 401 || response.status === 403)
          ) {
            await handleHostCodexProviderAuthFailure({
              errorText: err.message,
            });
            const fallbackResponse = await this.retryWithFallbackRoute(request, authRecoveryAttempted);
            if (fallbackResponse) {
              return fallbackResponse;
            }
          }
          logger.warn(
            { status: response.status, error: err.message, timeout, code: err.code },
            '[AiProviderClient] API error',
          );
          throw err;
        }

        const data = (await response.json()) as {
          choices?: { message?: CompatibleChatResponseMessage }[];
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
            prompt_tokens_details?: { cached_tokens?: number };
            completion_tokens_details?: { reasoning_tokens?: number };
            [key: string]: unknown;
          };
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

        if (requestedProviderToolControls && includeProviderToolControls) {
          providerToolControlsSupportCache.set(providerToolControlsCacheKey, true);
        }

        return {
          text: toolCalls && toolCalls.length > 0 ? '' : content,
          toolCalls,
          reasoningText,
          usage: data.usage
            ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
              cachedTokens: data.usage.prompt_tokens_details?.cached_tokens,
              reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens,
              raw: data.usage,
            }
            : undefined,
        };
      } catch (err: unknown) {
        if (isAbortError(err) || request.signal?.aborted) {
          lastError =
            err instanceof AppError
              ? err
              : new AppError('AI_PROVIDER_TIMEOUT', 'AI provider request aborted.', err);
          throw lastError;
        }

        lastError =
          err instanceof AppError
            ? err
            : new AppError('AI_PROVIDER_NETWORK', err instanceof Error ? err.message : String(err), err);

        if (
          lastError.code === 'AI_PROVIDER_MODEL'
          || lastError.code === 'AI_PROVIDER_ENDPOINT'
          || lastError.code === 'AI_PROVIDER_AUTH'
          || lastError.code === 'AI_PROVIDER_BAD_REQUEST'
        ) {
          throw lastError;
        }

        attempt += 1;

        if (attempt < maxAttempts) {
          metrics.increment('llm_failures_total', { model, type: 'retry', provider: String(effectiveProviderId) });
          logger.warn({ attempt, error: lastError.message }, '[AiProviderClient] Retry');
          await sleep(500 * Math.pow(2, attempt), request.signal);
        }
      }
    }

    metrics.increment('llm_failures_total', { model, type: 'exhausted', provider: String(effectiveProviderId) });
    logger.error({ error: lastError }, '[AiProviderClient] Failed after retries');
    throw lastError;
  }
}

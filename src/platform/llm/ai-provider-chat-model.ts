import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { ChatResult } from '@langchain/core/outputs';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { AiProviderClient } from './ai-provider-client';
import type { LLMAuthSource, LLMProviderId, LLMProviderRoute, ProviderAllowedTool, ProviderToolDefinition } from './llm-types';
import { toLlmMessages, toLangChainToolCalls } from './langchain-interop';

export interface AiProviderChatModelCallOptions extends BaseChatModelCallOptions {
  baseUrl?: string;
  providerId?: LLMProviderId | string;
  apiKey?: string;
  authSource?: LLMAuthSource;
  fallbackRoute?: LLMProviderRoute;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: BindToolsInput[];
  allowedTools?: string[];
  parallelToolCalls?: boolean;
}

export interface AiProviderChatModelFields extends BaseChatModelParams {
  baseUrl: string;
  providerId?: LLMProviderId | string;
  model: string;
  apiKey?: string;
  authSource?: LLMAuthSource;
  fallbackRoute?: LLMProviderRoute;
  temperature: number;
  timeout?: number;
  maxTokens?: number;
}

function normalizeToolChoice(
  toolChoice: AiProviderChatModelCallOptions['tool_choice'],
): string | Record<string, unknown> | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (typeof toolChoice === 'string') {
    return toolChoice;
  }

  return toolChoice as Record<string, unknown>;
}

function normalizeBoundTools(tools: BindToolsInput[] | undefined): ProviderToolDefinition[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => {
    const converted = convertToOpenAITool(tool);
    return {
      type: 'function',
      function: {
        name: String(converted.function?.name ?? '').trim(),
        description:
          typeof converted.function?.description === 'string'
            ? converted.function.description
            : undefined,
        parameters:
          converted.function?.parameters &&
          typeof converted.function.parameters === 'object' &&
          !Array.isArray(converted.function.parameters)
            ? converted.function.parameters as Record<string, unknown>
            : { type: 'object', properties: {} },
      },
    };
  });
}

function normalizeAllowedTools(allowedTools: string[] | undefined): ProviderAllowedTool[] | undefined {
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return undefined;
  }

  const names = Array.from(
    new Set(
      allowedTools
        .map((toolName) => String(toolName).trim())
        .filter((toolName) => toolName.length > 0),
    ),
  );
  if (names.length === 0) {
    return undefined;
  }

  return names.map((name) => ({
    type: 'function',
    function: { name },
  }));
}

export class AiProviderChatModel extends BaseChatModel<AiProviderChatModelCallOptions> {
  lc_namespace = ['sage', 'llm'];

  private readonly modelId: string;
  private readonly baseUrl: string;
  private readonly providerId?: LLMProviderId | string;
  private readonly apiKey?: string;
  private readonly authSource?: LLMAuthSource;
  private readonly fallbackRoute?: LLMProviderRoute;
  private readonly temperature: number;
  private readonly timeoutMs?: number;
  private readonly maxTokens?: number;
  private readonly client: AiProviderClient;

  constructor(fields: AiProviderChatModelFields) {
    super(fields);
    this.baseUrl = fields.baseUrl;
    this.providerId = fields.providerId;
    this.modelId = fields.model.trim();
    this.apiKey = fields.apiKey?.trim() || undefined;
    this.authSource = fields.authSource;
    this.fallbackRoute = fields.fallbackRoute;
    this.temperature = fields.temperature;
    this.timeoutMs = fields.timeout;
    this.maxTokens = fields.maxTokens;
    this.client = new AiProviderClient({
      baseUrl: fields.baseUrl,
      apiKey: this.apiKey,
      model: this.modelId,
      timeoutMs: this.timeoutMs,
      maxRetries: 0,
    });
  }

  get callKeys(): string[] {
    return [...super.callKeys, 'baseUrl', 'providerId', 'apiKey', 'authSource', 'fallbackRoute', 'model', 'temperature', 'maxTokens', 'tools', 'tool_choice', 'allowedTools', 'parallelToolCalls'];
  }

  _llmType(): string {
    return 'sage_ai_provider_chat';
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<AiProviderChatModelCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, AiProviderChatModelCallOptions> {
    return this.withConfig({
      ...kwargs,
      tools,
    }) as Runnable<BaseLanguageModelInput, AIMessageChunk, AiProviderChatModelCallOptions>;
  }

  override _identifyingParams(): Record<string, unknown> {
    return {
      ...super._identifyingParams(),
      model: this.modelId,
      provider: 'ai_provider',
    };
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    void runManager;
    const response = await this.client.chat({
      messages: toLlmMessages(messages),
      baseUrl: options.baseUrl?.trim() || this.baseUrl,
      providerId: options.providerId ?? this.providerId,
      model: options.model?.trim() || this.modelId,
      apiKey: options.apiKey?.trim() || this.apiKey,
      authSource: options.authSource ?? this.authSource,
      fallbackRoute: options.fallbackRoute ?? this.fallbackRoute,
      temperature: options.temperature ?? this.temperature,
      maxTokens: options.maxTokens ?? this.maxTokens,
      tools: normalizeBoundTools(options.tools),
      allowedTools: normalizeAllowedTools(options.allowedTools),
      toolChoice: normalizeToolChoice(options.tool_choice),
      parallelToolCalls: options.parallelToolCalls,
      timeout: typeof options.timeout === 'number' ? options.timeout : this.timeoutMs,
      signal: options.signal,
    });

    const content =
      response.toolCalls && response.toolCalls.length > 0
        ? (response.reasoningText ?? response.text ?? '').trim()
        : (response.text ?? response.reasoningText ?? '').trim();

    const aiMessage = new AIMessage({
      content,
      tool_calls: toLangChainToolCalls(response.toolCalls),
      usage_metadata: response.usage
        ? {
          input_tokens: response.usage.promptTokens,
          output_tokens: response.usage.completionTokens,
          total_tokens: response.usage.totalTokens,
        }
        : undefined,
      response_metadata: {
        provider: 'ai_provider',
        model: options.model?.trim() || this.modelId,
        usage: response.usage,
      },
    });

    return {
      generations: [
        {
          text: content,
          message: aiMessage,
          generationInfo: {
            provider: 'ai_provider',
            toolCallCount: response.toolCalls?.length ?? 0,
          },
        },
      ],
      llmOutput: response.usage
        ? {
          tokenUsage: response.usage,
        }
        : undefined,
    };
  }
}

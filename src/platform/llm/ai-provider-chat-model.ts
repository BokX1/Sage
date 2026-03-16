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
import type { LLMResponseFormat, ToolDefinition } from './llm-types';
import { toLlmMessages, toLangChainToolCalls } from './langchain-interop';

export interface AiProviderChatModelCallOptions extends BaseChatModelCallOptions {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: LLMResponseFormat;
  tools?: BindToolsInput[];
}

export interface AiProviderChatModelFields extends BaseChatModelParams {
  baseUrl: string;
  model: string;
  apiKey?: string;
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

function normalizeBoundTools(tools: BindToolsInput[] | undefined): ToolDefinition[] | undefined {
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

export class AiProviderChatModel extends BaseChatModel<AiProviderChatModelCallOptions> {
  lc_namespace = ['sage', 'llm'];

  private readonly modelId: string;
  private readonly apiKey?: string;
  private readonly temperature: number;
  private readonly timeoutMs?: number;
  private readonly maxTokens?: number;
  private readonly client: AiProviderClient;

  constructor(fields: AiProviderChatModelFields) {
    super(fields);
    this.modelId = fields.model.trim();
    this.apiKey = fields.apiKey?.trim() || undefined;
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
    return [...super.callKeys, 'apiKey', 'model', 'temperature', 'maxTokens', 'responseFormat', 'tools', 'tool_choice'];
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
      model: options.model?.trim() || this.modelId,
      apiKey: options.apiKey?.trim() || this.apiKey,
      temperature: options.temperature ?? this.temperature,
      maxTokens: options.maxTokens ?? this.maxTokens,
      responseFormat: options.responseFormat,
      tools: normalizeBoundTools(options.tools),
      toolChoice: normalizeToolChoice(options.tool_choice),
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

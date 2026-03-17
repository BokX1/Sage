/**
 * Define supported LLM message roles.
 *
 * Details: matches the role values expected by the LLM client.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Describe a structured content part for LLM messages.
 *
 * Details: supports plain text parts and image URL references.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export type LLMContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * Define the allowed content payload for LLM messages.
 *
 * Details: either raw text or structured content parts.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export type LLMMessageContent = string | LLMContentPart[];

/**
 * Describe a single chat message sent to or from the LLM.
 *
 * Details: pairs a role with the message content.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface LLMToolCall {
  id?: string;
  name: string;
  args: unknown;
}

/**
 * Describe a single chat message sent to or from the LLM.
 *
 * Details: supports native assistant tool-call transcripts and tool-result
 * messages for compatible chat-completions providers.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface LLMChatMessage {
  role: LLMRole;
  content: LLMMessageContent;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
}

/**
 * Describe a tool definition exposed to AI providers over the compatible chat-completions contract.
 *
 * Details: conforms to the provider's function/tool schema structure.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ProviderToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderAllowedTool {
  type: 'function';
  function: {
    name: string;
  };
}

/**
 * Define a chat request sent to an LLM client.
 *
 * Details: includes message history, model selection, and tool metadata.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface LLMRequest {
  messages: LLMChatMessage[];
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ProviderToolDefinition[];
  allowedTools?: ProviderAllowedTool[];
  toolChoice?:
    | string
    | 'auto'
    | 'any'
    | 'none'
    | { type: 'function'; function: { name: string } }
    | Record<string, unknown>;
  parallelToolCalls?: boolean;
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * Describe a chat response from an LLM client.
 *
 * Details: includes reply content and optional token usage metrics.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface LLMResponse {
  text: string;
  toolCalls?: LLMToolCall[];
  reasoningText?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Define the LLM client contract used by the runtime.
 *
 * Details: callers supply a request and receive a structured response.
 *
 * Side effects: depends on implementation.
 * Error behavior: depends on implementation.
 */
export interface LLMClient {
  chat(request: LLMRequest): Promise<LLMResponse>;
}

/**
 * Identify the shared chat client contract used by Sage's non-graph flows.
 *
 * Details: implementations target provider-neutral compatible chat-completions APIs.
 *
 * Side effects: none.
 * Error behavior: none.
 */

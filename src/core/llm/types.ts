/**
 * Define supported LLM message roles.
 *
 * Details: matches the role values expected by the LLM client.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export type LLMRole = 'system' | 'user' | 'assistant';

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
export interface LLMChatMessage {
  role: LLMRole;
  content: LLMMessageContent;
}

/**
 * Describe a tool definition exposed to LLM providers.
 *
 * Details: conforms to the provider's function/tool schema structure.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
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
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
  tools?: ToolDefinition[];
  toolChoice?: string | 'auto' | 'none' | { type: 'function'; function: { name: string } };
  timeout?: number;
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
  content: string;
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
 * Identify supported LLM providers.
 *
 * Details: currently limited to the Pollinations client runtime.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export type LLMProviderName = 'pollinations';

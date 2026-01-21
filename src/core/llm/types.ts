export type LLMRole = 'system' | 'user' | 'assistant';

export type LLMContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type LLMMessageContent = string | LLMContentPart[];

export interface LLMChatMessage {
  role: LLMRole;
  content: LLMMessageContent;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

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

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMClient {
  chat(request: LLMRequest): Promise<LLMResponse>;
}

export type LLMProviderName = 'pollinations'; // Pollinations-only runtime

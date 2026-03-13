import { config } from '../config/env';
import { LLMClient } from './llm-types';
import { AiProviderClient } from './ai-provider-client';

let instance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (instance) return instance;

  instance = createLLMClient();

  return instance!;
}

export interface LLMClientOptions {
  agentModel?: string;
  apiKey?: string;
  baseUrl?: string;
}

export function createLLMClient(opts?: LLMClientOptions): LLMClient {
  return new AiProviderClient({
    baseUrl: opts?.baseUrl ?? config.AI_PROVIDER_BASE_URL,
    apiKey: opts?.apiKey ?? config.AI_PROVIDER_API_KEY,
    model: opts?.agentModel ?? config.AI_PROVIDER_MAIN_AGENT_MODEL,
  });
}

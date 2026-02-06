import { config } from '../config/legacy-config-adapter';
import { LLMClient, LLMProviderName } from './llm-types';
import { PollinationsClient } from './pollinations-client';
import { logger } from '../utils/logger';

let instance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (instance) return instance;

  const provider = (config.llmProvider || 'pollinations') as LLMProviderName;

  instance = createLLMClient(provider);

  return instance!;
}

export interface LLMClientOptions {
  chatModel?: string;
}

export function createLLMClient(provider: LLMProviderName, opts?: LLMClientOptions): LLMClient {
  switch (provider) {
    case 'pollinations':
      return new PollinationsClient({
        baseUrl: config.llmBaseUrl,
        apiKey: config.llmApiKey,
        model: opts?.chatModel ?? config.chatModel,
      });
    default:
      // Fallback for any unknown provider
      logger.warn({ provider }, 'Unknown or unset LLM_PROVIDER, defaulting to Pollinations');
      return new PollinationsClient({
        baseUrl: config.llmBaseUrl,
        apiKey: config.llmApiKey,
        model: opts?.chatModel ?? config.chatModel,
      });
  }
}

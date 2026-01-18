import { config } from '../config/env';
import { LLMClient, LLMProviderName } from './types';
import { PollinationsClient } from './providers/pollinations';
import { logger } from '../utils/logger';

let instance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (instance) return instance;

  const provider = (config.llmProvider || 'pollinations') as LLMProviderName;

  instance = createLLMClient(provider);

  return instance!;
}

export function createLLMClient(provider: LLMProviderName): LLMClient {
  switch (provider) {
    case 'pollinations':
      return new PollinationsClient({
        baseUrl: config.pollinationsBaseUrl,
        apiKey: config.pollinationsApiKey,
        model: config.pollinationsModel,
      });
    case 'gemini': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GeminiClient } = require('./providers/gemini');
      return new GeminiClient({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        baseUrl: config.geminiBaseUrl,
      });
    }
    default:
      // Fallback or no-op if no provider
      logger.warn({ provider }, 'Unknown or unset LLM_PROVIDER, defaulting to Pollinations');
      return new PollinationsClient();
  }
}

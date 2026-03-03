/**
 * @module src/core/llm/index
 * @description Defines the index module.
 */
import { config } from '../../config';
import { LLMClient, LLMProviderName } from './llm-types';
import { PollinationsClient } from './pollinations-client';
import { logger } from '../utils/logger';

let instance: LLMClient | null = null;

/**
 * Runs getLLMClient.
 *
 * @returns Returns the function result.
 */
export function getLLMClient(): LLMClient {
  if (instance) return instance;

  const provider = (config.LLM_PROVIDER || 'pollinations') as LLMProviderName;

  instance = createLLMClient(provider);

  return instance!;
}

/**
 * Represents the LLMClientOptions contract.
 */
export interface LLMClientOptions {
  chatModel?: string;
}

/**
 * Runs createLLMClient.
 *
 * @param provider - Describes the provider input.
 * @param opts - Describes the opts input.
 * @returns Returns the function result.
 */
export function createLLMClient(provider: LLMProviderName, opts?: LLMClientOptions): LLMClient {
  switch (provider) {
    case 'pollinations':
      return new PollinationsClient({
        baseUrl: config.LLM_BASE_URL,
        apiKey: config.LLM_API_KEY,
        model: opts?.chatModel ?? config.CHAT_MODEL,
      });
    default:
      // Fallback for any unknown provider
      logger.warn({ provider }, 'Unknown or unset LLM_PROVIDER, defaulting to Pollinations');
      return new PollinationsClient({
        baseUrl: config.LLM_BASE_URL,
        apiKey: config.LLM_API_KEY,
        model: opts?.chatModel ?? config.CHAT_MODEL,
      });
  }
}

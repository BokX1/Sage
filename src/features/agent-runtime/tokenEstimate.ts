import { countMessageTokens } from '../../platform/llm/context-budgeter';
import { config } from '../../platform/config/env';

/**
 * Estimate token usage from plain text length.
 *
 * @param text - Input text to estimate.
 * @returns Deterministic local tokenizer count for the configured main model.
 *
 * Invariants:
 * - Always returns at least 0.
 */
export function estimateTokens(text: string): number {
  return countMessageTokens(
    {
      role: 'user',
      content: text,
    },
    config.AI_PROVIDER_MAIN_AGENT_MODEL,
  ).totalTokens;
}

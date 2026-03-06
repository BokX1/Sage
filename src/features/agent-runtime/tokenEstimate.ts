import { config } from '../../platform/config/env';

/**
 * Estimate token usage from plain text length.
 *
 * @param text - Input text to estimate.
 * @returns Approximate token count using the configured chars-per-token heuristic.
 *
 * Invariants:
 * - Always returns at least 0.
 */
export function estimateTokens(text: string): number {
  const charsPerToken = config.TOKEN_HEURISTIC_CHARS_PER_TOKEN;
  return charsPerToken > 0 ? Math.ceil(text.length / charsPerToken) : 0;
}

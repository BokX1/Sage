/**
 * Provide a fast token estimate used by context budgeting.
 *
 * Non-goals:
 * - Produce exact provider-token counts.
 */
import { config } from '../config/env';

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
  const charsPerToken = config.tokenHeuristicCharsPerToken;
  return charsPerToken > 0 ? Math.ceil(text.length / charsPerToken) : 0;
}

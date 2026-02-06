/**
 * Provide a fast token estimate used by context budgeting.
 *
 * Non-goals:
 * - Produce exact provider-token counts.
 */
/**
 * Estimate token usage from plain text length.
 *
 * @param text - Input text to estimate.
 * @returns Approximate token count using a 4-char heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

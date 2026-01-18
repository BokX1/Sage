import { logger } from '../../utils/logger';
import type { RouteDecision } from './router';
import type { LLMClient } from '../llm/types';

export interface GovernorResult {
  finalText: string;
  actions: string[];
  flagged: boolean;
  notes?: string;
}

export interface GovernOutputParams {
  traceId: string;
  route: RouteDecision;
  draftText: string;
  llm: LLMClient;
  rewriteEnabled?: boolean;
}

const DISCORD_MAX_LENGTH = 2000;
const BANNED_PHRASES = [
  /\b(browsing|browse|search the web|google search)\b/i,
  /\b(tool|using tools|function call)\b/i,
  /\b(external api|api call)\b/i,
];

/**
 * Governor: post-check and optional rewrite for safety and policy enforcement.
 */
export async function governOutput(params: GovernOutputParams): Promise<GovernorResult> {
  const { traceId, draftText, llm, rewriteEnabled = true } = params;

  const actions: string[] = [];
  let finalText = draftText;
  let flagged = false;

  // 1. Check Discord length limit
  if (finalText.length > DISCORD_MAX_LENGTH) {
    const truncated = finalText.slice(0, DISCORD_MAX_LENGTH - 15).trim() + '\n(truncated)';
    finalText = truncated;
    actions.push('trim:discord_limit');
  }

  // 2. Check banned phrases
  let hasBannedPhrase = false;
  for (const pattern of BANNED_PHRASES) {
    if (pattern.test(finalText)) {
      hasBannedPhrase = true;
      flagged = true;
      break;
    }
  }

  // 3. Attempt rewrite if banned phrase detected
  if (hasBannedPhrase && rewriteEnabled) {
    try {
      logger.debug({ traceId }, 'Governor: banned phrase detected, attempting rewrite');

      const rewriteResponse = await llm.chat({
        messages: [
          {
            role: 'system',
            content:
              'You are a content rewriter. Rewrite the draft to remove any mentions of browsing, tools, APIs, or external searches. Keep the meaning and be concise.',
          },
          {
            role: 'user',
            content: `Draft: ${finalText}`,
          },
        ],
        maxTokens: 500,
        temperature: 0.3,
      });

      const rewritten = rewriteResponse.content.trim();
      if (rewritten.length > 0 && rewritten.length <= DISCORD_MAX_LENGTH) {
        finalText = rewritten;
        actions.push('rewrite:banned_phrase');
      } else {
        // Fallback: simple trim
        const fallback = finalText
          .replace(/\b(browsing|browse|search the web|google search)\b/gi, '[redacted]')
          .replace(/\b(tool|using tools|function call)\b/gi, '[redacted]')
          .slice(0, DISCORD_MAX_LENGTH - 15)
          .trim();
        finalText = fallback;
        actions.push('fallback:banned_phrase_trim');
      }
    } catch (error) {
      logger.warn({ error, traceId }, 'Governor rewrite failed, using fallback trim');
      const fallback = finalText
        .replace(/\b(browsing|browse|search the web|google search)\b/gi, '[redacted]')
        .slice(0, DISCORD_MAX_LENGTH - 15)
        .trim();
      finalText = fallback;
      actions.push('fallback:rewrite_error');
    }
  }

  return {
    finalText,
    actions,
    flagged,
    notes: actions.length > 0 ? `Governor actions: ${actions.join(', ')}` : undefined,
  };
}

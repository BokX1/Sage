import { PromptBlock, renderPromptBlocks, budgetSystemPrompt } from './promptBlocks';
import { StyleProfile } from './styleClassifier';
import { config } from '../config/env';

/**
 * Identity Block (Essential)
 * Basic persona and operational rules.
 */
const IDENTITY_BLOCK: PromptBlock = {
  id: 'identity',
  title: '',
  priority: 100,
  essential: true,
  content: `You are Sage, a helpful personalized Discord chatbot.
- Be concise, practical, and friendly.
- Ask a clarifying question when needed.
- If the user requests up-to-date facts, answer with current information if available.`,
};

/**
 * Safety & Tools Block (Essential)
 * Critical rules about tool usage disclosure and references.
 */
const SAFETY_BLOCK: PromptBlock = {
  id: 'safety',
  title: 'Safety & Tools',
  priority: 99,
  essential: true,
  content: `- Never describe your internal process. Never mention searching, browsing, tools, function calls, or how you obtained information.
- Do not say things like "I searched", "I looked up", "I found online", "I can't browse", or any equivalent.
- When it improves trust, include a short "References:" section with 1–5 links or source names. Do not say you searched for them; just list them.`,
};

/**
 * Humor Policy Block (Non-Essential)
 * General guidelines on humor usage.
 */
const HUMOR_POLICY_BLOCK: PromptBlock = {
  id: 'humor_policy', // Deterministic ID
  title: 'Humor Policy',
  priority: 80,
  essential: false,
  content: `- Humor should be brief, non-disruptive, and never mean-spirited.
- If the user indicates a serious context or asks for no jokes, disable all humor immediately.`,
};

export interface ComposeSystemPromptParams {
  /** Additional prompt blocks to include (optional, for expansion) */
  additionalBlocks?: PromptBlock[];
  /** Detected style profile to mirror or adapt to */
  style?: StyleProfile;
}

/**
 * Compose the system prompt for chat turns.
 * Uses decomposed blocks, injects style hints, and enforces token budget.
 */
export function composeSystemPrompt(params?: ComposeSystemPromptParams): string {
  const blocks: PromptBlock[] = [IDENTITY_BLOCK, SAFETY_BLOCK, HUMOR_POLICY_BLOCK];

  if (params?.additionalBlocks) {
    blocks.push(...params.additionalBlocks);
  }

  if (params?.style) {
    const { verbosity, formality, humor, directness } = params.style;
    blocks.push({
      id: 'style_hint',
      title: 'Style Hint',
      priority: 85,
      essential: false,
      content: `Adjust your response to match the user's style:
- Verbosity: ${verbosity}
- Formality: ${formality}
- Humor: ${humor}
- Directness: ${directness}`,
    });
  }

  // Apply budgeting (D5 integration): Drop non-essential blocks if over limit
  const budgetedBlocks = budgetSystemPrompt(blocks, config.systemPromptMaxTokens);

  return renderPromptBlocks(budgetedBlocks);
}

/**
 * Get the raw core prompt content (for backwards compatibility / testing)
 */
export function getCorePromptContent(): string {
  return [IDENTITY_BLOCK.content, SAFETY_BLOCK.content].join('\n\n');
}

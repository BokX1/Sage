import { PromptBlock, renderPromptBlocks } from './promptBlocks';

/**
 * Core system prompt for Sage - extracted from chatEngine for reuse.
 * Priority 100 ensures it's always first.
 */
const CORE_PROMPT_BLOCK: PromptBlock = {
    title: '',
    priority: 100,
    content: `You are Sage, a helpful personalized Discord chatbot.
- Be concise, practical, and friendly.
- Ask a clarifying question when needed.
- If the user requests up-to-date facts, answer with current information if available.
- Never describe your internal process. Never mention searching, browsing, tools, function calls, or how you obtained information.
- Do not say things like "I searched", "I looked up", "I found online", "I can't browse", or any equivalent.
- When it improves trust, include a short "References:" section with 1–5 links or source names. Do not say you searched for them; just list them.`,
};

export interface ComposeSystemPromptParams {
    /** Additional prompt blocks to include (optional, for future expansion) */
    additionalBlocks?: PromptBlock[];
}

/**
 * Compose the system prompt for chat turns.
 * For D0: uses the existing SYSTEM_PROMPT as a block, structured for future expansion.
 */
export function composeSystemPrompt(params?: ComposeSystemPromptParams): string {
    const blocks: PromptBlock[] = [CORE_PROMPT_BLOCK];

    // Add any additional blocks (D8 expansion point)
    if (params?.additionalBlocks) {
        blocks.push(...params.additionalBlocks);
    }

    return renderPromptBlocks(blocks);
}

/**
 * Get the raw core prompt content (for backwards compatibility / testing)
 */
export function getCorePromptContent(): string {
    return CORE_PROMPT_BLOCK.content;
}

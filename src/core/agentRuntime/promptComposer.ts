/**
 * Compose the base system prompt for agent-runtime calls.
 *
 * Responsibilities:
 * - Merge static identity text with dynamic profile/style context.
 * - Keep prompt sections stable for downstream context assembly.
 *
 * Non-goals:
 * - Enforce token budgets.
 * - Inject transcript or context packet content.
 */
import { StyleProfile } from './styleClassifier';

/** Configure profile and style inputs for system prompt composition. */
export interface ComposeSystemPromptParams {
  userProfileSummary: string | null;
  style?: StyleProfile;
}

/**
 * Compose the runtime system prompt text.
 *
 * @param params - User profile summary and optional style profile.
 * @returns Prompt string containing identity, user context, and interaction mode.
 *
 * Side effects:
 * - None.
 *
 * Error behavior:
 * - Never throws.
 *
 * Invariants:
 * - Output always includes all core sections in stable order.
 */
export function composeSystemPrompt(params: ComposeSystemPromptParams): string {
  const { userProfileSummary, style } = params;

  const baseIdentity = `You are Sage, an autonomous, context-aware Discord agent.
You remember conversations, track relationships, and generate personalized responses.`;

  const memorySection = userProfileSummary
    ? `## User Context\n${userProfileSummary}`
    : `## User Context\n(No specific user data available yet)`;

  let styleInstructions = 'Response style: Concise, helpful, and friendly.';

  if (style) {
    const { verbosity, formality, humor, directness } = style;
    styleInstructions = `Response style:
- Verbosity: ${verbosity}
- Formality: ${formality}
- Humor: ${humor}
- Directness: ${directness}`;
  }

  const modeSection = `## Current Interaction Mode\n${styleInstructions}`;

  const prioritySection = `## Priority Instruction
**Interaction Mode adapts to the immediate conversation, but NEVER violate User Context preferences.**`;

  return [baseIdentity, memorySection, modeSection, prioritySection].join('\n\n');
}

/**
 * Return base prompt content without per-user profile state.
 *
 * @returns Static core prompt text.
 */
export function getCorePromptContent(): string {
  return composeSystemPrompt({ userProfileSummary: null });
}

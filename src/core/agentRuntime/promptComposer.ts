import { StyleProfile } from './styleClassifier';

/**
 * Define inputs for composing the system prompt.
 *
 * Details: the profile summary and style hints shape the final prompt content.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface ComposeSystemPromptParams {
  userProfileSummary: string | null;
  style?: StyleProfile;
}

/**
 * Compose the system prompt for the LLM.
 *
 * Details: combines base identity, user context, interaction mode, and
 * priority instructions into a single system message.
 *
 * Side effects: none.
 * Error behavior: none.
 *
 * @param params - Prompt composition inputs.
 * @returns System prompt content.
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
 * Provide a legacy-compatible core prompt.
 *
 * Details: returns a system prompt without user profile context.
 *
 * Side effects: none.
 * Error behavior: none.
 *
 * @returns Core prompt content.
 */
export function getCorePromptContent(): string {
  return composeSystemPrompt({ userProfileSummary: null });
}

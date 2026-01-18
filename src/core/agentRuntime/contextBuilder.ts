import { LLMChatMessage } from '../llm/types';
import { composeSystemPrompt } from './promptComposer';

export interface BuildContextMessagesParams {
    /** User profile summary for personalization (may be null) */
    userProfileSummary: string | null;
    /** Previous bot message the user is replying to (may be null) */
    replyToBotText: string | null;
    /** The user's current message text */
    userText: string;
    /** Recent channel transcript block */
    recentTranscript?: string | null;

    // ================================================================
    // TODO (D2/D4/D5): Future context expansion points
    // ----------------------------------------------------------------
    // recentTranscript?: LLMChatMessage[];  // D2: recent channel messages
    // channelSummary?: string;               // D4: channel context summary
    // relationshipHints?: string;            // D5: user relationship indicators
    // ================================================================
}

/**
 * Build the context messages array for an LLM chat turn.
 * Output ordering matches current chatEngine behavior:
 *   1. system (base prompt)
 *   2. system (personalization memory) if present
 *   3. assistant (replyToBotText) if present
 *   4. user (userText)
 */
export function buildContextMessages(params: BuildContextMessagesParams): LLMChatMessage[] {
    const { userProfileSummary, replyToBotText, userText, recentTranscript } = params;

    const messages: LLMChatMessage[] = [];

    // 1. Base system prompt
    messages.push({
        role: 'system',
        content: composeSystemPrompt(),
    });

    // 2. Personalization memory (if present)
    if (userProfileSummary) {
        messages.push({
            role: 'system',
            content: `Personalization memory (may be incomplete): ${userProfileSummary}`,
        });
    }

    // 2b. Recent channel transcript (if present)
    if (recentTranscript) {
        messages.push({
            role: 'system',
            content: recentTranscript,
        });
    }

    // 3. Previous bot message context (if replying to bot)
    if (replyToBotText) {
        messages.push({
            role: 'assistant',
            content: replyToBotText,
        });
    }

    // 4. User message
    messages.push({
        role: 'user',
        content: userText,
    });

    return messages;
}

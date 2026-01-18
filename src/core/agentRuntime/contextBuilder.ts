import { LLMChatMessage } from '../llm/types';
import { composeSystemPrompt } from './promptComposer';
import { config } from '../config/env';
import { budgetContextBlocks, ContextBlock } from './contextBudgeter';

export interface BuildContextMessagesParams {
    /** User profile summary for personalization (may be null) */
    userProfileSummary: string | null;
    /** Channel rolling summary (may be null) */
    channelRollingSummary?: string | null;
    /** Channel profile summary (may be null) */
    channelProfileSummary?: string | null;
    /** Previous bot message the user is replying to (may be null) */
    replyToBotText: string | null;
    /** The user's current message text */
    userText: string;
    /** Recent channel transcript block */
    recentTranscript?: string | null;
    /** Optional intent hint for the request */
    intentHint?: string | null;

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
 *   2. system (truncation notice) if needed
 *   3. system (personalization memory) if present
 *   4. system (channel profile summary) if present
 *   5. system (channel rolling summary) if present
 *   6. system (recent transcript) if present
 *   7. system (intent hint) if present
 *   8. assistant (replyToBotText) if present
 *   9. user (userText)
 */
export function buildContextMessages(params: BuildContextMessagesParams): LLMChatMessage[] {
    const {
        userProfileSummary,
        channelRollingSummary,
        channelProfileSummary,
        replyToBotText,
        userText,
        recentTranscript,
        intentHint,
    } = params;

    const blocks: ContextBlock[] = [
        {
            id: 'base_system',
            role: 'system',
            content: composeSystemPrompt(),
            priority: 100,
            truncatable: false,
        },
    ];

    if (userProfileSummary) {
        blocks.push({
            id: 'memory',
            role: 'system',
            content: `Personalization memory (may be incomplete): ${userProfileSummary}`,
            priority: 90,
            hardMaxTokens: config.contextBlockMaxTokensMemory,
            truncatable: true,
        });
    }

    if (channelProfileSummary) {
        blocks.push({
            id: 'profile_summary',
            role: 'system',
            content: channelProfileSummary,
            priority: 70,
            hardMaxTokens: config.contextBlockMaxTokensProfileSummary,
            truncatable: true,
        });
    }

    if (channelRollingSummary) {
        blocks.push({
            id: 'rolling_summary',
            role: 'system',
            content: channelRollingSummary,
            priority: 60,
            hardMaxTokens: config.contextBlockMaxTokensRollingSummary,
            truncatable: true,
        });
    }

    if (recentTranscript) {
        blocks.push({
            id: 'transcript',
            role: 'system',
            content: recentTranscript,
            priority: 50,
            hardMaxTokens: config.contextBlockMaxTokensTranscript,
            truncatable: true,
        });
    }

    if (intentHint) {
        blocks.push({
            id: 'intent_hint',
            role: 'system',
            content: `Intent hint: ${intentHint}`,
            priority: 45,
            hardMaxTokens: config.contextBlockMaxTokensReplyContext,
            truncatable: true,
        });
    }

    if (replyToBotText) {
        blocks.push({
            id: 'reply_context',
            role: 'assistant',
            content: replyToBotText,
            priority: 40,
            hardMaxTokens: config.contextBlockMaxTokensReplyContext,
            truncatable: true,
        });
    }

    blocks.push({
        id: 'user',
        role: 'user',
        content: userText,
        priority: 110,
        hardMaxTokens: config.contextUserMaxTokens,
        truncatable: true,
    });

    const budgetedBlocks = budgetContextBlocks(blocks, {
        maxInputTokens: config.contextMaxInputTokens,
        reservedOutputTokens: config.contextReservedOutputTokens,
        truncationNoticeEnabled: config.contextTruncationNotice,
    });

    return budgetedBlocks.map((block) => ({
        role: block.role,
        content: block.content,
    }));
}

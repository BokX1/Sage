import { getLLMClient } from '../llm';
import { config } from '../config/env';
import { LLMChatMessage } from '../llm/types';
import { logger } from '../utils/logger';
import { buildContextMessages } from './contextBuilder';
import { globalToolRegistry } from './toolRegistry';
import { runToolCallLoop, ToolCallLoopResult } from './toolCallLoop';

/**
 * Google Search tool definition for OpenAI/Pollinations format.
 * Kept here to match existing chatEngine behavior.
 */
const GOOGLE_SEARCH_TOOL = {
    type: 'function',
    function: {
        name: 'google_search',
        description:
            'Search the web for real-time information. Use this whenever the user asks for current facts, news, or topics you do not know.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query string.',
                },
            },
            required: ['query'],
        },
    },
};

export interface RunChatTurnParams {
    traceId: string;
    userId: string;
    channelId: string;
    messageId: string;
    userText: string;
    /** User profile summary for personalization */
    userProfileSummary: string | null;
    /** Previous bot message if user is replying to bot */
    replyToBotText: string | null;
}

export interface RunChatTurnResult {
    replyText: string;
    debug?: {
        toolsExecuted?: boolean;
        toolLoopResult?: ToolCallLoopResult;
        messages?: LLMChatMessage[];
    };
}

/**
 * Run a single chat turn through the agent runtime.
 * This is the main orchestration entrypoint.
 *
 * Flow:
 * 1. Build context messages (system prompt + personalization + conversation context)
 * 2. Call LLM client (same provider logic as chatEngine)
 * 3. If response is tool_calls envelope, run tool loop
 * 4. Return final reply
 */
export async function runChatTurn(params: RunChatTurnParams): Promise<RunChatTurnResult> {
    const { traceId, userId, channelId, userText, userProfileSummary, replyToBotText } = params;

    // 1. Build context messages
    const messages = buildContextMessages({
        userProfileSummary,
        replyToBotText,
        userText,
    });

    logger.debug({ traceId, messages }, 'Agent runtime: built context messages');

    // 2. Get LLM client and configure tools
    const client = getLLMClient();
    const isGeminiNative = config.llmProvider === 'gemini';
    const isPollinations = config.llmProvider === 'pollinations';

    // Build native search tools (same as existing chatEngine)
    const nativeTools: unknown[] = [];
    if (isGeminiNative) {
        nativeTools.push({ googleSearch: {} });
    } else if (isPollinations) {
        nativeTools.push(GOOGLE_SEARCH_TOOL);
    }

    // 3. Initial LLM call
    let replyText = '';
    try {
        const response = await client.chat({
            messages,
            model: isGeminiNative ? config.geminiModel : undefined,
            tools: nativeTools.length > 0 ? nativeTools : undefined,
            toolChoice: isGeminiNative || isPollinations ? 'auto' : undefined,
            temperature: 0.7,
        });

        replyText = response.content;

        // 4. Check if response is a tool_calls envelope for custom tools
        // Only process if we have custom tools registered
        if (globalToolRegistry.listNames().length > 0) {
            // Check if this looks like a tool call envelope
            const trimmed = replyText.trim();
            const strippedFence = trimmed.startsWith('```')
                ? trimmed.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '')
                : trimmed;

            try {
                const parsed = JSON.parse(strippedFence);
                if (parsed?.type === 'tool_calls' && Array.isArray(parsed?.calls)) {
                    // Run tool call loop
                    logger.debug({ traceId }, 'Agent runtime: detected tool_calls envelope, running loop');

                    const toolLoopResult = await runToolCallLoop({
                        client,
                        messages,
                        registry: globalToolRegistry,
                        ctx: { traceId, userId, channelId },
                        model: isGeminiNative ? config.geminiModel : undefined,
                    });

                    return {
                        replyText: toolLoopResult.replyText,
                        debug: {
                            toolsExecuted: toolLoopResult.toolsExecuted,
                            toolLoopResult,
                            messages,
                        },
                    };
                }
            } catch {
                // Not JSON, treat as normal response
            }
        }
    } catch (err) {
        logger.error({ error: err, traceId }, 'Agent runtime: LLM call error');
        return {
            replyText: "I'm having trouble connecting right now. Please try again later.",
        };
    }

    return {
        replyText,
        debug: { messages },
    };
}

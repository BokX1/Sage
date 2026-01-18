import { LLMChatMessage, LLMClient } from '../llm/types';
import { ToolRegistry, ToolExecutionContext } from './toolRegistry';
import { logger } from '../utils/logger';

/** Tool call envelope format for provider-agnostic tool usage */
export interface ToolCallEnvelope {
    type: 'tool_calls';
    calls: Array<{
        name: string;
        args: Record<string, unknown>;
    }>;
}

/** Tool execution result */
export interface ToolResult {
    name: string;
    success: boolean;
    result?: unknown;
    error?: string;
}

/** Configuration for the tool call loop */
export interface ToolCallLoopConfig {
    /** Maximum number of tool rounds (default: 2) */
    maxRounds?: number;
    /** Maximum tool calls per round (default: 3) */
    maxCallsPerRound?: number;
    /** Tool execution timeout in ms (default: 10000) */
    toolTimeoutMs?: number;
}

const DEFAULT_CONFIG: Required<ToolCallLoopConfig> = {
    maxRounds: 2,
    maxCallsPerRound: 3,
    toolTimeoutMs: 10_000,
};

/** Deterministic retry prompt for invalid JSON */
const RETRY_PROMPT = `Your previous response was not valid JSON. Output ONLY valid JSON matching the exact schema:
{
  "type": "tool_calls",
  "calls": [{ "name": "<tool_name>", "args": { ... } }]
}
OR respond with a plain text answer if you don't need to use tools.`;

/**
 * Strip markdown code fences from a response.
 */
function stripCodeFences(text: string): string {
    // Remove ```json ... ``` or ``` ... ```
    const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
    const match = text.trim().match(fencePattern);
    return match ? match[1].trim() : text.trim();
}

/**
 * Check if text looks like it might be JSON (for retry logic).
 */
function looksLikeJson(text: string): boolean {
    const trimmed = text.trim();
    return (
        (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
        (trimmed.includes('"type"') || trimmed.includes('"name"') || trimmed.includes('"calls"'))
    );
}

/**
 * Try to parse a tool call envelope from LLM response.
 */
function parseToolCallEnvelope(text: string): ToolCallEnvelope | null {
    try {
        const stripped = stripCodeFences(text);
        const parsed = JSON.parse(stripped);

        // Validate envelope structure
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            parsed.type === 'tool_calls' &&
            Array.isArray(parsed.calls)
        ) {
            // Validate each call has name and args
            const validCalls = parsed.calls.every(
                (c: unknown) =>
                    typeof c === 'object' &&
                    c !== null &&
                    typeof (c as { name?: unknown }).name === 'string' &&
                    typeof (c as { args?: unknown }).args === 'object',
            );
            if (validCalls) {
                return parsed as ToolCallEnvelope;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Execute a single tool with timeout.
 */
async function executeToolWithTimeout(
    registry: ToolRegistry,
    call: { name: string; args: unknown },
    ctx: ToolExecutionContext,
    timeoutMs: number,
): Promise<ToolResult> {
    const timeoutPromise = new Promise<ToolResult>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool "${call.name}" timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const executionPromise = registry.executeValidated(call, ctx).then((result) => ({
        name: call.name,
        success: result.success,
        result: result.success ? result.result : undefined,
        error: result.success ? undefined : result.error,
    }));

    try {
        return await Promise.race([executionPromise, timeoutPromise]);
    } catch (err) {
        return {
            name: call.name,
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * Format tool results as a message for the LLM.
 */
function formatToolResultsMessage(results: ToolResult[]): LLMChatMessage {
    const content = results
        .map((r) => {
            if (r.success) {
                return `Tool "${r.name}" result: ${JSON.stringify(r.result)}`;
            }
            return `Tool "${r.name}" error: ${r.error}`;
        })
        .join('\n');

    return {
        role: 'user', // Tool results as user message for compatibility
        content: `[Tool Results]\n${content}`,
    };
}

export interface ToolCallLoopParams {
    /** LLM client to use */
    client: LLMClient;
    /** Initial messages (system + context) */
    messages: LLMChatMessage[];
    /** Tool registry with registered tools */
    registry: ToolRegistry;
    /** Execution context for tools */
    ctx: ToolExecutionContext;
    /** LLM model to use (optional) */
    model?: string;
    /** Configuration overrides */
    config?: ToolCallLoopConfig;
}

export interface ToolCallLoopResult {
    /** Final reply text from the LLM */
    replyText: string;
    /** Whether tools were executed */
    toolsExecuted: boolean;
    /** Number of tool rounds completed */
    roundsCompleted: number;
    /** All tool results from all rounds */
    toolResults: ToolResult[];
}

/**
 * Run the tool call loop.
 * Handles provider-agnostic tool calls via JSON envelope format.
 */
export async function runToolCallLoop(params: ToolCallLoopParams): Promise<ToolCallLoopResult> {
    const { client, registry, ctx, model } = params;
    const config = { ...DEFAULT_CONFIG, ...params.config };

    const messages = [...params.messages];
    let roundsCompleted = 0;
    const allToolResults: ToolResult[] = [];
    let retryAttempted = false;

    while (roundsCompleted < config.maxRounds) {
        // Call LLM
        const response = await client.chat({
            messages,
            model,
            temperature: 0.7,
        });

        const responseText = response.content;

        // Try to parse as tool call envelope
        let envelope = parseToolCallEnvelope(responseText);

        // Deterministic retry: if parse fails but looks like JSON, retry once
        if (!envelope && !retryAttempted && looksLikeJson(responseText)) {
            retryAttempted = true;
            logger.debug({ responseText: responseText.slice(0, 200) }, 'JSON parse failed, attempting retry');

            messages.push({ role: 'assistant', content: responseText });
            messages.push({ role: 'user', content: RETRY_PROMPT });

            const retryResponse = await client.chat({
                messages,
                model,
                temperature: 0,
            });

            envelope = parseToolCallEnvelope(retryResponse.content);

            if (!envelope) {
                // Still not valid, treat as final answer
                return {
                    replyText: retryResponse.content,
                    toolsExecuted: false,
                    roundsCompleted,
                    toolResults: allToolResults,
                };
            }
        }

        // Not a tool call envelope - treat as final answer
        if (!envelope) {
            return {
                replyText: responseText,
                toolsExecuted: allToolResults.length > 0,
                roundsCompleted,
                toolResults: allToolResults,
            };
        }

        // Enforce max calls per round
        const calls = envelope.calls.slice(0, config.maxCallsPerRound);
        if (envelope.calls.length > config.maxCallsPerRound) {
            logger.warn(
                { requested: envelope.calls.length, limit: config.maxCallsPerRound },
                'Truncating tool calls to limit',
            );
        }

        // Execute tools with timeout
        const roundResults: ToolResult[] = [];
        for (const call of calls) {
            const result = await executeToolWithTimeout(registry, call, ctx, config.toolTimeoutMs);
            roundResults.push(result);
        }

        allToolResults.push(...roundResults);
        roundsCompleted++;

        // Append tool call and results to messages
        messages.push({ role: 'assistant', content: responseText });
        messages.push(formatToolResultsMessage(roundResults));
    }

    // Max rounds reached, get final answer
    const finalResponse = await client.chat({
        messages,
        model,
        temperature: 0.7,
    });

    return {
        replyText: finalResponse.content,
        toolsExecuted: allToolResults.length > 0,
        roundsCompleted,
        toolResults: allToolResults,
    };
}

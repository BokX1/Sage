import { config as appConfig } from '../../config';
import { config as llmConfig } from '../config/env';
import { getLLMClient, createLLMClient } from '../llm';
import { LLMChatMessage, LLMClient, LLMRequest } from '../llm/types';
import { logger } from '../utils/logger';
import { ChannelMessage } from '../awareness/types';

const MAX_INPUT_MESSAGES = 120;
const MAX_INPUT_CHARS = 12_000;

export interface StructuredSummary {
    windowStart: Date;
    windowEnd: Date;
    summaryText: string;
    topics: string[];
    threads: string[];
    unresolved: string[];
    glossary: Record<string, string>;
}

export async function summarizeChannelWindow(params: {
    messages: ChannelMessage[];
    windowStart: Date;
    windowEnd: Date;
}): Promise<StructuredSummary> {
    const boundedMessages = boundMessages(params.messages, params.windowStart, params.windowEnd);
    const prompt = buildWindowPrompt({
        messages: boundedMessages,
        windowStart: params.windowStart,
        windowEnd: params.windowEnd,
    });

    return summarizeWithPrompt({
        prompt,
        windowStart: params.windowStart,
        windowEnd: params.windowEnd,
    });
}

export async function summarizeChannelProfile(params: {
    previousSummary: StructuredSummary | null;
    latestRollingSummary: StructuredSummary;
}): Promise<StructuredSummary> {
    const prompt = buildProfilePrompt(params.previousSummary, params.latestRollingSummary);
    const windowStart = params.previousSummary?.windowStart ?? params.latestRollingSummary.windowStart;
    const windowEnd = params.latestRollingSummary.windowEnd;

    return summarizeWithPrompt({
        prompt,
        windowStart,
        windowEnd,
    });
}

function boundMessages(
    messages: ChannelMessage[],
    windowStart: Date,
    windowEnd: Date,
): ChannelMessage[] {
    const filtered = messages.filter(
        (message) =>
            message.timestamp.getTime() >= windowStart.getTime() &&
            message.timestamp.getTime() <= windowEnd.getTime(),
    );
    if (filtered.length <= MAX_INPUT_MESSAGES) {
        return filtered;
    }
    return filtered.slice(filtered.length - MAX_INPUT_MESSAGES);
}

function buildWindowPrompt(params: {
    messages: ChannelMessage[];
    windowStart: Date;
    windowEnd: Date;
}): string {
    const header = `Window: ${params.windowStart.toISOString()} to ${params.windowEnd.toISOString()}`;
    const lines = buildMessageLines(params.messages);

    return `${header}\nMessages:\n${lines || '(no messages)'}`;
}

function buildProfilePrompt(
    previousSummary: StructuredSummary | null,
    latestRollingSummary: StructuredSummary,
): string {
    const previousText = previousSummary?.summaryText ?? '(none)';
    const latestText = latestRollingSummary.summaryText || '(none)';

    return `Previous long-term profile summary:\n${previousText}\n\nLatest rolling summary:\n${latestText}\n\nUpdate the long-term profile summary for this channel.`;
}

function buildMessageLines(messages: ChannelMessage[]): string {
    let totalChars = 0;
    const lines: string[] = [];

    for (const message of messages) {
        const line = `- [${message.timestamp.toISOString()}] @${message.authorDisplayName}: ${message.content}`;
        const nextTotal = totalChars + line.length + 1;
        if (nextTotal > MAX_INPUT_CHARS) {
            break;
        }
        lines.push(line);
        totalChars = nextTotal;
    }

    return lines.join('\n');
}

async function summarizeWithPrompt(params: {
    prompt: string;
    windowStart: Date;
    windowEnd: Date;
}): Promise<StructuredSummary> {
    const { client, provider } = getSummaryClient();
    const systemPrompt = buildSystemPrompt();

    const messages: LLMChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: params.prompt },
    ];

    try {
        const json = await tryChat(client, messages, provider, false);
        return normalizeSummary(json, params.windowStart, params.windowEnd);
    } catch (error) {
        logger.warn({ error }, 'Channel summary: JSON parse failed after retry');
        return fallbackSummary(params.prompt, params.windowStart, params.windowEnd);
    }
}

function buildSystemPrompt(): string {
    return `You are a summarization engine for Discord channels.\nReturn ONLY valid JSON with keys: summaryText, topics, threads, unresolved, glossary.\nRules:\n- summaryText: 3-6 sentences, concise, <= ${appConfig.SUMMARY_MAX_CHARS} characters.\n- topics/threads/unresolved: arrays of short strings (max 6 each).\n- glossary: object mapping names/projects to short descriptions (max 6 entries).\n- If a field has no items, return an empty array/object.\n- Do not include markdown or extra text.`;
}

function getSummaryClient(): { client: LLMClient; provider: 'pollinations' | 'gemini' | 'noop' } {
    const providerOverride = appConfig.SUMMARY_PROVIDER?.trim();
    if (!providerOverride || providerOverride === llmConfig.llmProvider) {
        return {
            client: getLLMClient(),
            provider: llmConfig.llmProvider as 'pollinations' | 'gemini' | 'noop',
        };
    }

    const provider = providerOverride as 'pollinations' | 'gemini' | 'noop';
    return { client: createLLMClient(provider), provider };
}

async function tryChat(
    client: LLMClient,
    messages: LLMChatMessage[],
    provider: 'pollinations' | 'gemini' | 'noop',
    retry: boolean,
): Promise<Record<string, unknown>> {
    const isGeminiNative = provider === 'gemini';

    const payload: LLMRequest = {
        messages,
        model: isGeminiNative ? llmConfig.geminiModel : undefined,
        responseFormat: retry ? undefined : 'json_object',
        maxTokens: 1024,
        temperature: 0,
    };

    if (retry) {
        const strict =
            '\n\nIMPORTANT: Output ONLY valid JSON. No markdown. No extra text.';
        const last = messages[messages.length - 1];
        if (last) {
            payload.messages = [
                ...messages.slice(0, -1),
                { role: last.role, content: last.content + strict },
            ];
        }
    }

    const response = await client.chat(payload);
    const content = response.content.replace(/```json\n?|\n?```/g, '').trim();

    try {
        return JSON.parse(content);
    } catch (error) {
        if (!retry) {
            logger.warn('Channel summary: invalid JSON, retrying once');
            return tryChat(client, messages, provider, true);
        }
        throw error;
    }
}

function normalizeSummary(
    json: Record<string, unknown>,
    windowStart: Date,
    windowEnd: Date,
): StructuredSummary {
    const summaryText = normalizeSummaryText(json.summaryText);
    return {
        windowStart,
        windowEnd,
        summaryText,
        topics: normalizeStringArray(json.topics),
        threads: normalizeStringArray(json.threads),
        unresolved: normalizeStringArray(json.unresolved),
        glossary: normalizeGlossary(json.glossary),
    };
}

function normalizeSummaryText(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        return '(no summary available)';
    }
    if (text.length <= appConfig.SUMMARY_MAX_CHARS) {
        return text;
    }
    return text.slice(0, appConfig.SUMMARY_MAX_CHARS);
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 6);
}

function normalizeGlossary(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') return {};
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key, val]) => typeof key === 'string' && typeof val === 'string')
        .slice(0, 6);

    return Object.fromEntries(entries.map(([key, val]) => [key, String(val).trim()]));
}

function fallbackSummary(prompt: string, windowStart: Date, windowEnd: Date): StructuredSummary {
    const raw = prompt.replace(/\s+/g, ' ').trim();
    const summaryText = raw.length > appConfig.SUMMARY_MAX_CHARS
        ? raw.slice(0, appConfig.SUMMARY_MAX_CHARS)
        : raw;

    return {
        windowStart,
        windowEnd,
        summaryText: summaryText || '(summary unavailable)',
        topics: [],
        threads: [],
        unresolved: [],
        glossary: {},
    };
}

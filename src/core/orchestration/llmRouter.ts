import { ExpertName } from './experts/types';
import { createLLMClient } from '../llm';
import { LLMChatMessage } from '../llm/types';
import { logger } from '../utils/logger';

// Router model: gemini-fast for low-cost, high-throughput classification
const ROUTER_MODEL = 'gemini-fast';
const ROUTER_TEMPERATURE = 0.1;
const ROUTER_TIMEOUT_MS = 45_000;

export type RouteKind =
    | 'summarize'
    | 'qa'
    | 'admin'
    | 'voice_analytics'
    | 'social_graph'
    | 'memory';

export interface RouteDecision {
    kind: RouteKind;
    experts: ExpertName[];
    allowTools: boolean;
    temperature: number;
    reasoningText?: string;
}

export interface LLMRouterParams {
    userText: string;
    invokedBy: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
    hasGuild: boolean;
    conversationHistory?: LLMChatMessage[];
    apiKey?: string;
}

const ROUTER_SYSTEM_PROMPT = `You are an intent classifier for a Discord bot called Sage.

Your task: Analyze the user's message and conversation history to determine the correct route.

## Available Routes

| Route | When to use | Experts | Temperature |
|-------|-------------|---------|-------------|
| summarize | User wants a recap, summary, TLDR, or "what happened" | Summarizer, Memory | 0.3 |
| voice_analytics | User asks who is in voice, how long in voice, VC status | VoiceAnalytics, Memory | 0.5 |
| social_graph | User asks about relationships, who knows whom, connections | SocialGraph, Memory | 0.5 |
| memory | User asks "what do you know about me", their profile, preferences | Memory | 0.6 |
| admin | User is configuring settings or this is a slash command | SocialGraph, VoiceAnalytics, Memory | 0.4 |
| qa | Default for general chat, questions, requests | Memory | 0.8 |

## Critical Instructions

1. **Pronoun Resolution**: If the user says "them", "him", "those", "that", look at conversation history to understand what they're referring to.
2. **Multi-expert Selection**: For complex queries, you can select multiple experts (e.g., Voice + Social for "who hangs out in voice with me")
3. **Follow-up Detection**: If the user says "tell me more" or "what about", route based on the PREVIOUS topic, not the literal text.

## Output Format

Respond with ONLY a JSON object:
{
  "route": "<route_kind>",
  "experts": ["<expert1>", "<expert2>"],
  "reasoning": "<one sentence explaining why you chose this route>",
  "temperature": <number>
}

Valid experts: Summarizer, SocialGraph, Memory, VoiceAnalytics`;

const DEFAULT_QA_ROUTE: RouteDecision = {
    kind: 'qa',
    experts: ['Memory'],
    allowTools: true,
    temperature: 0.8,
    reasoningText: 'Default Q&A route (fallback)',
};

interface RouterLLMResponse {
    route?: string;
    experts?: string[];
    reasoning?: string;
    temperature?: number;
}

/**
 * LLM-based intent classifier.
 * Uses Gemini Flash Lite for low-cost, contextual routing.
 */
export async function decideRoute(params: LLMRouterParams): Promise<RouteDecision> {
    const { userText, invokedBy, hasGuild, conversationHistory, apiKey } = params;

    // Fast path: admin route for slash commands
    if (invokedBy === 'command' && hasGuild) {
        return {
            kind: 'admin',
            experts: ['SocialGraph', 'VoiceAnalytics', 'Memory'],
            allowTools: true,
            temperature: 0.4,
            reasoningText: 'Slash command context detected',
        };
    }

    try {
        const client = createLLMClient('pollinations', { pollinationsModel: ROUTER_MODEL });

        // Build messages with conversation history
        const messages: LLMChatMessage[] = [
            { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        ];

        // Add conversation history (last 7 messages for context)
        if (conversationHistory && conversationHistory.length > 0) {
            const historySlice = conversationHistory.slice(-7);
            const historyText = historySlice
                .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[media]'}`)
                .join('\n');
            messages.push({
                role: 'user',
                content: `## Conversation History (for context)\n${historyText}\n\n## Current Message\n${userText}`,
            });
        } else {
            messages.push({ role: 'user', content: userText });
        }

        const response = await client.chat({
            messages,
            model: ROUTER_MODEL,
            apiKey,
            temperature: ROUTER_TEMPERATURE,
            timeout: ROUTER_TIMEOUT_MS,
            responseFormat: 'json_object',
        });

        // Parse JSON response
        const parsed = parseRouterResponse(response.content);

        if (!parsed) {
            logger.warn({ responseContent: response.content }, 'Router: Failed to parse LLM response');
            return DEFAULT_QA_ROUTE;
        }

        // Validate route kind
        const validRoutes: RouteKind[] = ['summarize', 'qa', 'admin', 'voice_analytics', 'social_graph', 'memory'];
        const routeKind = validRoutes.includes(parsed.route as RouteKind)
            ? (parsed.route as RouteKind)
            : 'qa';

        // Validate experts
        const validExperts: ExpertName[] = ['Summarizer', 'SocialGraph', 'Memory', 'VoiceAnalytics'];
        const experts = (parsed.experts || ['Memory'])
            .filter((e): e is ExpertName => validExperts.includes(e as ExpertName));

        if (experts.length === 0) {
            experts.push('Memory');
        }

        // Determine allowTools based on route
        const allowTools = routeKind === 'qa' || routeKind === 'admin';

        // Use provided temperature or route-based default
        const temperature = typeof parsed.temperature === 'number'
            ? Math.min(Math.max(parsed.temperature, 0), 1)
            : getDefaultTemperature(routeKind);

        const decision: RouteDecision = {
            kind: routeKind,
            experts,
            allowTools,
            temperature,
            reasoningText: parsed.reasoning || `LLM classified as ${routeKind}`,
        };

        logger.debug({ decision, userText: userText.slice(0, 50) }, 'Router: LLM decision');
        return decision;

    } catch (error) {
        logger.warn({ error }, 'Router: LLM call failed, using default route');
        return DEFAULT_QA_ROUTE;
    }
}

function parseRouterResponse(content: string): RouterLLMResponse | null {
    try {
        // Try direct parse
        const parsed = JSON.parse(content);
        return parsed;
    } catch {
        // Try extracting JSON from code block
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1].trim());
            } catch {
                return null;
            }
        }

        // Try finding JSON object
        const objectMatch = content.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                return JSON.parse(objectMatch[0]);
            } catch {
                return null;
            }
        }

        return null;
    }
}

function getDefaultTemperature(route: RouteKind): number {
    switch (route) {
        case 'summarize': return 0.3;
        case 'voice_analytics': return 0.5;
        case 'social_graph': return 0.5;
        case 'memory': return 0.6;
        case 'admin': return 0.4;
        case 'qa': return 0.8;
        default: return 0.8;
    }
}

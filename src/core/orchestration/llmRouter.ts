import { ExpertName } from './experts/expert-types';
import { createLLMClient } from '../llm';
import { LLMChatMessage } from '../llm/llm-types';
import { logger } from '../utils/logger';

// Router model: gemini-fast for low-cost, high-throughput classification
// Router model: gemini-fast for low-cost, high-throughput classification
const ROUTER_MODEL = 'gemini-fast';
const ROUTER_TEMPERATURE = 0.0;
const ROUTER_TIMEOUT_MS = 45_000;

export type RouteKind =
    | 'summarize'
    | 'qa'
    | 'admin'
    | 'voice_analytics'
    | 'social_graph'
    | 'memory'
    | 'image_generate';

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

const ROUTER_SYSTEM_PROMPT = `You are the Intent Classifier for Sage, an advanced Discord AI.
Your job is to route the user's request to the correct internal module based on their INTENT.

### AVAILABLE ROUTES

| Route | Function | Keywords & Triggers |
|:---|:---|:---|
| **image_generate** | Create or edit images. | "draw", "paint", "generate", "make it look like", "visualize", "turn this into" |
| **voice_analytics** | Voice channel stats/status. | "who is in voice", "vc stats", "time in voice", "voice activity" |
| **social_graph** | Relationship & vibe checks. | "who are my friends", "relationship tier", "who knows whom", "vibe check" |
| **memory** | User profile/memory ops. | "what do you know about me", "forget me", "my profile", "memories" |
| **summarize** | Recap conversations. | "summarize", "tl;dr", "recap", "catch me up", "what happened" |
| **admin** | Bot configuration/debug. | "configure", "settings", "debug" |
| **qa** | Conversational fallback. | EVERYTHING ELSE. Chat, coding, questions, banter. |

### REASONING LOGIC (CHAIN OF THOUGHT)

1. **Analyze Context**: Look at the "Conversation History".
   - If the user says "make **it** pop" and the last bot message was an **image**, intent is \`image_generate\`.
   - If the user says "who is **that**" and the last message was about a user, intent is \`qa\` or \`memory\`.

2. **Check Explicit Intent**:
   - "Draw a cat" -> \`image_generate\`
   - "Summarize this" -> \`summarize\`

3. **Check Implicit Intent**:
   - "Make me a pfp" -> \`image_generate\`
   - "Review this code" -> \`qa\` (Programming/General)

4. **Default Rule**:
   - If the request is a general question, greeting, or specific codebase question, route to \`qa\`.
   - **NEVER** invent new routes.

### OUTPUT FORMAT

Return a SINGLE valid JSON object. No markdown.

{
  "reasoning": "Step-by-step logic explaining why this route was chosen.",
  "route": "qa" | "image_generate" | "summarize" | ... ,
  "experts": ["Memory", "Summarizer", ...],
  "temperature": 0.0 - 1.0 (suggested temp for this task)
}

**Valid Experts**: Summarizer, SocialGraph, Memory, VoiceAnalytics, ImageGenerator.
**Note**: You essentially ALWAYS include "Memory" unless it's a pure deterministic command.`;

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
        const client = createLLMClient('pollinations', { chatModel: ROUTER_MODEL });

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
        const validRoutes: RouteKind[] = ['summarize', 'qa', 'admin', 'voice_analytics', 'social_graph', 'memory', 'image_generate'];
        const routeKind = validRoutes.includes(parsed.route as RouteKind)
            ? (parsed.route as RouteKind)
            : 'qa';

        // Validate experts
        const validExperts: ExpertName[] = ['Summarizer', 'SocialGraph', 'Memory', 'VoiceAnalytics', 'ImageGenerator'];
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

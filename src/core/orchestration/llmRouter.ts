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
    | 'image_generate'
    | 'search'; // New search route

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
    replyReferenceContent?: string | null;
    apiKey?: string;
}

const ROUTER_SYSTEM_PROMPT = `You are the Sage Intent Classifier.
Route the user's request to the correct module based on INTENT.

### ROUTES
| Route | Function | Triggers |
|:---|:---|:---|
| **image_generate** | Create/edit images. | "draw", "paint", "generate", "visualize" |
| **voice_analytics** | Voice stats. | "who is in voice", "vc stats", "time in voice" |
| **social_graph** | Social/vibe checks. | "who are my friends", "relationship tier", "vibe check" |
| **memory** | User memory/profile. | "what do you know about me", "forget me", "my profile" |
| **summarize** | Conversation recap. | "summarize", "tl;dr", "recap", "catch me up" |
| **search** | Real-time web search. | "search for", "google this", "price", "news", "today", "yesterday", "now", "release date", "check online", ANY URL/LINK |
| **admin** | Config/debug. | "configure", "settings", "debug" |
| **qa** | EVERYTHING ELSE. | Chat, coding, questions, banter. |

### LOGIC
1. **Context**: Check history. "Make **it** pop" + last bot msg was image -> \`image_generate\`.
2. **Fact vs. Concept**: "What is Python?" -> \`qa\` | "Python release date?" -> \`search\`.
3. **Temporal Rule**: "today", "yesterday", "now" -> BIAS towards \`search\`.
4. **URL Rule**: Input contains "http" or "www" -> \`search\` (browse/read).
5. **Default**: If unsure, use \`qa\`. NEVER invent routes.

### OUTPUT (JSON)
{
  "reasoning": "Concise logic.",
  "route": "qa" | "search" | "image_generate" | ...,
  "temperature": 0.0-1.0
}`;

// ... types and constants
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


export async function decideRoute(params: LLMRouterParams): Promise<RouteDecision> {
    const { userText, invokedBy, hasGuild, conversationHistory, replyReferenceContent, apiKey } = params;

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

        // Add conversation history (last 20 messages for context)
        if (conversationHistory && conversationHistory.length > 0) {
            const historySlice = conversationHistory.slice(-20);
            const historyText = historySlice
                .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[media]'}`)
                .join('\n');
            messages.push({
                role: 'user',
                content: `## Conversation History (last 20)\n${historyText}`,
            });
        }

        // Add reply context if available
        let finalUserContent = userText;
        if (replyReferenceContent) {
            finalUserContent = `[User is Replying to: "${replyReferenceContent}"]\n\n${userText}`;
        }

        messages.push({ role: 'user', content: finalUserContent });


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
        const validRoutes: RouteKind[] = ['summarize', 'qa', 'admin', 'voice_analytics', 'social_graph', 'memory', 'image_generate', 'search'];
        const routeKind = validRoutes.includes(parsed.route as RouteKind)
            ? (parsed.route as RouteKind)
            : 'qa';

        // Deterministic Expert Selection (TS Logic)
        const experts: ExpertName[] = ['Memory']; // Memory is ALWAYS included

        switch (routeKind) {
            case 'summarize':
                experts.push('Summarizer');
                break;
            case 'voice_analytics':
                experts.push('VoiceAnalytics');
                break;
            case 'social_graph':
                experts.push('SocialGraph');
                break;
            case 'image_generate':
                experts.push('ImageGenerator');
                break;
            // qa, search, memory, admin -> Memory is already added
        }

        // Determine allowTools based on route
        const allowTools = routeKind === 'qa' || routeKind === 'admin';

        // Use provided temperature or route-based default
        const temperature = typeof parsed.temperature === 'number'
            ? Math.min(Math.max(parsed.temperature, 0), 1)
            : getDefaultTemperature(routeKind);

        const decision: RouteDecision = {
            kind: routeKind,
            experts: Array.from(new Set(experts)), // Dedupe just in case
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
        case 'search': return 0.4; // Lower temperature for factual search
        case 'qa': return 1.2;
        default: return 0.8;
    }
}

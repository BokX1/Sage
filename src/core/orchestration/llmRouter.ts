import { ExpertName } from './experts/expert-types';
import { createLLMClient } from '../llm';
import { LLMChatMessage } from '../llm/llm-types';
import { logger } from '../utils/logger';

// Router model: DeepSeek for high-quality intent classification
const ROUTER_MODEL = 'deepseek';
const ROUTER_TEMPERATURE = 0.1;
const ROUTER_TIMEOUT_MS = 45_000;

export type RouteKind = 'chat' | 'coding' | 'search' | 'art' | 'analyze' | 'manage';

export interface RouteDecision {
    kind: RouteKind;
    experts?: ExpertName[];
    allowTools: boolean;
    temperature: number;
    reasoningText: string;
}

export interface LLMRouterParams {
    userText: string;
    invokedBy: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
    hasGuild: boolean;
    conversationHistory: LLMChatMessage[];
    replyReferenceContent?: string | null;
    apiKey?: string;
}

/**
 * ROUTER SYSTEM PROMPT - DeepSeek 3.2 Optimized
 * 
 * Design Principles:
 * 1. Signal-based classification (lexical + semantic)
 * 2. Context-aware disambiguation
 * 3. Explicit fallback hierarchy
 * 4. Temperature guidance per route
 */
const ROUTER_SYSTEM_PROMPT = `# Sage Intent Router

You are an intent classification engine. Your ONLY job is to analyze the user's message and route it to the correct handler.

## AVAILABLE ROUTES

| Route | Purpose | Primary Signals |
|-------|---------|-----------------|
| \`coding\` | Software development, debugging, code generation | "write a script", "fix this bug", "python", "js", "error", "api", "function" |
| \`art\` | Create, edit, or modify images | "draw", "paint", "sketch", "generate image", "make a picture", "visualize" |
| \`analyze\` | Data analysis, summarization, and stats | "summarize", "tldr", "catch me up", "voice stats", "who is in vc", "analysis" |
| \`search\` | Real-time information, news, and facts | "search", "look up", "google", "find out", "price of", "weather", "latest news", URLs |
| \`manage\` | Bot configuration and debugging | "configure", "settings", "debug", "admin", "change model" |
| \`chat\` | General conversation, Q&A, social | DEFAULT - "hello", "how are you", "what do you think", creative writing, banter |

## CLASSIFICATION RULES

### Rule 1: Explicit Trigger Words
- "draw me a cat" → \`art\`
- "write a python script" → \`coding\`
- "summarize this channel" → \`analyze\`
- "who is in voice" → \`analyze\`
- "search for Python tutorials" → \`search\`

### Rule 2: Context Continuation
- If last bot message was an image AND user says "make it darker" → \`art\`
- If discussing code AND user says "optimize it" → \`coding\`

### Rule 3: Temporal Signals → search
- "today", "yesterday", "current", "now", "price of", "stock", "weather"

### Rule 4: Default to chat
When uncertain, route to \`chat\`. It handles general conversation, social context, and memory.

## TEMPERATURE GUIDELINES

| Route | Recommended Temperature | Rationale |
|_\`coding\`| 0.2 | Precision and syntax correctness |
| \`art\` | 1.0 | Creativity and visual variety |
| \`analyze\`| 0.1 | Factual accuracy and strict summarization |
| \`search\` | 0.3 | Factual grounding |
| \`manage\` | 0.0 | Deterministic configuration |
| \`chat\` | 0.8 | Natural, engaging conversation |

## OUTPUT FORMAT

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "reasoning": "Your classification logic here",
  "route": "chat",
  "temperature": 0.7
}

## EXAMPLES

User: "hey sage draw me a cyberpunk samurai"
→ {"reasoning": "Explicit 'draw' keyword requesting image creation.", "route": "art", "temperature": 0.95}

User: "can you fix this typescript error"
→ {"reasoning": "Request to fix code/error.", "route": "coding", "temperature": 0.2}

User: "what's the current price of bitcoin"
→ {"reasoning": "Temporal signal 'current' + real-time data request.", "route": "search", "temperature": 0.4}

User: "explain how neural networks work"
→ {"reasoning": "Educational question about concepts.", "route": "chat", "temperature": 0.7}

User: "who's in vc right now"
→ {"reasoning": "Voice channel presence query.", "route": "analyze", "temperature": 0.3}

User: "make it more vibrant" (after image generation)
→ {"reasoning": "Context continuation from previous image, modification request.", "route": "art", "temperature": 0.9}`;

// ... types and constants
const DEFAULT_CHAT_ROUTE: RouteDecision = {
    kind: 'chat',
    experts: ['Memory'],
    allowTools: true,
    temperature: 0.8,
    reasoningText: 'Default Chat route (fallback)',
};

interface RouterLLMResponse {
    route?: string;
    experts?: string[];
    reasoning?: string;
    temperature?: number;
}


export async function decideRoute(params: LLMRouterParams): Promise<RouteDecision> {
    const { userText, invokedBy, hasGuild, conversationHistory, replyReferenceContent, apiKey } = params;

    // Fast path: manage route for slash commands
    if (invokedBy === 'command' && hasGuild) {
        return {
            kind: 'manage',
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
            return DEFAULT_CHAT_ROUTE;
        }

        // Validate route kind
        const validRoutes: RouteKind[] = ['chat', 'coding', 'search', 'art', 'analyze', 'manage'];
        const routeKind = validRoutes.includes(parsed.route as RouteKind)
            ? (parsed.route as RouteKind)
            : 'chat';

        // Determine allowTools based on route
        const allowTools = routeKind === 'chat' || routeKind === 'manage' || routeKind === 'coding';

        // Use provided temperature or route-based default
        const temperature = typeof parsed.temperature === 'number'
            ? parsed.temperature
            : getDefaultTemperature(routeKind);

        const decision: RouteDecision = {
            kind: routeKind,
            allowTools,
            temperature,
            reasoningText: parsed.reasoning || `LLM classified as ${routeKind}`,
        };

        logger.debug({ decision, userText: userText.slice(0, 50) }, 'Router: LLM decision');
        return decision;

    } catch (error) {
        logger.warn({ error }, 'Router: LLM call failed, using default route');
        return DEFAULT_CHAT_ROUTE;
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
        case 'analyze': return 0.2;
        case 'manage': return 0.0;
        case 'search': return 0.3; // Lower temperature for factual search
        case 'art': return 1.0; // Higher creativity for image prompts
        case 'coding': return 0.2; // Low temperature for code precision
        case 'chat': return 0.8;
        default: return 0.7;
    }
}

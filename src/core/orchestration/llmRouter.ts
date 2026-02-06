import { ExpertName } from './experts/expert-types';
import { createLLMClient } from '../llm';
import { LLMChatMessage } from '../llm/llm-types';
import { logger } from '../utils/logger';

// Router model: DeepSeek for high-quality intent classification
const ROUTER_MODEL = 'deepseek';
const ROUTER_TEMPERATURE = 0.1;
const ROUTER_TIMEOUT_MS = 45_000;

export type RouteKind =
    | 'summarize'
    | 'qa'
    | 'admin'
    | 'voice_analytics'
    | 'social_graph'
    | 'memory'
    | 'image_generate'
    | 'search';

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
    hasAttachment?: boolean;
    conversationHistory?: LLMChatMessage[];
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
| \`image_generate\` | Create, edit, or modify images | "draw", "paint", "sketch", "generate image", "create art", "make a picture", "visualize", "illustrate", "design" |
| \`voice_analytics\` | Voice channel statistics and presence | **MUST contain:** "voice", "vc", "call", "channel", "who is in", "stats" |
| \`social_graph\` | Relationship and social dynamics | "who are my friends", "relationship", "vibe check", "who do I talk to", "social connections" |
| \`memory\` | User profile and memory operations | "what do you know about me", "remember", "forget me", "my profile", "my preferences" |
| \`summarize\` | Conversation or content summarization | "summarize", "tldr", "tl;dr", "recap", "catch me up", "what did I miss", "summary" |
| \`search\` | Real-time information retrieval | "search", "look up", "google", "find out", "what's the price", "latest news", URLs, current events |
| \`admin\` | Bot configuration and debugging | "configure", "settings", "debug", "admin", "bot config" |
| \`qa\` | General conversation, Q&A, coding help | DEFAULT - anything not matching above |

## CLASSIFICATION RULES

### Rule 0: File/Code Attachments → qa
If the user attached a file (code, text, document) or mentions analyzing/reviewing code:
- File attachments with questions → \`qa\`
- "review this code" → \`qa\`
- "what does this file do" → \`qa\`
- "help me with this script" → \`qa\`

### Rule 1: Explicit Trigger Words
If the message contains EXPLICIT route keywords, use that route:
- "draw me a cat" → \`image_generate\`
- "summarize this channel" → \`summarize\`
- "search for Python tutorials" → \`search\`

### Rule 2: Context Continuation
Check conversation history for context:
- If last bot message was an image AND user says "make it darker" → \`image_generate\`
- If discussing a topic AND user says "can you look that up?" → \`search\`

### Rule 3: Temporal Signals → search
Keywords indicating real-time or recent information:
- "today", "yesterday", "this week", "latest", "current", "now", "recent"
- "price of", "stock", "weather", "news", "score"
- Any URL (http, https, www)

### Rule 4: Knowledge vs Lookup
- Conceptual/educational: "What is machine learning?" → \`qa\`
- Factual/time-sensitive: "When was GPT-4 released?" → \`search\`
- Opinion/creative: "What do you think about AI?" → \`qa\`

### Rule 5: Default to qa
When uncertain, route to \`qa\`. It handles:
- General conversation and banter
- Coding questions and help
- Explanations and tutorials
- Creative writing
- Anything not clearly matching other routes

### Rule 6: Voice Analytics Constraint
ONLY route to \`voice_analytics\` if the user explicitly asks about:
- Who is in a voice channel
- Voice activity stats
- Channel usage time
DO NOT route "check this", "look at this", or "status" to \`voice_analytics\` unless "voice" or "vc" is mentioned.

## TEMPERATURE GUIDELINES

| Route | Recommended Temperature | Rationale |
|-------|------------------------|-----------|
| \`image_generate\` | 0.9-1.0 | High creativity for art |
| \`voice_analytics\` | 0.3 | Factual data presentation |
| \`social_graph\` | 0.5 | Balanced interpretation |
| \`memory\` | 0.4 | Accurate recall |
| \`summarize\` | 0.3 | Faithful compression |
| \`search\` | 0.4 | Factual synthesis |
| \`admin\` | 0.2 | Precise configuration |
| \`qa\` | 0.8 | Conversational flexibility |

## OUTPUT FORMAT

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "reasoning": "Your classification logic here",
  "route": "qa",
  "temperature": 0.7
}

## EXAMPLES

User: "hey sage draw me a cyberpunk samurai"
→ {"reasoning": "Explicit 'draw' keyword requesting image creation.", "route": "image_generate", "temperature": 0.95}

User: "what's the current price of bitcoin"
→ {"reasoning": "Temporal signal 'current' + real-time data request.", "route": "search", "temperature": 0.4}

User: "explain how neural networks work"
→ {"reasoning": "Educational question about concepts, no time-sensitivity.", "route": "qa", "temperature": 0.7}

User: "who's in vc right now"
→ {"reasoning": "Voice channel presence query.", "route": "voice_analytics", "temperature": 0.3}

User: "make it more vibrant" (after image generation)
→ {"reasoning": "Context continuation from previous image, modification request.", "route": "image_generate", "temperature": 0.9}`;

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
    const { userText, invokedBy, hasGuild, hasAttachment, conversationHistory, replyReferenceContent, apiKey } = params;

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

    // Fast path: File attachments -> QA (Default)
    // We strictly limit experts for attachments to prevent hallucinations (like voice_analytics),
    // but allow specific intents if keywords are present.
    if (hasAttachment) {
        const text = userText.toLowerCase();

        // Allow Image Generation if explicitly requested
        if (/\b(draw|paint|generate|create|make|edit|visualize)\b/.test(text)) {
            // Fall through to LLM for full classification (it might be "draw a graph based on this data" -> qa)
        }
        // Allow Summarization if explicitly requested
        else if (/\b(summarize|summary|tldr|tl;dr|recap)\b/.test(text)) {
            // Fall through to LLM
        }
        // Otherwise, FORCE QA to prevent hallucinations for "Look at this", "What is this", etc.
        else {
            return {
                kind: 'qa',
                experts: [],
                allowTools: true,
                temperature: 0.8,
                reasoningText: 'File attachment detected with no explicit expert keywords - forcing QA route',
            };
        }
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

        // Prepend attachment context for file attachments (forces qa route)
        if (hasAttachment) {
            finalUserContent = `[User has attached a file/code for review]\n\n${userText}`;
        }

        if (replyReferenceContent) {
            finalUserContent = `[User is Replying to: "${replyReferenceContent}"]\n\n${finalUserContent}`;
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

        // --- POST-LLM GUARDRAILS ---

        // Guardrail: Voice Analytics Hallucination Prevention
        // If LLM picks voice_analytics but text has no voice keywords, force QA.
        if (parsed.route === 'voice_analytics') {
            const text = userText.toLowerCase();
            const hasVoiceKeywords = /\b(voice|vc|call|channel|who|stat|stats|activity|speaking|talking)\b/.test(text);
            if (!hasVoiceKeywords) {
                logger.warn({ userText, originalRoute: 'voice_analytics' }, 'Router: Overriding voice_analytics hallucination -> qa');
                return {
                    ...DEFAULT_QA_ROUTE,
                    reasoningText: 'Guardrail: Overrode voice_analytics (missing keywords)',
                };
            }
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
            ? parsed.temperature
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
        case 'image_generate': return 0.9; // Higher creativity for image prompts
        case 'qa': return 1.0;
        default: return 0.8;
    }
}

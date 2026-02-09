import { ContextProviderName } from '../context/context-types';
import { createLLMClient } from '../llm';
import { LLMChatMessage } from '../llm/llm-types';
import { logger } from '../utils/logger';

const ROUTER_MODEL = 'deepseek';
const ROUTER_TEMPERATURE = 0.1;
const ROUTER_TIMEOUT_MS = 45_000;

export type AgentKind = 'chat' | 'coding' | 'search' | 'creative';

export interface AgentDecision {
  kind: AgentKind;
  contextProviders?: ContextProviderName[];
  allowTools: boolean;
  temperature: number;
  reasoningText: string;
}

export interface AgentSelectorParams {
  userText: string;
  invokedBy: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
  hasGuild: boolean;
  conversationHistory: LLMChatMessage[];
  replyReferenceContent?: string | null;
  apiKey?: string;
}

const AGENT_SELECTOR_PROMPT = `# Sage Agent Selector

You are an intent classification engine. Your only job is to analyze the user message and select the best agent.

## Available agents

| Agent | Purpose | Primary signals |
|-------|---------|-----------------|
| \`coding\` | Software development, debugging, and code generation | "write a script", "fix this bug", "python", "js", "error", "api", "function" |
| \`creative\` | Create, edit, or modify images | "draw", "paint", "sketch", "generate image", "make a picture", "visualize" |
| \`search\` | Time-sensitive facts and current information | "search", "look up", "google", "find out", "price of", "weather", "latest news", URLs |
| \`chat\` | General conversation, social context, admin, and analysis | default fallback |

## Classification rules

1. Explicit trigger words:
- "draw me a cat" -> \`creative\`
- "write a python script" -> \`coding\`
- "search for Python tutorials" -> \`search\`

2. Capabilities mapping:
- "summarize this channel" -> \`chat\`
- "who is in voice" -> \`chat\`
- "change settings" -> \`chat\`
- "admin stats" -> \`chat\`

3. Context continuation:
- If last bot message was an image and user says "make it darker" -> \`creative\`
- If discussing code and user says "optimize it" -> \`coding\`

4. Temporal/current signals:
- "today", "yesterday", "current", "now", "price of", "stock", "weather" -> \`search\`

5. Fallback:
- When uncertain, select \`chat\`.

## Temperature guidance

| Agent | Temperature |
|-------|-------------|
| \`coding\` | 0.2 |
| \`creative\` | 1.0 |
| \`search\` | 0.3 |
| \`chat\` | 0.8 |

## Output format

Return only valid JSON:
{
  "reasoning": "brief explanation",
  "agent": "chat|coding|search|creative",
  "temperature": 0.7
}`;

const DEFAULT_CHAT_AGENT: AgentDecision = {
  kind: 'chat',
  contextProviders: ['Memory'],
  allowTools: true,
  temperature: 0.8,
  reasoningText: 'Default Chat agent (fallback)',
};

interface AgentSelectorResponse {
  agent?: string;
  experts?: string[]; // Legacy field ignored for backwards compatibility.
  reasoning?: string;
  temperature?: number;
}

function parseAgentResponse(content: string): AgentSelectorResponse | null {
  try {
    return JSON.parse(content) as AgentSelectorResponse;
  } catch {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim()) as AgentSelectorResponse;
      } catch {
        return null;
      }
    }

    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as AgentSelectorResponse;
      } catch {
        return null;
      }
    }

    return null;
  }
}

function getDefaultTemperature(agent: AgentKind): number {
  switch (agent) {
    case 'search':
      return 0.3;
    case 'creative':
      return 1.0;
    case 'coding':
      return 0.2;
    case 'chat':
      return 0.8;
    default:
      return 0.7;
  }
}

function clampTemperature(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1.5, value));
}

export async function decideAgent(params: AgentSelectorParams): Promise<AgentDecision> {
  const { userText, invokedBy, hasGuild, conversationHistory, replyReferenceContent, apiKey } = params;

  if (invokedBy === 'command' && hasGuild) {
    return {
      kind: 'chat',
      contextProviders: ['SocialGraph', 'VoiceAnalytics', 'Memory'],
      allowTools: true,
      temperature: 0.4,
      reasoningText: 'Slash command context detected - routing to chat agent',
    };
  }

  try {
    const client = createLLMClient('pollinations', { chatModel: ROUTER_MODEL });
    const messages: LLMChatMessage[] = [{ role: 'system', content: AGENT_SELECTOR_PROMPT }];

    if (conversationHistory.length > 0) {
      const historyText = conversationHistory
        .slice(-20)
        .map((message) => `${message.role}: ${typeof message.content === 'string' ? message.content : '[media]'}`)
        .join('\n');
      messages.push({
        role: 'user',
        content: `Conversation history (last 20):\n${historyText}`,
      });
    }

    const finalUserContent = replyReferenceContent
      ? `[User is replying to: "${replyReferenceContent}"]\n\n${userText}`
      : userText;
    messages.push({ role: 'user', content: finalUserContent });

    const response = await client.chat({
      messages,
      model: ROUTER_MODEL,
      apiKey,
      temperature: ROUTER_TEMPERATURE,
      timeout: ROUTER_TIMEOUT_MS,
      responseFormat: 'json_object',
    });

    const parsed = parseAgentResponse(response.content);
    if (!parsed) {
      logger.warn({ responseContent: response.content }, 'Agent Selector: failed to parse LLM response');
      return DEFAULT_CHAT_AGENT;
    }

    const validAgents: AgentKind[] = ['chat', 'coding', 'search', 'creative'];
    const agentKind = validAgents.includes(parsed.agent as AgentKind)
      ? (parsed.agent as AgentKind)
      : 'chat';
    const allowTools = agentKind === 'chat' || agentKind === 'coding';
    const fallbackTemperature = getDefaultTemperature(agentKind);
    const temperature =
      typeof parsed.temperature === 'number'
        ? clampTemperature(parsed.temperature, fallbackTemperature)
        : fallbackTemperature;

    const decision: AgentDecision = {
      kind: agentKind,
      allowTools,
      temperature,
      reasoningText: parsed.reasoning || `LLM selected agent: ${agentKind}`,
    };

    logger.debug({ decision, userText: userText.slice(0, 50) }, 'Agent Selector: LLM decision');
    return decision;
  } catch (error) {
    logger.warn({ error }, 'Agent Selector: LLM call failed, using default chat agent');
    return DEFAULT_CHAT_AGENT;
  }
}

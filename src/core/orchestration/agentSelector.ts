import { ContextProviderName } from '../context/context-types';
import { createLLMClient } from '../llm';
import { LLMChatMessage } from '../llm/llm-types';
import { logger } from '../utils/logger';

const ROUTER_MODEL = 'deepseek';
const ROUTER_TEMPERATURE = 0.1;
const ROUTER_TIMEOUT_MS = 60_000;
const CHAT_DEFAULT_TEMPERATURE = 1.2;
const CHAT_MIN_TEMPERATURE = 1.0;
const CHAT_MAX_TEMPERATURE = 1.4;

export type AgentKind = 'chat' | 'coding' | 'search' | 'creative';
export type SearchExecutionMode = 'simple' | 'complex';

export interface AgentCapabilityDescriptor {
  kind: AgentKind;
  purpose: string;
  primarySignals: string;
  runtimeCapabilities: string;
}

export const AGENT_CAPABILITY_DESCRIPTORS: AgentCapabilityDescriptor[] = [
  {
    kind: 'coding',
    purpose: 'Write, debug, explain, or refactor software/code',
    primarySignals: '"fix this bug", "write function", stack traces, code blocks, APIs, tests',
    runtimeCapabilities:
      'Implement and debug code, reason about architecture and tests, and produce precise technical guidance.',
  },
  {
    kind: 'creative',
    purpose: 'Generate or edit images/visuals',
    primarySignals: '"draw", "generate image", "edit this picture", "make it darker"',
    runtimeCapabilities:
      'Run image-generation and image-editing workflows, then return asset-oriented responses.',
  },
  {
    kind: 'search',
    purpose: 'Fresh, time-sensitive, web-verifiable facts',
    primarySignals: '"latest", "today", "current", prices, weather, releases, news, URLs',
    runtimeCapabilities:
      'Run freshness-focused research, verification redispatch, and multi-pass synthesis when needed.',
  },
  {
    kind: 'chat',
    purpose: 'General discussion, analysis, discord/community/admin requests',
    primarySignals: 'default fallback',
    runtimeCapabilities:
      'Handle conversational support, server/community context, and policy-aware verification passes.',
  },
];

function buildAgentCapabilityTable(): string {
  const header = '| Agent | Purpose | Primary signals |';
  const divider = '|-------|---------|-----------------|';
  const rows = AGENT_CAPABILITY_DESCRIPTORS.map(
    (capability) =>
      `| \`${capability.kind}\` | ${capability.purpose} | ${capability.primarySignals} |`,
  );
  return [header, divider, ...rows].join('\n');
}

export interface AgentDecision {
  kind: AgentKind;
  contextProviders?: ContextProviderName[];
  temperature: number;
  searchMode?: SearchExecutionMode;
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

You are an intent routing engine. Select exactly one best agent for the current user turn.

## Available agents

${buildAgentCapabilityTable()}

## Routing rules

1. Choose by primary user intent for this turn, not by isolated keywords.
2. Prefer \`search\` for requests requiring up-to-date external facts.
3. For mixed coding + freshness requests:
   - Choose \`search\` when the user first needs current factual verification.
   - Choose \`coding\` when the main ask is implementation/debugging and freshness is secondary.
4. Continue prior context when explicit:
   - Image follow-up edits -> \`creative\`
   - Code follow-up iterations -> \`coding\`
5. Discord operational/community tasks (voice presence, summaries, settings, moderation/admin) -> \`chat\`
6. If uncertain, choose \`chat\`.

## Downstream loop awareness

Your route choice controls one unified runtime loop:

1. Context providers are gathered for this turn (Memory is baseline; chat commonly adds SocialGraph and VoiceAnalytics).
2. The runtime may run verification/tool steps before finalizing.
3. A critic may request revision when quality is insufficient.

Choose the route that best matches how this full loop should solve the request, not only the first model response.

## Temperature guidance

| Agent | Temperature |
|-------|-------------|
| \`coding\` | 0.2 |
| \`creative\` | 1.0 |
| \`search\` | 0.3 |
| \`chat\` | 1.0-1.4 (default 1.2) |

For \`chat\`:
- Use 1.0 for serious, precise, or sensitive responses.
- Use 1.4 for playful/creative conversational responses.
- Use 1.2 as the default when tone is neutral.

## Search execution mode

When agent is \`search\`, you MUST also choose \`search_mode\`:
- \`simple\`: direct lookup/short factual answer can be returned as-is.
- \`complex\`: multi-step research, comparison, synthesis, or long-form explanation where search findings should be summarized for readability.
- If unsure between \`simple\` and \`complex\`, choose \`complex\`.

When agent is not \`search\`, set \`search_mode\` to null.

## Output format

Return only valid JSON:
{
  "reasoning": "brief explanation",
  "agent": "chat|coding|search|creative",
  "temperature": 1.2,
  "search_mode": "simple|complex|null"
}

No markdown. No extra text.`;

const DEFAULT_CHAT_AGENT: AgentDecision = {
  kind: 'chat',
  contextProviders: ['Memory'],
  temperature: CHAT_DEFAULT_TEMPERATURE,
  reasoningText: 'Default Chat agent (fallback)',
};

interface AgentSelectorResponse {
  agent?: string;
  kind?: string;
  experts?: string[];
  reasoning?: string;
  temperature?: number | string;
  search_mode?: string | null;
  searchMode?: string | null;
  complexity?: string | null;
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
      return CHAT_DEFAULT_TEMPERATURE;
    default:
      return 0.7;
  }
}

function clampChatTemperature(value: number): number {
  if (!Number.isFinite(value)) return CHAT_DEFAULT_TEMPERATURE;
  return Math.max(CHAT_MIN_TEMPERATURE, Math.min(CHAT_MAX_TEMPERATURE, value));
}

function normalizeAgentKind(raw: unknown): AgentKind {
  const validAgents: AgentKind[] = ['chat', 'coding', 'search', 'creative'];
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return validAgents.includes(normalized as AgentKind) ? (normalized as AgentKind) : 'chat';
}

function clampTemperature(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1.5, value));
}

function normalizeSearchMode(raw: unknown): SearchExecutionMode | null {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (normalized === 'simple' || normalized === 'complex') {
    return normalized;
  }
  return null;
}

export async function decideAgent(params: AgentSelectorParams): Promise<AgentDecision> {
  const { userText, invokedBy, hasGuild, conversationHistory, replyReferenceContent, apiKey } = params;

  if (invokedBy === 'command' && hasGuild) {
    return {
      kind: 'chat',
      contextProviders: ['SocialGraph', 'VoiceAnalytics', 'Memory'],
      temperature: CHAT_DEFAULT_TEMPERATURE,
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

    const agentKind = normalizeAgentKind(parsed.agent ?? parsed.kind);
    const fallbackTemperature = getDefaultTemperature(agentKind);
    const parsedTemperature =
      typeof parsed.temperature === 'number'
        ? parsed.temperature
        : typeof parsed.temperature === 'string'
          ? Number(parsed.temperature)
          : Number.NaN;
    const temperature =
      Number.isFinite(parsedTemperature)
        ? clampTemperature(parsedTemperature, fallbackTemperature)
        : fallbackTemperature;

    const enforcedTemperature = agentKind === 'chat' ? clampChatTemperature(temperature) : temperature;
    const parsedSearchModeRaw = parsed.search_mode ?? parsed.searchMode ?? parsed.complexity;
    const normalizedSearchMode = normalizeSearchMode(parsedSearchModeRaw);
    const searchMode =
      agentKind === 'search'
        ? normalizedSearchMode ?? 'complex'
        : undefined;

    const decision: AgentDecision = {
      kind: agentKind,
      temperature: enforcedTemperature,
      searchMode,
      reasoningText: parsed.reasoning || `LLM selected agent: ${agentKind}`,
    };

    logger.debug({ decision, userText: userText.slice(0, 50) }, 'Agent Selector: LLM decision');
    return decision;
  } catch (error) {
    logger.warn({ error }, 'Agent Selector: LLM call failed, using default chat agent');
    return DEFAULT_CHAT_AGENT;
  }
}

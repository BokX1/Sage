import { LLMChatMessage } from '../llm/llm-types';
import { getLLMClient } from '../llm';
import { resolveModelForRequest } from '../llm/model-resolver';
import { logger } from '../utils/logger';
import { AgentKind } from '../orchestration/agentSelector';

export interface CriticAssessment {
  score: number;
  verdict: 'pass' | 'revise';
  issues: string[];
  rewritePrompt: string;
  model: string;
}

export interface EvaluateDraftWithCriticParams {
  guildId: string | null;
  routeKind: AgentKind;
  userText: string;
  draftText: string;
  allowedModels?: string[];
  apiKey?: string;
  timeoutMs?: number;
  conversationHistory?: LLMChatMessage[];
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced =
    trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ??
    trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) return fenced.trim();

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  return trimmed;
}

function normalizeScore(score: unknown): number {
  const numeric = typeof score === 'number' ? score : Number(score);
  if (Number.isNaN(numeric)) return 0.5;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function parseAssessment(raw: string, model: string): CriticAssessment | null {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
    const verdictRaw = String(parsed.verdict ?? '').trim().toLowerCase();
    const verdict: 'pass' | 'revise' = verdictRaw === 'revise' ? 'revise' : 'pass';
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((item) => String(item)).filter((item) => item.trim().length > 0)
      : [];
    const rewritePrompt = typeof parsed.rewritePrompt === 'string' ? parsed.rewritePrompt : '';

    return {
      score: normalizeScore(parsed.score),
      verdict,
      issues,
      rewritePrompt,
      model,
    };
  } catch {
    return null;
  }
}

const CRITIC_SYSTEM_PROMPT_DEFAULT = `You are a strict answer-quality critic.
Evaluate the candidate answer for:
1) factuality,
2) completeness for the user's request,
3) clarity.

Return ONLY JSON:
{
  "score": 0.0,
  "verdict": "pass|revise",
  "issues": ["short issue list"],
  "rewritePrompt": "precise revision guidance"
}

Rules:
- score is between 0 and 1.
- Use "revise" when important facts are missing, unclear, or likely incorrect.
- rewritePrompt must be specific and actionable.
- Never include markdown.`;

const CRITIC_SYSTEM_PROMPT_CHAT = `You are a conversational quality critic for a Discord chat agent.
Evaluate the candidate answer for:
1) Natural flow and tone,
2) Relevance to the last user message,
3) Consistency with conversation history and user intent.

Return ONLY JSON:
{
  "score": 0.0,
  "verdict": "pass|revise",
  "issues": ["short issue list"],
  "rewritePrompt": "guidance on tone or flow"
}

Rules:
- score is between 0 and 1.
- Use "revise" ONLY if the answer is off-topic, hallucinated, contradictory, unsafe, or rude.
- Allow for casual banter and creativity when still relevant.`;

const CRITIC_SYSTEM_PROMPT_CODING = `You are a code-quality critic.
Evaluate the candidate answer for:
1) Technical correctness,
2) Completeness of implementation guidance,
3) Safety and practical executability.

Return ONLY JSON:
{
  "score": 0.0,
  "verdict": "pass|revise",
  "issues": ["short issue list"],
  "rewritePrompt": "precise revision guidance"
}

Rules:
- score is between 0 and 1.
- Use "revise" if code is likely broken, incomplete, insecure, or ignores user constraints.
- Flag missing edge cases, missing imports/dependencies, and incorrect commands.
- Never include markdown.`;

const CRITIC_SYSTEM_PROMPT_SEARCH = `You are a factuality and freshness critic for search responses.
Evaluate the candidate answer for:
1) Factual correctness,
2) Freshness for time-sensitive claims,
3) Completeness and source-grounding.

Return ONLY JSON:
{
  "score": 0.0,
  "verdict": "pass|revise",
  "issues": ["short issue list"],
  "rewritePrompt": "precise revision guidance"
}

Rules:
- score is between 0 and 1.
- Use "revise" when claims are uncertain, stale, unverifiable, or missing key facts.
- Require concise source cues (site/domain names or URLs) for external factual claims.
- Never include markdown.`;

function getCriticSystemPrompt(routeKind: AgentKind): string {
  switch (routeKind) {
    case 'chat':
      return CRITIC_SYSTEM_PROMPT_CHAT;
    case 'coding':
      return CRITIC_SYSTEM_PROMPT_CODING;
    case 'search':
      return CRITIC_SYSTEM_PROMPT_SEARCH;
    default:
      return CRITIC_SYSTEM_PROMPT_DEFAULT;
  }
}

function serializeMessageContent(content: LLMChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image_url') return '[image]';
      if (part.type === 'input_audio') return '[audio]';
      return '[content]';
    })
    .join('');
}

export async function evaluateDraftWithCritic(
  params: EvaluateDraftWithCriticParams,
): Promise<CriticAssessment | null> {
  try {
    const criticModel = await resolveModelForRequest({
      guildId: params.guildId,
      messages: [{ role: 'user', content: params.userText }],
      route: params.routeKind,
      allowedModels: params.allowedModels,
      featureFlags: { reasoning: true },
    });

    const systemPrompt = getCriticSystemPrompt(params.routeKind);

    const criticMessages: LLMChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          `Route: ${params.routeKind}`,
          ...(params.routeKind === 'chat' && params.conversationHistory && params.conversationHistory.length > 0
            ? [
                `Conversation History:\n${params.conversationHistory
                  .map((m) => `${m.role}: ${serializeMessageContent(m.content)}`)
                  .join('\n')}`,
              ]
            : []),
          `User request:\n${params.userText}`,
          `Candidate answer:\n${params.draftText}`,
        ].join('\n\n'),
      },
    ];

    const response = await getLLMClient().chat({
      messages: criticMessages,
      model: criticModel,
      apiKey: params.apiKey,
      temperature: 0.1,
      responseFormat: 'json_object',
      timeout: params.timeoutMs ?? 180_000,
    });

    return parseAssessment(response.content, criticModel);
  } catch (error) {
    logger.warn({ error }, 'Critic assessment failed (non-fatal)');
    return null;
  }
}

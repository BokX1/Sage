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

function extractFirstJsonObject(content: string): string | null {
  const startIdx = content.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return content.slice(startIdx, i + 1);
        }
      }
    }
  }

  return null;
}

function extractBalancedJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim() ?? null;
  const candidate = fenced ?? trimmed;
  return extractFirstJsonObject(candidate);
}

function parseJsonLenient(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const attempts = [
    trimmed,
    // Common failure: trailing commas
    trimmed.replace(/,\s*([}\]])/g, '$1'),
  ];

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      // continue
    }
  }

  return null;
}

function normalizeScore(score: unknown): number {
  const numeric = typeof score === 'number' ? score : Number(score);
  if (Number.isNaN(numeric)) return 0.5;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function parseAssessment(raw: string, model: string): CriticAssessment | null {
  const extracted = extractBalancedJson(raw) ?? raw.trim();
  const parsed = parseJsonLenient(extracted);
  if (!parsed) return null;

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
- If verdict is "pass", score MUST be >= 0.85. If verdict is "revise", score MUST be < 0.85.
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
- If verdict is "pass", score MUST be >= 0.85. If verdict is "revise", score MUST be < 0.85.
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
 - If verdict is "pass", score MUST be >= 0.85. If verdict is "revise", score MUST be < 0.85.
 - Use "revise" if code is likely broken, incomplete, insecure, or ignores user constraints.
 - Flag missing edge cases, missing imports/dependencies, and incorrect commands.
  - Prioritize blocking issues first (security bugs, broken code paths, unmet explicit user constraints).
 - If you identify any BLOCKING issue (e.g., code/commands will not run as written, missing required dependency/import, violates explicit constraints, security vulnerability), verdict MUST be "revise".
 - If verdict is "pass", issues MUST be empty or minor-only, and rewritePrompt MUST be an empty string.
 - Do NOT require unrelated hardening extras unless explicitly requested by the user (for example: refresh-token rotation, full observability stack, CSP tuning, advanced rate-limit key strategies).
 - If the core request is satisfied with a secure, executable baseline, return "pass" and optionally list minor improvements in issues.
 - Never include markdown.`;

const CRITIC_SYSTEM_PROMPT_SEARCH = `You are a critic for search-routed responses.

Return ONLY JSON:
{
  "score": 0.0,
  "verdict": "pass|revise",
  "issues": ["short issue list"],
  "rewritePrompt": "precise revision guidance"
}

Global rules:
- score is between 0 and 1.
- If verdict is "pass", score MUST be >= 0.85. If verdict is "revise", score MUST be < 0.85.
- Never include markdown.

Step-by-step rubric:

1) Determine if the user request is time-sensitive (contains words like: latest, current, now, today, right now, as of, recent, newest, release, version, price, weather, news, score).
If time-sensitive:
  - If the answer does NOT include a line like "Checked on: YYYY-MM-DD": verdict MUST be "revise".
  - Count distinct source URLs (https://...). If fewer than 2: verdict MUST be "revise".
  - If the answer contains suspicious certainty terms (trust me/definitely/always/never/guaranteed/100%): verdict MUST be "revise".
  - Otherwise: verdict MUST be "pass". You may list minor improvements in issues, but do not block with "revise".
  - Do NOT label the underlying facts as "wrong" based solely on your own prior knowledge; focus on source-grounding and freshness hygiene.

2) If NOT time-sensitive:
  - Evaluate factual correctness, completeness for the user request, and clarity.
  - If the user asked for sources/citations/links and none are provided: verdict MUST be "revise".
  - Use "revise" for clear factual errors (especially stable/common-knowledge facts) or missing key details.

rewritePrompt guidance:
- If verdict is "revise", rewritePrompt must be specific and actionable (what to add/remove/verify, and what sources to cite).`;

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
    // Critic model selection should be JSON-reliable and does not need web-search capability.
    // Using the search route chain here can pick search-native models (e.g., gemini-search) that are
    // less consistent in structured JSON output, causing avoidable critic parse failures.
    const modelResolutionRoute = params.routeKind === 'search' ? 'chat' : params.routeKind;
    const requireReasoning = params.routeKind !== 'search';

    const criticModel = await resolveModelForRequest({
      guildId: params.guildId,
      messages: [{ role: 'user', content: params.userText }],
      route: modelResolutionRoute,
      allowedModels: params.allowedModels,
      featureFlags: requireReasoning ? { reasoning: true } : undefined,
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

import { getLLMClient } from '../llm';
import { LLMChatMessage } from '../llm/llm-types';
import { resolveModelForRequestDetailed } from '../llm/model-resolver';
import { AgentKind } from '../orchestration/agentSelector';
import { logger } from '../utils/logger';
import { buildEvalJudgePrompt, getEvalRubric } from './evalRubrics';
import {
  EvalAggregateScore,
  EvalDimensionScores,
  evaluateAggregateScore,
  normalizeEvalDimensionScores,
} from './evalScorer';
import { parseTraceToolTelemetry } from './toolTelemetry';

export interface LlmJudgeInput {
  guildId: string | null;
  routeKind: string;
  userText?: string | null;
  replyText: string;
  toolJson?: unknown;
  qualityJson?: unknown;
  budgetJson?: unknown;
  rubricVersion?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxTokens?: number;
  primaryModel?: string;
  secondaryModel?: string;
  adjudicatorModel?: string;
}

export interface LlmJudgeAssessment extends EvalAggregateScore {
  model: string;
  scores: EvalDimensionScores;
  issues: string[];
  summary: string;
}

export interface LlmJudgeResult {
  rubricVersion: string;
  routeKind: AgentKind;
  primary: LlmJudgeAssessment;
  secondary: LlmJudgeAssessment;
  adjudicator: LlmJudgeAssessment | null;
  disagreement: boolean;
  arbitrationUsed: boolean;
  final: LlmJudgeAssessment;
}

interface ParsedJudgePayload {
  scores: EvalDimensionScores;
  confidence: number;
  issues: string[];
  summary: string;
}

type JudgeRole = 'primary' | 'secondary' | 'adjudicator';

interface ResolvedJudgeModels {
  primary: string;
  secondary: string;
  adjudicator: string;
}

export type JudgeModelInvoker = (params: {
  role: JudgeRole;
  model: string;
  messages: LLMChatMessage[];
  apiKey?: string;
  timeoutMs: number;
  maxTokens: number;
}) => Promise<string>;

function normalizeRouteKind(routeKind: string): AgentKind {
  const normalized = routeKind.trim().toLowerCase();
  if (normalized === 'chat' || normalized === 'coding' || normalized === 'search' || normalized === 'creative') {
    return normalized;
  }
  return 'chat';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function safeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function trimIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 10);
}

function extractFirstJsonObject(content: string): string | null {
  const start = content.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let idx = start; idx < content.length; idx += 1) {
    const char = content[idx];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, idx + 1);
      }
    }
  }
  return null;
}

function parseJudgePayload(raw: string): ParsedJudgePayload | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? raw;
  const jsonCandidate = extractFirstJsonObject(fenced.trim()) ?? fenced.trim();
  if (!jsonCandidate) return null;

  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
    return {
      scores: normalizeEvalDimensionScores(parsed.scores),
      confidence: clamp01(Number(parsed.confidence)),
      issues: trimIssues(parsed.issues),
      summary: safeString(parsed.summary, ''),
    };
  } catch {
    return null;
  }
}

function stringifyTruncated(value: unknown, maxChars = 1_500): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}...`;
  } catch {
    return '[unserializable]';
  }
}

function buildToolSummary(toolJson: unknown): string {
  const telemetry = parseTraceToolTelemetry(toolJson);
  return [
    `toolsExecuted=${telemetry.toolsExecuted}`,
    `successfulToolCount=${telemetry.successfulToolCount}`,
    `toolResultCount=${telemetry.toolResultCount}`,
    `hardGateRequired=${telemetry.hardGateRequired}`,
    `hardGateSatisfied=${telemetry.hardGateSatisfied}`,
    `toolLoopFailed=${telemetry.toolLoopFailed}`,
  ].join(', ');
}

function buildTraceMetadataSummary(params: { qualityJson?: unknown; budgetJson?: unknown }): string {
  return [
    `qualityJson=${stringifyTruncated(params.qualityJson ?? null, 1_000)}`,
    `budgetJson=${stringifyTruncated(params.budgetJson ?? null, 1_000)}`,
  ].join('\n');
}

function maxDimensionDiff(a: EvalDimensionScores, b: EvalDimensionScores): number {
  return Math.max(
    Math.abs(a.factual_grounding - b.factual_grounding),
    Math.abs(a.instruction_adherence - b.instruction_adherence),
    Math.abs(a.safety - b.safety),
    Math.abs(a.completeness - b.completeness),
    Math.abs(a.tool_use_correctness - b.tool_use_correctness),
    Math.abs(a.source_quality - b.source_quality),
    Math.abs(a.temporal_correctness - b.temporal_correctness),
  );
}

function hasJudgeDisagreement(a: LlmJudgeAssessment, b: LlmJudgeAssessment): boolean {
  if (a.verdict !== b.verdict) return true;
  if (Math.abs(a.overallScore - b.overallScore) >= 0.15) return true;
  return maxDimensionDiff(a.scores, b.scores) >= 0.25;
}

function conservativePick(a: LlmJudgeAssessment, b: LlmJudgeAssessment): LlmJudgeAssessment {
  if (a.verdict === 'revise' && b.verdict === 'pass') return a;
  if (b.verdict === 'revise' && a.verdict === 'pass') return b;
  return a.overallScore <= b.overallScore ? a : b;
}

async function resolveJudgeModels(input: LlmJudgeInput): Promise<ResolvedJudgeModels> {
  const directPrimary = input.primaryModel?.trim();
  const directSecondary = input.secondaryModel?.trim();
  const directAdjudicator = input.adjudicatorModel?.trim();
  if (directPrimary && directSecondary && directAdjudicator) {
    return {
      primary: directPrimary,
      secondary: directSecondary,
      adjudicator: directAdjudicator,
    };
  }

  const route = normalizeRouteKind(input.routeKind);
  const details = await resolveModelForRequestDetailed({
    guildId: input.guildId,
    messages: [
      {
        role: 'user',
        content: input.userText?.trim() || input.replyText.slice(0, 400),
      },
    ],
    route,
    featureFlags: { reasoning: true },
  });
  const candidates = details.candidates;
  const primary = input.primaryModel?.trim() || details.model;
  const secondary =
    input.secondaryModel?.trim() ||
    candidates.find((candidate) => candidate !== primary) ||
    primary;
  const adjudicator =
    input.adjudicatorModel?.trim() ||
    candidates.find((candidate) => candidate !== primary && candidate !== secondary) ||
    primary;
  return { primary, secondary, adjudicator };
}

function defaultInvoker(): JudgeModelInvoker {
  const client = getLLMClient();
  return async (params) => {
    const response = await client.chat({
      messages: params.messages,
      model: params.model,
      apiKey: params.apiKey,
      temperature: 0.1,
      timeout: params.timeoutMs,
      maxTokens: params.maxTokens,
      responseFormat: 'json_object',
    });
    return response.content;
  };
}

async function runJudgePass(params: {
  role: JudgeRole;
  model: string;
  prompt: string;
  invoker: JudgeModelInvoker;
  apiKey?: string;
  timeoutMs: number;
  maxTokens: number;
  passThreshold: number;
  hardFailThreshold: number;
}): Promise<LlmJudgeAssessment> {
  const messages: LLMChatMessage[] = [
    { role: 'system', content: 'You are a deterministic evaluator. Output JSON only.' },
    { role: 'user', content: params.prompt },
  ];

  try {
    const raw = await params.invoker({
      role: params.role,
      model: params.model,
      messages,
      apiKey: params.apiKey,
      timeoutMs: params.timeoutMs,
      maxTokens: params.maxTokens,
    });
    const parsed = parseJudgePayload(raw);
    if (!parsed) {
      const fallbackScores = normalizeEvalDimensionScores({});
      const aggregate = evaluateAggregateScore({
        scores: fallbackScores,
        confidence: 0,
        passThreshold: params.passThreshold,
        hardFailThreshold: params.hardFailThreshold,
      });
      return {
        model: params.model,
        scores: fallbackScores,
        issues: ['judge_parse_failed'],
        summary: 'Judge output could not be parsed as valid JSON.',
        ...aggregate,
      };
    }
    const aggregate = evaluateAggregateScore({
      scores: parsed.scores,
      confidence: parsed.confidence,
      passThreshold: params.passThreshold,
      hardFailThreshold: params.hardFailThreshold,
    });
    return {
      model: params.model,
      scores: parsed.scores,
      issues: parsed.issues,
      summary: parsed.summary,
      ...aggregate,
    };
  } catch (error) {
    logger.warn(
      { error, judgeRole: params.role, model: params.model },
      'Judge model call failed; using conservative fallback assessment',
    );
    const fallbackScores = normalizeEvalDimensionScores({});
    const aggregate = evaluateAggregateScore({
      scores: fallbackScores,
      confidence: 0,
      passThreshold: params.passThreshold,
      hardFailThreshold: params.hardFailThreshold,
    });
    return {
      model: params.model,
      scores: fallbackScores,
      issues: ['judge_call_failed'],
      summary: 'Judge model call failed.',
      ...aggregate,
    };
  }
}

export async function runLlmJudge(
  input: LlmJudgeInput,
  deps?: { invoker?: JudgeModelInvoker },
): Promise<LlmJudgeResult> {
  const routeKind = normalizeRouteKind(input.routeKind);
  const userText = input.userText?.trim() || '[user_request_unavailable_from_trace]';
  const rubric = getEvalRubric(input.rubricVersion);
  const timeoutMs = Math.max(1_000, Math.floor(input.timeoutMs ?? 120_000));
  const maxTokens = Math.max(128, Math.floor(input.maxTokens ?? 1_200));
  const models = await resolveJudgeModels(input);
  const invoker = deps?.invoker ?? defaultInvoker();
  const toolSummary = buildToolSummary(input.toolJson);
  const traceMetadataSummary = buildTraceMetadataSummary({
    qualityJson: input.qualityJson,
    budgetJson: input.budgetJson,
  });

  const basePrompt = buildEvalJudgePrompt({
    rubric,
    routeKind,
    userText,
    replyText: input.replyText,
    toolSummary,
    traceMetadataSummary,
  });

  const primary = await runJudgePass({
    role: 'primary',
    model: models.primary,
    prompt: basePrompt,
    invoker,
    apiKey: input.apiKey,
    timeoutMs,
    maxTokens,
    passThreshold: rubric.passThreshold,
    hardFailThreshold: rubric.hardFailThreshold,
  });

  const secondary = await runJudgePass({
    role: 'secondary',
    model: models.secondary,
    prompt: basePrompt,
    invoker,
    apiKey: input.apiKey,
    timeoutMs,
    maxTokens,
    passThreshold: rubric.passThreshold,
    hardFailThreshold: rubric.hardFailThreshold,
  });

  const disagreement = hasJudgeDisagreement(primary, secondary);
  if (!disagreement) {
    const final = primary.overallScore >= secondary.overallScore ? primary : secondary;
    return {
      rubricVersion: rubric.version,
      routeKind,
      primary,
      secondary,
      adjudicator: null,
      disagreement: false,
      arbitrationUsed: false,
      final,
    };
  }

  const adjudicatorPrompt = [
    basePrompt,
    '',
    'Additional arbitration context:',
    `Primary judge model: ${primary.model}`,
    `Primary verdict: ${primary.verdict}`,
    `Primary overallScore: ${primary.overallScore}`,
    `Primary issues: ${primary.issues.join('; ') || 'none'}`,
    `Secondary judge model: ${secondary.model}`,
    `Secondary verdict: ${secondary.verdict}`,
    `Secondary overallScore: ${secondary.overallScore}`,
    `Secondary issues: ${secondary.issues.join('; ') || 'none'}`,
    'Resolve disagreement and return final rubric-aligned JSON.',
  ].join('\n');

  const adjudicator = await runJudgePass({
    role: 'adjudicator',
    model: models.adjudicator,
    prompt: adjudicatorPrompt,
    invoker,
    apiKey: input.apiKey,
    timeoutMs,
    maxTokens,
    passThreshold: rubric.passThreshold,
    hardFailThreshold: rubric.hardFailThreshold,
  });

  const final = adjudicator.issues.includes('judge_parse_failed')
    ? conservativePick(primary, secondary)
    : adjudicator;

  return {
    rubricVersion: rubric.version,
    routeKind,
    primary,
    secondary,
    adjudicator,
    disagreement: true,
    arbitrationUsed: true,
    final,
  };
}

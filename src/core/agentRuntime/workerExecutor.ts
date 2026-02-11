import { LLMClient, LLMChatMessage } from '../llm/llm-types';
import { resolveModelForRequestDetailed } from '../llm/model-resolver';
import { recordModelOutcome } from '../llm/model-health';
import { limitConcurrency } from '../utils/concurrency';
import { logger } from '../utils/logger';
import { ManagerWorkerExecutionResult, ManagerWorkerArtifact } from './managerWorkerTypes';
import { ManagerWorkerPlan, ManagerWorkerTask } from './taskPlanner';
import { buildResearchWorkerMessages } from './workers/researchWorker';
import { buildSynthesisWorkerMessages } from './workers/synthesisWorker';
import { buildVerificationWorkerMessages } from './workers/verificationWorker';

export interface ExecuteManagerWorkerPlanParams {
  traceId: string;
  guildId: string | null;
  apiKey?: string;
  userText: string;
  contextText: string;
  plan: ManagerWorkerPlan;
  client: LLMClient;
  maxParallel: number;
  maxTokens: number;
  maxInputChars: number;
  timeoutMs: number;
}

interface WorkerPayload {
  summary: string;
  keyPoints: string[];
  openQuestions: string[];
  citations: string[];
  confidence: number;
}

interface WorkerPromptPayload {
  userText: string;
  contextText: string;
  priorFindingsText: string | null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .slice(0, max);
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
      if (depth === 0) return content.slice(start, idx + 1);
    }
  }
  return null;
}

function parseWorkerPayload(raw: string): WorkerPayload | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? raw;
  const jsonCandidate = extractFirstJsonObject(fenced.trim()) ?? fenced.trim();
  if (!jsonCandidate) return null;

  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : '';
    return {
      summary,
      keyPoints: normalizeStringArray(parsed.keyPoints, 8),
      openQuestions: normalizeStringArray(parsed.openQuestions, 6),
      citations: normalizeStringArray(parsed.citations, 10),
      confidence: clamp01(Number(parsed.confidence)),
    };
  } catch {
    return null;
  }
}

function buildPriorFindings(artifacts: ManagerWorkerArtifact[]): string | null {
  const lines = artifacts
    .filter((artifact) => !artifact.failed)
    .map((artifact) => `[${artifact.worker}] ${artifact.summary}`)
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  return lines.join('\n');
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function truncateWithTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const budget = Math.max(200, Math.floor(maxChars));
  const marker = `\n...[${text.length - budget} chars omitted]...\n`;
  const headBudget = Math.max(80, Math.floor((budget - marker.length) * 0.7));
  const tailBudget = Math.max(80, budget - marker.length - headBudget);
  const head = text.slice(0, headBudget);
  const tail = text.slice(Math.max(0, text.length - tailBudget));
  return `${head}${marker}${tail}`;
}

function budgetWorkerPromptInput(params: {
  userText: string;
  contextText: string;
  priorFindingsText: string | null;
  maxInputChars: number;
}): WorkerPromptPayload {
  const maxInputChars = Math.max(4_000, Math.floor(params.maxInputChars));
  const reservedOverhead = 1_200;
  const payloadBudget = Math.max(1_500, maxInputChars - reservedOverhead);

  const userBudget = Math.max(1_200, Math.floor(payloadBudget * 0.3));
  const priorBudget = params.priorFindingsText ? Math.max(1_000, Math.floor(payloadBudget * 0.25)) : 0;
  const contextBudget = Math.max(1_200, payloadBudget - userBudget - priorBudget);

  return {
    userText: truncateWithTail(params.userText, userBudget),
    contextText: truncateWithTail(params.contextText || '[none]', contextBudget),
    priorFindingsText: params.priorFindingsText
      ? truncateWithTail(params.priorFindingsText, priorBudget)
      : null,
  };
}

function salvageUnstructuredWorkerPayload(raw: string): WorkerPayload | null {
  const text = raw.trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const bulletLines = lines
    .filter((line) => /^[-*\u2022]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*\u2022]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter((line) => line.length > 0);
  const sentencePoints =
    bulletLines.length > 0
      ? bulletLines
      : text
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => sentence.trim())
          .filter((sentence) => sentence.length > 0)
          .slice(0, 5);
  const citations = Array.from(new Set(text.match(/https?:\/\/[^\s<>()]+/gi) ?? [])).slice(0, 8);
  const summary = truncate(lines[0] ?? text, 400);

  return {
    summary,
    keyPoints: sentencePoints.slice(0, 6),
    openQuestions: ['worker_output_unstructured_repaired'],
    citations,
    confidence: 0.32,
  };
}

function buildWorkerMessages(params: {
  task: ManagerWorkerTask;
  userText: string;
  contextText: string;
  priorFindingsText: string | null;
}): LLMChatMessage[] {
  if (params.task.worker === 'research') {
    return buildResearchWorkerMessages({
      userText: params.userText,
      objective: params.task.objective,
      contextText: params.contextText,
      priorFindingsText: params.priorFindingsText,
    });
  }
  if (params.task.worker === 'verification') {
    return buildVerificationWorkerMessages({
      userText: params.userText,
      objective: params.task.objective,
      contextText: params.contextText,
      priorFindingsText: params.priorFindingsText,
    });
  }
  return buildSynthesisWorkerMessages({
    userText: params.userText,
    objective: params.task.objective,
    contextText: params.contextText,
    priorFindingsText: params.priorFindingsText,
  });
}

async function runWorkerTask(params: {
  task: ManagerWorkerTask;
  plan: ManagerWorkerPlan;
  traceId: string;
  guildId: string | null;
  apiKey?: string;
  userText: string;
  contextText: string;
  priorFindingsText: string | null;
  client: LLMClient;
  maxTokens: number;
  maxInputChars: number;
  timeoutMs: number;
}): Promise<ManagerWorkerArtifact> {
  const promptInput = budgetWorkerPromptInput({
    userText: params.userText,
    contextText: params.contextText,
    priorFindingsText: params.priorFindingsText,
    maxInputChars: params.maxInputChars,
  });
  const messages = buildWorkerMessages({
    task: params.task,
    userText: promptInput.userText,
    contextText: promptInput.contextText,
    priorFindingsText: promptInput.priorFindingsText,
  });
  const startedAt = Date.now();
  let selectedModel: string | null = null;

  try {
    const modelDetails = await resolveModelForRequestDetailed({
      guildId: params.guildId,
      messages,
      route: params.plan.routeKind,
      featureFlags:
        params.plan.routeKind === 'search'
          ? { search: true, reasoning: true }
          : { reasoning: true },
    });
    const model = modelDetails.model;
    selectedModel = model;
    const response = await params.client.chat({
      messages,
      model,
      apiKey: params.apiKey,
      temperature: 0.2,
      timeout: params.timeoutMs,
      maxTokens: params.maxTokens,
      responseFormat: 'json_object',
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    recordModelOutcome({
      model,
      success: true,
      latencyMs,
    });

    const parsed = parseWorkerPayload(response.content);
    if (!parsed) {
      const salvaged = salvageUnstructuredWorkerPayload(response.content);
      if (!salvaged) {
        return {
          taskId: params.task.id,
          worker: params.task.worker,
          objective: params.task.objective,
          model,
          summary: 'Worker returned empty/unusable output.',
          keyPoints: [],
          openQuestions: ['worker_output_unusable'],
          citations: [],
          confidence: 0,
          latencyMs,
          failed: true,
          rawText: '',
        };
      }
      return {
        taskId: params.task.id,
        worker: params.task.worker,
        objective: params.task.objective,
        model,
        summary: salvaged.summary,
        keyPoints: salvaged.keyPoints,
        openQuestions: salvaged.openQuestions,
        citations: salvaged.citations,
        confidence: salvaged.confidence,
        latencyMs,
        failed: false,
        rawText: truncate(response.content, 1_500),
      };
    }

    return {
      taskId: params.task.id,
      worker: params.task.worker,
      objective: params.task.objective,
      model,
      summary: parsed.summary || 'No summary provided.',
      keyPoints: parsed.keyPoints,
      openQuestions: parsed.openQuestions,
      citations: parsed.citations,
      confidence: parsed.confidence,
      latencyMs,
      failed: false,
      rawText: truncate(response.content, 1_500),
    };
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const errorText = error instanceof Error ? error.message : String(error);
    logger.warn(
      {
        traceId: params.traceId,
        taskId: params.task.id,
        worker: params.task.worker,
        error: errorText,
      },
      'Manager-worker task failed',
    );
    const fallbackModel = selectedModel ?? (params.plan.routeKind === 'search' ? 'gemini-search' : 'openai-large');
    recordModelOutcome({
      model: fallbackModel,
      success: false,
    });
    return {
      taskId: params.task.id,
      worker: params.task.worker,
      objective: params.task.objective,
      model: fallbackModel,
      summary: 'Worker execution failed.',
      keyPoints: [],
      openQuestions: ['worker_execution_failed'],
      citations: [],
      confidence: 0,
      latencyMs,
      failed: true,
      error: errorText,
      rawText: '',
    };
  }
}

export async function executeManagerWorkerPlan(
  params: ExecuteManagerWorkerPlanParams,
): Promise<ManagerWorkerExecutionResult> {
  const limiter = limitConcurrency(Math.max(1, Math.floor(params.maxParallel)));
  let loopArtifacts: ManagerWorkerArtifact[] = [];
  let priorFindingsText: string | null = null;
  const loops = Math.max(1, Math.floor(params.plan.loops));

  for (let loop = 1; loop <= loops; loop += 1) {
    const nonSynthesis = params.plan.tasks.filter((task) => task.worker !== 'synthesis');
    const synthesis = params.plan.tasks.filter((task) => task.worker === 'synthesis');

    const nonSynthesisArtifacts = await Promise.all(
      nonSynthesis.map((task) =>
        limiter(() =>
          runWorkerTask({
            task,
            plan: params.plan,
            traceId: params.traceId,
            guildId: params.guildId,
            apiKey: params.apiKey,
            userText: params.userText,
            contextText: params.contextText,
            priorFindingsText,
            client: params.client,
            maxTokens: params.maxTokens,
            maxInputChars: params.maxInputChars,
            timeoutMs: params.timeoutMs,
          }),
        ),
      ),
    );

    const loopPriorFindings = buildPriorFindings(nonSynthesisArtifacts) ?? priorFindingsText;
    const synthesisArtifacts = await Promise.all(
      synthesis.map((task) =>
        runWorkerTask({
          task,
          plan: params.plan,
          traceId: params.traceId,
          guildId: params.guildId,
          apiKey: params.apiKey,
          userText: params.userText,
          contextText: params.contextText,
          priorFindingsText: loopPriorFindings,
          client: params.client,
          maxTokens: params.maxTokens,
          maxInputChars: params.maxInputChars,
          timeoutMs: params.timeoutMs,
        }),
      ),
    );

    const artifactsById = new Map<string, ManagerWorkerArtifact>();
    for (const artifact of [...nonSynthesisArtifacts, ...synthesisArtifacts]) {
      artifactsById.set(artifact.taskId, artifact);
    }
    loopArtifacts = params.plan.tasks
      .map((task) => artifactsById.get(task.id))
      .filter((artifact): artifact is ManagerWorkerArtifact => !!artifact);
    priorFindingsText = buildPriorFindings(loopArtifacts);
  }

  const failedWorkers = loopArtifacts.filter((artifact) => artifact.failed).length;
  return {
    plan: params.plan,
    artifacts: loopArtifacts,
    totalWorkers: loopArtifacts.length,
    failedWorkers,
  };
}

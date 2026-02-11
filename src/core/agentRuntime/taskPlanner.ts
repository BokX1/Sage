import { AgentKind, SearchExecutionMode } from '../orchestration/agentSelector';

export type ManagerWorkerRoute = 'coding' | 'search';
export type ManagerWorkerKind = 'research' | 'verification' | 'synthesis';

export interface ManagerWorkerConfig {
  enabled: boolean;
  maxWorkers: number;
  maxPlannerLoops: number;
  maxWorkerTokens: number;
  maxWorkerInputChars: number;
  timeoutMs: number;
  minComplexityScore: number;
}

export interface ManagerWorkerTask {
  id: string;
  worker: ManagerWorkerKind;
  objective: string;
}

export interface ManagerWorkerPlan {
  routeKind: ManagerWorkerRoute;
  complexityScore: number;
  rationale: string[];
  loops: number;
  tasks: ManagerWorkerTask[];
}

export interface ManagerWorkerPlanningResult {
  enabled: boolean;
  eligibleRoute: boolean;
  shouldRun: boolean;
  routeKind: ManagerWorkerRoute | null;
  complexityScore: number;
  rationale: string[];
  plan: ManagerWorkerPlan | null;
}

const COMPLEXITY_CLAIM_KEYWORDS =
  /\b(compare|versus|vs\.?|tradeoff|benchmark|evaluate|analyze|root cause|diagnose|debug|investigate|design|architecture|multi-step|step by step)\b/gi;
const COMPLEXITY_VERIFICATION_KEYWORDS =
  /\b(verify|validate|prove|edge case|counterexample|test case|regression|failure mode|risk)\b/gi;
const COMPLEXITY_SCOPE_KEYWORDS =
  /\b(latest|today|current|version|release|breaking change|migration|api|sdk|docs|source)\b/gi;
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (Number.isFinite(value) && value && value > 0) {
    return Math.max(1, Math.floor(value));
  }
  return fallback;
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches?.length ?? 0;
}

function estimateComplexity(params: {
  routeKind: AgentKind;
  searchMode: SearchExecutionMode | null;
  userText: string;
}): { score: number; rationale: string[] } {
  const text = params.userText.trim();
  const normalized = text.toLowerCase();
  const words = normalized.length === 0 ? 0 : normalized.split(/\s+/).length;
  const urls = countMatches(normalized, URL_PATTERN);
  const claimSignals = countMatches(normalized, COMPLEXITY_CLAIM_KEYWORDS);
  const verificationSignals = countMatches(normalized, COMPLEXITY_VERIFICATION_KEYWORDS);
  const scopeSignals = countMatches(normalized, COMPLEXITY_SCOPE_KEYWORDS);

  const rationale: string[] = [];
  let score = 0;

  if (params.routeKind === 'search' && params.searchMode === 'complex') {
    score += 0.35;
    rationale.push('search_complex_mode');
  }
  if (params.routeKind === 'coding') {
    score += 0.15;
    rationale.push('coding_route');
  }
  if (words >= 24) {
    score += 0.15;
    rationale.push('long_prompt');
  }
  if (urls > 0) {
    score += Math.min(0.15, urls * 0.05);
    rationale.push('url_grounding');
  }
  if (claimSignals > 0) {
    score += Math.min(0.2, claimSignals * 0.05);
    rationale.push('analysis_keywords');
  }
  if (verificationSignals > 0) {
    score += Math.min(0.2, verificationSignals * 0.05);
    rationale.push('verification_keywords');
  }
  if (scopeSignals > 0) {
    score += Math.min(0.15, scopeSignals * 0.04);
    rationale.push('scope_keywords');
  }

  return {
    score: clamp01(score),
    rationale: rationale.length > 0 ? rationale : ['baseline'],
  };
}

function trimTasksToBudget(tasks: ManagerWorkerTask[], maxWorkers: number): ManagerWorkerTask[] {
  const budget = Math.max(1, Math.floor(maxWorkers));
  if (tasks.length <= budget) return tasks;
  if (budget === 1) {
    return tasks.filter((task) => task.worker === 'synthesis').slice(0, 1);
  }
  if (budget === 2) {
    const research = tasks.find((task) => task.worker === 'research');
    const synthesis = tasks.find((task) => task.worker === 'synthesis');
    return [research, synthesis].filter((task): task is ManagerWorkerTask => !!task);
  }
  return tasks.slice(0, budget);
}

function buildTasksForRoute(routeKind: ManagerWorkerRoute): ManagerWorkerTask[] {
  if (routeKind === 'search') {
    return [
      {
        id: 'research-1',
        worker: 'research',
        objective: 'Collect and structure the strongest factual findings and source leads for the user question.',
      },
      {
        id: 'verification-1',
        worker: 'verification',
        objective: 'Identify inconsistencies, stale assumptions, and missing evidence in the collected findings.',
      },
      {
        id: 'synthesis-1',
        worker: 'synthesis',
        objective: 'Produce a concise decision-oriented synthesis aligned to the user intent and evidence quality.',
      },
    ];
  }

  return [
    {
      id: 'research-1',
      worker: 'research',
      objective: 'Break down likely root causes, dependencies, and implementation constraints.',
    },
    {
      id: 'verification-1',
      worker: 'verification',
      objective: 'Stress-test candidate implementation directions for correctness, edge cases, and regressions.',
    },
    {
      id: 'synthesis-1',
      worker: 'synthesis',
      objective: 'Combine validated findings into an implementation-ready recommendation.',
    },
  ];
}

export function normalizeManagerWorkerConfig(
  input: Partial<ManagerWorkerConfig>,
): ManagerWorkerConfig {
  return {
    enabled: !!input.enabled,
    maxWorkers: toPositiveInt(input.maxWorkers, 3),
    maxPlannerLoops: toPositiveInt(input.maxPlannerLoops, 1),
    maxWorkerTokens: toPositiveInt(input.maxWorkerTokens, 900),
    maxWorkerInputChars: toPositiveInt(input.maxWorkerInputChars, 32_000),
    timeoutMs: toPositiveInt(input.timeoutMs, 60_000),
    minComplexityScore: clamp01(
      Number.isFinite(input.minComplexityScore as number)
        ? (input.minComplexityScore as number)
        : 0.55,
    ),
  };
}

export function planManagerWorker(params: {
  config: ManagerWorkerConfig;
  routeKind: AgentKind;
  searchMode: SearchExecutionMode | null;
  userText: string;
}): ManagerWorkerPlanningResult {
  const routeKind = params.routeKind;
  const eligibleRoute = routeKind === 'coding' || routeKind === 'search';
  const normalizedRoute = eligibleRoute ? (routeKind as ManagerWorkerRoute) : null;
  const complexity = estimateComplexity({
    routeKind,
    searchMode: params.searchMode,
    userText: params.userText,
  });

  if (!params.config.enabled || !eligibleRoute || !normalizedRoute) {
    return {
      enabled: params.config.enabled,
      eligibleRoute,
      shouldRun: false,
      routeKind: normalizedRoute,
      complexityScore: complexity.score,
      rationale: complexity.rationale,
      plan: null,
    };
  }

  const forcedBySearchComplex = normalizedRoute === 'search' && params.searchMode === 'complex';
  const shouldRun = forcedBySearchComplex || complexity.score >= params.config.minComplexityScore;
  if (!shouldRun) {
    return {
      enabled: params.config.enabled,
      eligibleRoute,
      shouldRun: false,
      routeKind: normalizedRoute,
      complexityScore: complexity.score,
      rationale: complexity.rationale,
      plan: null,
    };
  }

  const tasks = trimTasksToBudget(buildTasksForRoute(normalizedRoute), params.config.maxWorkers);
  return {
    enabled: params.config.enabled,
    eligibleRoute,
    shouldRun: true,
    routeKind: normalizedRoute,
    complexityScore: complexity.score,
    rationale: complexity.rationale,
    plan: {
      routeKind: normalizedRoute,
      complexityScore: complexity.score,
      rationale: complexity.rationale,
      loops: params.config.maxPlannerLoops,
      tasks,
    },
  };
}

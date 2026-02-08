import { ExpertName } from '../orchestration/experts/expert-types';
import { AgentGraph, AgentTaskBudget, AgentTaskNode } from './agent-types';

const DEFAULT_BUDGET: AgentTaskBudget = {
  maxLatencyMs: 20_000,
  maxRetries: 1,
  maxInputTokens: 2_000,
  maxOutputTokens: 2_000,
};

const EXPERT_BUDGET_OVERRIDES: Partial<Record<ExpertName, Partial<AgentTaskBudget>>> = {
  Memory: {
    maxLatencyMs: 8_000,
    maxRetries: 0,
  },
  Summarizer: {
    maxLatencyMs: 10_000,
    maxRetries: 1,
  },
  SocialGraph: {
    maxLatencyMs: 12_000,
    maxRetries: 1,
  },
  VoiceAnalytics: {
    maxLatencyMs: 12_000,
    maxRetries: 1,
  },
  ImageGenerator: {
    maxLatencyMs: 180_000,
    maxRetries: 0,
    maxInputTokens: 4_000,
    maxOutputTokens: 4_000,
  },
};

function normalizeNodeId(expert: ExpertName, index: number): string {
  return `${expert.toLowerCase()}-${index + 1}`;
}

function toTaskBudget(expert: ExpertName): AgentTaskBudget {
  const override = EXPERT_BUDGET_OVERRIDES[expert] ?? {};
  return {
    ...DEFAULT_BUDGET,
    ...override,
  };
}

function objectiveForExpert(expert: ExpertName, routeKind: string): string {
  switch (expert) {
    case 'Memory':
      return 'Retrieve stable memory/profile facts relevant to this request.';
    case 'Summarizer':
      return 'Provide concise channel context summaries for this turn.';
    case 'SocialGraph':
      return 'Provide relationship context that can improve response personalization.';
    case 'VoiceAnalytics':
      return 'Provide current and historical voice activity context.';
    case 'ImageGenerator':
      return 'Generate an image artifact matching the user request.';
    default:
      return `Produce relevant context for ${routeKind}.`;
  }
}

function successCriteriaForExpert(expert: ExpertName): string[] {
  if (expert === 'ImageGenerator') {
    return ['returns_image_binary_or_clear_error'];
  }
  return ['returns_context_packet'];
}

function filterExperts(experts: ExpertName[], skipMemory: boolean): ExpertName[] {
  return experts.filter((expert) => !(skipMemory && expert === 'Memory'));
}

export function buildLinearExpertGraph(params: {
  routeKind: string;
  experts: ExpertName[];
  skipMemory: boolean;
}): AgentGraph {
  const { routeKind, experts, skipMemory } = params;

  const filteredExperts = filterExperts(experts, skipMemory);
  const nodes: AgentTaskNode[] = filteredExperts.map((expert, index) => ({
    id: normalizeNodeId(expert, index),
    agent: expert,
    objective: objectiveForExpert(expert, routeKind),
    inputs: index === 0 ? ['user_input'] : [`node:${normalizeNodeId(filteredExperts[index - 1], index - 1)}`],
    successCriteria: successCriteriaForExpert(expert),
    budget: toTaskBudget(expert),
    dependsOn: index === 0 ? [] : [normalizeNodeId(filteredExperts[index - 1], index - 1)],
    metadata: {
      routeKind,
      expert,
      strategy: 'linear',
    },
  }));

  const edges =
    nodes.length <= 1
      ? []
      : nodes.slice(1).map((node, index) => ({
          from: nodes[index].id,
          to: node.id,
        }));

  return {
    version: 'v1',
    routeKind,
    createdAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

export function buildFanoutExpertGraph(params: {
  routeKind: string;
  experts: ExpertName[];
  skipMemory: boolean;
}): AgentGraph {
  const { routeKind, experts, skipMemory } = params;
  const filteredExperts = filterExperts(experts, skipMemory);

  const nodes: AgentTaskNode[] = filteredExperts.map((expert, index) => ({
    id: normalizeNodeId(expert, index),
    agent: expert,
    objective: objectiveForExpert(expert, routeKind),
    inputs: ['user_input'],
    successCriteria: successCriteriaForExpert(expert),
    budget: toTaskBudget(expert),
    dependsOn: [],
    metadata: {
      routeKind,
      expert,
      strategy: 'fanout',
    },
  }));

  return {
    version: 'v1',
    routeKind,
    createdAt: new Date().toISOString(),
    nodes,
    edges: [],
  };
}

function dependencyAwareDependsOn(
  expert: ExpertName,
  allExperts: ExpertName[],
  routeKind: string,
): ExpertName[] {
  if (expert === 'Memory') return [];

  const dependencies = new Set<ExpertName>();

  if (allExperts.includes('Memory')) {
    dependencies.add('Memory');
  }

  if (expert === 'SocialGraph' && routeKind === 'summarize' && allExperts.includes('Summarizer')) {
    dependencies.add('Summarizer');
  }

  return [...dependencies];
}

export function buildDependencyAwareExpertGraph(params: {
  routeKind: string;
  experts: ExpertName[];
  skipMemory: boolean;
}): AgentGraph {
  const { routeKind, experts, skipMemory } = params;
  const filteredExperts = filterExperts(experts, skipMemory);
  const nodeByExpert = new Map<ExpertName, string>();

  filteredExperts.forEach((expert, index) => {
    nodeByExpert.set(expert, normalizeNodeId(expert, index));
  });

  const nodes: AgentTaskNode[] = filteredExperts.map((expert) => {
    const dependsOnExperts = dependencyAwareDependsOn(expert, filteredExperts, routeKind);
    const dependsOn = dependsOnExperts
      .map((dependency) => nodeByExpert.get(dependency))
      .filter((value): value is string => !!value);

    return {
      id: nodeByExpert.get(expert) as string,
      agent: expert,
      objective: objectiveForExpert(expert, routeKind),
      inputs: dependsOn.length > 0 ? dependsOn.map((dependency) => `node:${dependency}`) : ['user_input'],
      successCriteria: successCriteriaForExpert(expert),
      budget: toTaskBudget(expert),
      dependsOn,
      metadata: {
        routeKind,
        expert,
        strategy: 'dependency_aware',
      },
    };
  });

  const edges = nodes.flatMap((node) => node.dependsOn.map((dependency) => ({ from: dependency, to: node.id })));

  return {
    version: 'v1',
    routeKind,
    createdAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

function shouldUseDependencyAware(params: {
  routeKind: string;
  experts: ExpertName[];
  enableParallel: boolean;
}): boolean {
  if (!params.enableParallel) return false;
  if (params.experts.length < 3) return false;
  if (!params.experts.includes('Memory')) return false;
  if (params.experts.includes('ImageGenerator')) return false;

  return ['admin', 'summarize', 'social_graph', 'voice_analytics'].includes(params.routeKind);
}

function shouldUseFanout(params: {
  routeKind: string;
  experts: ExpertName[];
  enableParallel: boolean;
}): boolean {
  if (!params.enableParallel) return false;
  if (params.experts.length <= 1) return false;

  // Image generation should remain ordered due heavy side effects and attachment handling.
  if (params.experts.includes('ImageGenerator')) return false;

  return [
    'qa',
    'coding',
    'search',
    'admin',
    'summarize',
    'social_graph',
    'voice_analytics',
    'memory',
  ].includes(params.routeKind);
}

export function buildPlannedExpertGraph(params: {
  routeKind: string;
  experts: ExpertName[];
  skipMemory: boolean;
  enableParallel: boolean;
}): AgentGraph {
  const filteredExperts = filterExperts(params.experts, params.skipMemory);

  if (
    shouldUseDependencyAware({
      routeKind: params.routeKind,
      experts: filteredExperts,
      enableParallel: params.enableParallel,
    })
  ) {
    return buildDependencyAwareExpertGraph({
      routeKind: params.routeKind,
      experts: filteredExperts,
      skipMemory: false,
    });
  }

  if (
    shouldUseFanout({
      routeKind: params.routeKind,
      experts: filteredExperts,
      enableParallel: params.enableParallel,
    })
  ) {
    return buildFanoutExpertGraph({
      routeKind: params.routeKind,
      experts: filteredExperts,
      skipMemory: false,
    });
  }

  return buildLinearExpertGraph({
    routeKind: params.routeKind,
    experts: filteredExperts,
    skipMemory: false,
  });
}

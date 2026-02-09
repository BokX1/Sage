import { ContextProviderName } from '../context/context-types';
import { AgentGraph, AgentTaskBudget, AgentTaskNode } from './agent-types';
import { AgentKind } from '../orchestration/agentSelector';

const DEFAULT_BUDGET: AgentTaskBudget = {
  maxLatencyMs: 30_000,
  maxRetries: 1,
  maxInputTokens: 2_000,
  maxOutputTokens: 2_000,
};

const PROVIDER_BUDGET_OVERRIDES: Partial<Record<ContextProviderName, Partial<AgentTaskBudget>>> = {
  Memory: {
    maxLatencyMs: 15_000,
    maxRetries: 0,
  },
  Summarizer: {
    maxLatencyMs: 20_000,
    maxRetries: 1,
  },
  SocialGraph: {
    maxLatencyMs: 25_000,
    maxRetries: 1,
  },
  VoiceAnalytics: {
    maxLatencyMs: 25_000,
    maxRetries: 1,
  },
};

function normalizeNodeId(provider: ContextProviderName, index: number): string {
  return `${provider.toLowerCase()}-${index + 1}`;
}

function toTaskBudget(provider: ContextProviderName): AgentTaskBudget {
  const override = PROVIDER_BUDGET_OVERRIDES[provider] ?? {};
  return {
    ...DEFAULT_BUDGET,
    ...override,
  };
}

function objectiveForProvider(provider: ContextProviderName, agentKind: string): string {
  switch (provider) {
    case 'Memory':
      return 'Retrieve stable memory/profile facts relevant to this request.';
    case 'Summarizer':
      return 'Provide concise channel context summaries for this turn.';
    case 'SocialGraph':
      return 'Provide relationship context that can improve response personalization.';
    case 'VoiceAnalytics':
      return 'Provide current and historical voice activity context.';
    default:
      return `Produce relevant context for ${agentKind}.`;
  }
}

function successCriteriaForProvider(): string[] {
  return ['returns_context_packet'];
}

function filterProviders(providers: ContextProviderName[], skipMemory: boolean): ContextProviderName[] {
  return providers.filter((p) => !(skipMemory && p === 'Memory'));
}

export function getStandardProvidersForAgent(agentKind: AgentKind): ContextProviderName[] {
  const providers: ContextProviderName[] = ['Memory'];

  switch (agentKind) {
    case 'chat':
      // Chat uses SocialGraph for context, and potentially Summarizer/Voice via tools/dynamic selection
      // But standard baseline is Memory + SocialGraph
      return [...providers, 'SocialGraph', 'VoiceAnalytics'];
    // Coding and Search rely primarily on Memory + Tools + their specialized nature
    // Creative relies on Memory
    default:
      return providers;
  }
}

export function buildLinearContextGraph(params: {
  agentKind: AgentKind;
  providers: ContextProviderName[];
  skipMemory: boolean;
}): AgentGraph {
  const { agentKind, providers, skipMemory } = params;

  const filteredProviders = filterProviders(providers, skipMemory);
  const nodes: AgentTaskNode[] = filteredProviders.map((provider, index) => ({
    id: normalizeNodeId(provider, index),
    agent: provider,
    objective: objectiveForProvider(provider, agentKind),
    inputs: index === 0 ? ['user_input'] : [`node:${normalizeNodeId(filteredProviders[index - 1], index - 1)}`],
    successCriteria: successCriteriaForProvider(),
    budget: toTaskBudget(provider),
    dependsOn: index === 0 ? [] : [normalizeNodeId(filteredProviders[index - 1], index - 1)],
    metadata: {
      agentKind,
      provider,
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
    routeKind: agentKind,
    createdAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

export function buildFanoutContextGraph(params: {
  agentKind: AgentKind;
  providers: ContextProviderName[];
  skipMemory: boolean;
}): AgentGraph {
  const { agentKind, providers, skipMemory } = params;
  const filteredProviders = filterProviders(providers, skipMemory);

  const nodes: AgentTaskNode[] = filteredProviders.map((provider, index) => ({
    id: normalizeNodeId(provider, index),
    agent: provider,
    objective: objectiveForProvider(provider, agentKind),
    inputs: ['user_input'],
    successCriteria: successCriteriaForProvider(),
    budget: toTaskBudget(provider),
    dependsOn: [],
    metadata: {
      agentKind,
      provider,
      strategy: 'fanout',
    },
  }));

  return {
    version: 'v1',
    routeKind: agentKind,
    createdAt: new Date().toISOString(),
    nodes,
    edges: [],
  };
}

function shouldUseFanout(params: {
  agentKind: AgentKind;
  providers: ContextProviderName[];
  enableParallel: boolean;
}): boolean {
  if (!params.enableParallel) return false;
  if (params.providers.length <= 1) return false;

  // Context gathering is generally safe to fanout
  return true;
}

export function buildContextGraph(params: {
  agentKind: AgentKind;
  providers?: ContextProviderName[];
  skipMemory: boolean;
  enableParallel?: boolean;
}): AgentGraph {
  const { agentKind, skipMemory, enableParallel = true } = params;

  // Use provided providers or fallback to standard assignment
  const providers = params.providers && params.providers.length > 0
    ? params.providers
    : getStandardProvidersForAgent(agentKind);

  if (
    shouldUseFanout({
      agentKind,
      providers,
      enableParallel,
    })
  ) {
    return buildFanoutContextGraph({
      agentKind,
      providers,
      skipMemory,
    });
  }

  return buildLinearContextGraph({
    agentKind,
    providers,
    skipMemory,
  });
}

import { ContextProviderName } from '../context/context-types';
import { AgentKind, SearchExecutionMode } from '../orchestration/agentSelector';

const RUNTIME_AGENT_CAPABILITY_DESCRIPTORS: Array<{
  kind: AgentKind;
  purpose: string;
  runtimeCapabilities: string;
}> = [
  {
    kind: 'coding',
    purpose: 'Write, debug, explain, or refactor software/code',
    runtimeCapabilities:
      'Implement and debug code, reason about architecture and tests, and produce precise technical guidance.',
  },
  {
    kind: 'creative',
    purpose: 'Generate or edit images/visuals',
    runtimeCapabilities:
      'Run image-generation and image-editing workflows, then return asset-oriented responses.',
  },
  {
    kind: 'search',
    purpose: 'Fresh, time-sensitive, web-verifiable facts',
    runtimeCapabilities:
      'Run freshness-focused research and multi-pass synthesis when needed.',
  },
  {
    kind: 'chat',
    purpose: 'General discussion, analysis, discord/community/admin requests',
    runtimeCapabilities:
      'Handle conversational support, server/community context, and policy-aware revisions.',
  },
];

export interface BuildCapabilityPromptSectionParams {
  routeKind: AgentKind;
  searchMode: SearchExecutionMode | null;
  routerReasoning?: string | null;
  contextProviders: ContextProviderName[];
}

function formatRouteLabel(params: {
  routeKind: AgentKind;
  searchMode: SearchExecutionMode | null;
}): string {
  if (params.routeKind === 'search') {
    return `search (${params.searchMode ?? 'complex'} mode)`;
  }
  return params.routeKind;
}

function formatListLine(values: string[]): string {
  if (values.length === 0) return 'none';
  return values.join(', ');
}

function normalizeRouterReasoning(reasoning: string | null | undefined): string | null {
  const trimmed = reasoning?.trim();
  if (!trimmed) return null;
  const sanitized = trimmed.replace(/\s+/g, ' ');
  const maxChars = 360;
  if (sanitized.length <= maxChars) return sanitized;
  return `${sanitized.slice(0, maxChars - 3)}...`;
}

function formatAgentCapabilityMatrix(): string {
  return RUNTIME_AGENT_CAPABILITY_DESCRIPTORS
    .map(
      (descriptor) =>
        `- ${descriptor.kind}: ${descriptor.runtimeCapabilities} (primary scope: ${descriptor.purpose})`,
    )
    .join('\n');
}

function formatActiveRouteCapability(routeKind: AgentKind): string {
  const active = RUNTIME_AGENT_CAPABILITY_DESCRIPTORS.find(
    (descriptor) => descriptor.kind === routeKind,
  );
  if (!active) return '- Active route capability focus: unavailable.';
  return `- Active route capability focus: ${active.runtimeCapabilities}`;
}

function formatRouterReasoning(reasoning: string | null | undefined): string {
  const normalized = normalizeRouterReasoning(reasoning);
  if (!normalized) return '- Router rationale: not provided.';
  return `- Router rationale: ${normalized}`;
}

const ROUTER_ROUTE_OPTIONS: AgentKind[] = ['chat', 'coding', 'search', 'creative'];

export function buildAgenticStateBlock(params: BuildCapabilityPromptSectionParams): string {
  const state = {
    route_selected_by: 'router',
    current_route: params.routeKind,
    available_routes: ROUTER_ROUTE_OPTIONS,
    search_mode: params.routeKind === 'search' ? (params.searchMode ?? 'complex') : null,
    router_reasoning: normalizeRouterReasoning(params.routerReasoning),
    context_providers: params.contextProviders,
    verification_owner: 'critic',
    loop_stages: [
      'router_decision',
      'context_grounding',
      'critic_revision_or_redispatch',
      'final_answer',
    ],
  };

  return ['## Agentic State (JSON)', JSON.stringify(state, null, 2)].join('\n');
}

export function buildCapabilityPromptSection(
  params: BuildCapabilityPromptSectionParams,
): string {
  const routeLabel = formatRouteLabel({
    routeKind: params.routeKind,
    searchMode: params.searchMode,
  });
  const contextProviderLine = formatListLine(params.contextProviders);
  const routeOptionsLine = formatListLine(ROUTER_ROUTE_OPTIONS);

  return [
    '## Agent Capability Matrix',
    formatAgentCapabilityMatrix(),
    '## Runtime Capabilities',
    `- Active route (selected by router for this turn): ${routeLabel}.`,
    `- Router can choose these routes per turn: ${routeOptionsLine}.`,
    formatActiveRouteCapability(params.routeKind),
    formatRouterReasoning(params.routerReasoning),
    `- Context providers available this turn: ${contextProviderLine}.`,
    '- Verification and factual revision are handled by the critic loop, not as callable tools.',
    '## Agentic Loop Contract',
    '- This turn is part of one agentic loop: router decision -> context grounding -> critic revision/redispatch (if needed) -> final answer.',
    '- Routes share one context and memory substrate; keep decisions consistent with gathered evidence and prior loop state.',
    '- Complete the loop by returning a final answer consistent with the active route and gathered evidence.',
    '## Capability Behavior',
    '- Use listed capabilities when they materially improve correctness or user outcome.',
    '- If relevant, add one short next-step suggestion at the end of your answer.',
    '- Never claim or imply capabilities that are not listed above.',
  ].join('\n');
}

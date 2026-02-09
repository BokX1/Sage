import { ContextProviderName } from '../context/context-types';
import { AgentKind, SearchExecutionMode } from '../orchestration/agentSelector';

export interface RuntimeCapabilityTool {
  name: string;
  description: string;
}

export interface BuildCapabilityPromptSectionParams {
  routeKind: AgentKind;
  searchMode: SearchExecutionMode | null;
  allowTools: boolean;
  contextProviders: ContextProviderName[];
  tools: RuntimeCapabilityTool[];
  verificationTools: string[];
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

function formatToolLines(tools: RuntimeCapabilityTool[]): string {
  if (tools.length === 0) return '- none';
  return tools
    .slice(0, 24)
    .map((tool) => `- ${tool.name}: ${tool.description || 'No description provided.'}`)
    .join('\n');
}

function formatListLine(values: string[]): string {
  if (values.length === 0) return 'none';
  return values.join(', ');
}

export function buildCapabilityPromptSection(
  params: BuildCapabilityPromptSectionParams,
): string {
  const routeLabel = formatRouteLabel({
    routeKind: params.routeKind,
    searchMode: params.searchMode,
  });
  const contextProviderLine = formatListLine(params.contextProviders);
  const verificationLine = formatListLine(params.verificationTools);
  const toolCallingStatus = params.allowTools ? 'enabled' : 'disabled';

  return [
    '## Runtime Capabilities',
    `- Active route: ${routeLabel}.`,
    `- Context providers available this turn: ${contextProviderLine}.`,
    `- Tool calling: ${toolCallingStatus}.`,
    '### Callable Tools',
    formatToolLines(params.tools),
    `- Verification tools: ${verificationLine}.`,
    '## Capability Behavior',
    '- Use listed capabilities when they materially improve correctness or user outcome.',
    '- If relevant, add one short next-step suggestion at the end of your answer.',
    '- Never claim or imply capabilities that are not listed above.',
  ].join('\n');
}

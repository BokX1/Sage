import { AgentKind } from '../orchestration/agentSelector';
import { parseToolCallEnvelope } from './toolCallParser';

export const SEARCH_VERIFY_TOOL = 'verify_search_again';
export const CHAT_VERIFY_TOOL = 'verify_chat_again';
export const CODE_VERIFY_TOOL = 'verify_code_again';

export interface VerificationCall {
  name: string;
  args: Record<string, unknown>;
}

export interface VerificationIntent {
  wantsSearchRefresh: boolean;
  wantsRouteCrosscheck: boolean;
  requestedVirtualTools: string[];
  unknownTools: string[];
}

export function buildVerificationToolNames(routeKind: AgentKind): string[] {
  switch (routeKind) {
    case 'coding':
      return [SEARCH_VERIFY_TOOL, CODE_VERIFY_TOOL];
    case 'chat':
      return [SEARCH_VERIFY_TOOL, CHAT_VERIFY_TOOL];
    case 'search':
      return [SEARCH_VERIFY_TOOL];
    default:
      return [];
  }
}

export function deriveVerificationIntent(
  routeKind: AgentKind,
  calls: VerificationCall[],
): VerificationIntent {
  const allowedVirtualTools = new Set(buildVerificationToolNames(routeKind));
  const requestedVirtualTools: string[] = [];
  const unknownTools: string[] = [];

  for (const call of calls) {
    if (allowedVirtualTools.has(call.name)) {
      requestedVirtualTools.push(call.name);
    } else {
      unknownTools.push(call.name);
    }
  }

  const hasSearchCall = requestedVirtualTools.includes(SEARCH_VERIFY_TOOL);
  const hasRouteSpecificCall =
    (routeKind === 'chat' && requestedVirtualTools.includes(CHAT_VERIFY_TOOL)) ||
    (routeKind === 'coding' && requestedVirtualTools.includes(CODE_VERIFY_TOOL)) ||
    routeKind === 'search';
  const fallbackRouteCrosscheck = routeKind === 'chat' || routeKind === 'coding';

  return {
    wantsSearchRefresh: hasSearchCall || (routeKind === 'search' && (calls.length > 0 || unknownTools.length > 0)),
    wantsRouteCrosscheck: hasRouteSpecificCall || fallbackRouteCrosscheck,
    requestedVirtualTools,
    unknownTools,
  };
}

export function buildToolIntentReason(
  calls: Array<{
    name: string;
    args: Record<string, unknown>;
  }>,
): string {
  const parts = calls.map((call, index) => {
    const argKeys = Object.keys(call.args ?? {});
    const argPreview =
      argKeys.length > 0
        ? argKeys.map((key) => `${key}=${JSON.stringify(call.args[key])}`).join(', ')
        : 'no args';
    return `${index + 1}. ${call.name} (${argPreview})`;
  });

  return parts.length > 0
    ? `Tool verification requested:\n${parts.join('\n')}`
    : 'Tool verification requested without explicit details.';
}

export function stripToolEnvelopeDraft(text: string | null | undefined): string | null {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return null;
  return parseToolCallEnvelope(trimmed) ? null : trimmed;
}

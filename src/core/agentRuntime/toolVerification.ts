import { AgentKind } from '../orchestration/agentSelector';
import { parseToolCallEnvelope } from './toolCallParser';

const SEARCH_VERIFY_TOOL = 'verify_search_again';
const CHAT_VERIFY_TOOL = 'verify_chat_again';
const CODE_VERIFY_TOOL = 'verify_code_again';

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

import type { ToolResult } from './toolCallExecution';

export function collectPendingAdminActionIds(toolResults: ToolResult[]): string[] {
  const ids = new Set<string>();

  for (const toolResult of toolResults) {
    if (!toolResult.success) continue;

    const payload = toolResult.result;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      continue;
    }

    const record = payload as Record<string, unknown>;
    if (record.status !== 'pending_approval') continue;

    const actionId = record.actionId;
    if (typeof actionId !== 'string') continue;

    const trimmed = actionId.trim();
    if (trimmed) {
      ids.add(trimmed);
    }
  }

  return [...ids];
}

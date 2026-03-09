import type { ToolResult } from './toolCallExecution';

export type PendingAdminActionNotice = {
  actionId: string;
  coalesced: boolean;
};

export function collectPendingAdminActions(toolResults: ToolResult[]): PendingAdminActionNotice[] {
  const actions = new Map<string, PendingAdminActionNotice>();

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
      actions.set(trimmed, {
        actionId: trimmed,
        coalesced: record.coalesced === true,
      });
    }
  }

  return [...actions.values()];
}

export function collectPendingAdminActionIds(toolResults: ToolResult[]): string[] {
  return collectPendingAdminActions(toolResults).map((item) => item.actionId);
}

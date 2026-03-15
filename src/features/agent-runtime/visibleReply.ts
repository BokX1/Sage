import type { ToolResult } from './toolCallExecution';
import { scrubFinalReplyText } from './finalReplyScrubber';

export type LastResortVisibleReplyKind = 'turn' | 'continue_prompt' | 'continue_resume' | 'approval_resume';
export type RuntimeFailureReplyKind = 'turn' | 'continue_resume';
export type RuntimeFailureCategory = 'provider' | 'runtime';

function joinFlow(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

function buildToolNameRollup(
  entries: Array<{
    name: string;
  }>,
): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
    .join(', ');
}

function buildDeterministicToolSummary(toolResults: ToolResult[]): string {
  const successful = toolResults.filter((result) => result.success);
  const failed = toolResults
    .filter((result) => !result.success)
    .map((result) => `${result.name}${result.error ? ` (${result.error})` : ''}`);
  const parts: string[] = [];

  if (successful.length > 0) {
    parts.push(
      `Completed so far: ${successful.length} tool call${successful.length === 1 ? '' : 's'} (${buildToolNameRollup(successful)}).`,
    );
  }
  if (failed.length > 0) {
    parts.push(`Problems encountered: ${failed.join('; ')}.`);
  }

  return parts.join('\n\n').trim();
}

export function buildLastResortVisibleReply(kind: LastResortVisibleReplyKind): string {
  switch (kind) {
    case 'continue_prompt':
      return joinFlow([
        'I made progress on that, but I need another continuation window before Sage can finish it.',
        'Press Continue below if you want me to pick it up from here.',
      ]);
    case 'continue_resume':
      return joinFlow([
        'I picked that back up, but I do not have a clean update ready to post yet.',
        'Press Continue again if you want me to keep working from this point.',
      ]);
    case 'approval_resume':
      return joinFlow([
        'That review is resolved, but I do not have a clean follow-up ready to post yet.',
        'Ask me again here if you want another pass from the latest state.',
      ]);
    case 'turn':
    default:
      return joinFlow([
        'I made progress on that, but I do not have a clean reply ready to post yet.',
        'Send the next message and I will keep going from the current context.',
      ]);
  }
}

export function buildContinuationUnavailableReply(): string {
  return joinFlow([
    'That continuation is already closed, so I cannot reopen it from this button.',
    'Ask me again in this channel and I will continue from the latest state I have.',
  ]);
}

export function buildRuntimeFailureReply(params: {
  kind: RuntimeFailureReplyKind;
  category: RuntimeFailureCategory;
}): string {
  const failureText =
    params.category === 'provider'
      ? params.kind === 'continue_resume'
        ? 'The model behind Sage stopped responding while I was picking that request back up.'
        : 'The model behind Sage stopped responding before I could finish that reply.'
      : params.kind === 'continue_resume'
        ? 'Sage hit a snag while I was picking that request back up.'
        : 'Sage hit a snag before I could finish that reply.';

  const nextStepText =
    params.kind === 'continue_resume'
      ? 'Press Retry if it shows up. If not, press Continue again or send me a fresh message.'
      : 'Press Retry if it shows up, or send me that request again.';

  return joinFlow([failureText, nextStepText]);
}

export function finalizeVisibleReplyText(params: {
  replyText: string | null | undefined;
  preferredReplyText?: string | null | undefined;
  toolResults?: ToolResult[];
  allowEmpty?: boolean;
  preferEmptyFallback?: boolean;
  emptyFallback: string;
}): string {
  const cleanedPreferredReplyText = scrubFinalReplyText({
    replyText: params.preferredReplyText,
  });
  const cleanedReplyText = scrubFinalReplyText({
    replyText: params.replyText,
  });
  const fallbackToolSummary = buildDeterministicToolSummary(params.toolResults ?? []);

  if (cleanedPreferredReplyText) {
    return cleanedPreferredReplyText;
  }
  if (cleanedReplyText) {
    return cleanedReplyText;
  }
  if (fallbackToolSummary) {
    if (params.preferEmptyFallback) {
      return params.emptyFallback;
    }
    return fallbackToolSummary;
  }
  if (params.allowEmpty) {
    return '';
  }

  return params.emptyFallback;
}

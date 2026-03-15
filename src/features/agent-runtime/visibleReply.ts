import type { ToolResult } from './toolCallExecution';
import { scrubFinalReplyText } from './finalReplyScrubber';

export type LastResortVisibleReplyKind = 'turn' | 'continue_prompt' | 'continue_resume' | 'approval_resume';
export type RuntimeFailureReplyKind = 'turn' | 'continue_resume';
export type RuntimeFailureCategory = 'provider' | 'runtime';

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
      return [
        'I made progress on that, but I need another continuation window before Sage can finish it.',
        'Next: press Continue below if you want me to pick it up from here.',
      ].join(' ');
    case 'continue_resume':
      return [
        'I picked that back up, but I do not have a clean update ready to post yet.',
        'Next: press Continue again if you want me to keep working from this point.',
      ].join(' ');
    case 'approval_resume':
      return [
        'That review is resolved, but I do not have a clean follow-up ready to post yet.',
        'Next: ask me again here if you want another pass from the latest state.',
      ].join(' ');
    case 'turn':
    default:
      return [
        'I made progress on that, but I do not have a clean reply ready to post yet.',
        'Next: send the next message and I will keep going from the current context.',
      ].join(' ');
  }
}

export function buildContinuationUnavailableReply(): string {
  return [
    'That continuation is already closed, so I cannot reopen it from this button.',
    'Next: ask me again in this channel and I will continue from the latest state I have.',
  ].join(' ');
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
      ? 'Next: press Retry if it shows up. If not, press Continue again or send me a fresh message.'
      : 'Next: press Retry if it shows up, or send me that request again.';

  return [failureText, nextStepText].join(' ');
}

export function finalizeVisibleReplyText(params: {
  replyText: string | null | undefined;
  toolResults?: ToolResult[];
  allowEmpty?: boolean;
  emptyFallback: string;
}): string {
  const cleanedReplyText = scrubFinalReplyText({
    replyText: params.replyText,
  });
  const fallbackToolSummary = buildDeterministicToolSummary(params.toolResults ?? []);

  if (cleanedReplyText) {
    return cleanedReplyText;
  }
  if (fallbackToolSummary) {
    return fallbackToolSummary;
  }
  if (params.allowEmpty) {
    return '';
  }

  return params.emptyFallback;
}

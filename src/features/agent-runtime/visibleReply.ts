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
        'I made progress on that, but I need another continuation window to keep going from the current state.',
        'Next: press Continue below if you want me to carry on from here.',
      ].join(' ');
    case 'continue_resume':
      return [
        'I picked that request back up, but I do not have a good update ready to post yet.',
        'Next: press Continue again if you want me to keep working from this state.',
      ].join(' ');
    case 'approval_resume':
      return [
        'That review is resolved, but I do not have a follow-up reply ready to post yet.',
        'Next: ask me again here if you want another pass from the latest state.',
      ].join(' ');
    case 'turn':
    default:
      return [
        'I made progress on that, but I do not have a reply ready to post yet.',
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
        ? 'My model provider stopped responding before I could finish continuing that request.'
        : 'My model provider stopped responding before I could finish that turn.'
      : params.kind === 'continue_resume'
        ? 'Something went wrong on my side while I was continuing that request.'
        : 'Something went wrong on my side before I could finish that turn.';

  const nextStepText =
    params.kind === 'continue_resume'
      ? 'Next: use Retry below if it appears. If not, press Continue again or send a fresh message.'
      : 'Next: use Retry below if it appears, or send that request again.';

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

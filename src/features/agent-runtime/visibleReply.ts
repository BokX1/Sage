import type { ToolResult } from './toolCallExecution';
import { scrubFinalReplyText } from './finalReplyScrubber';

export type LastResortVisibleReplyKind = 'turn' | 'continue_resume' | 'approval_resume';
export type RuntimeFailureReplyKind = 'turn' | 'continue_resume';

function buildDeterministicToolSummary(toolResults: ToolResult[]): string {
  const successful = toolResults
    .filter((result) => result.success)
    .map((result) => result.name);
  const failed = toolResults
    .filter((result) => !result.success)
    .map((result) => `${result.name}${result.error ? ` (${result.error})` : ''}`);
  const parts: string[] = [];

  if (successful.length > 0) {
    parts.push(`Completed so far: ${successful.join(', ')}.`);
  }
  if (failed.length > 0) {
    parts.push(`Problems encountered: ${failed.join('; ')}.`);
  }

  return parts.join('\n\n').trim();
}

export function buildLastResortVisibleReply(kind: LastResortVisibleReplyKind): string {
  switch (kind) {
    case 'continue_resume':
      return [
        'I resumed that request, but I do not have a clean update ready to show yet.',
        'Next: press Continue again if you want me to keep going from the current state.',
      ].join(' ');
    case 'approval_resume':
      return [
        'The review is resolved, but I do not have a clean follow-up reply ready to post yet.',
        'Next: ask me again in this channel if you want another pass from the latest state.',
      ].join(' ');
    case 'turn':
    default:
      return [
        'I got to the end of that pass, but I do not have a clean reply ready to show yet.',
        'Next: send the next message and I will keep going from the current context.',
      ].join(' ');
  }
}

export function buildRuntimeFailureReply(kind: RuntimeFailureReplyKind): string {
  switch (kind) {
    case 'continue_resume':
      return [
        'I hit a runtime issue before I could finish that continuation.',
        'Next: press Continue again, or send a fresh message if it keeps happening.',
      ].join(' ');
    case 'turn':
    default:
      return [
        'I hit a runtime issue before I could finish that turn.',
        'Next: send it again and I will retry from the current context.',
      ].join(' ');
  }
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

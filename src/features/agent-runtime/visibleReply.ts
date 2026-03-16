import { scrubFinalReplyText } from './finalReplyScrubber';
import type { GraphDeliveryDisposition } from './langgraph/types';

export type LastResortVisibleReplyKind = 'turn' | 'continue_prompt' | 'continue_resume' | 'approval_resume';
export type RuntimeFailureReplyKind = 'turn' | 'continue_resume';
export type RuntimeFailureCategory = 'provider' | 'runtime';

function joinFlow(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ');
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
  deliveryDisposition: GraphDeliveryDisposition;
  emptyFallback: string;
}): string {
  const cleanedReplyText = scrubFinalReplyText({
    replyText: params.replyText,
  });
  if (cleanedReplyText) {
    return cleanedReplyText;
  }
  if (
    params.deliveryDisposition === 'tool_delivered' ||
    params.deliveryDisposition === 'approval_governance_only'
  ) {
    return '';
  }

  return params.emptyFallback;
}

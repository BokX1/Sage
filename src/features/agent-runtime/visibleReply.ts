import { scrubFinalReplyText } from './finalReplyScrubber';
import type { GraphDeliveryDisposition } from './langgraph/types';

export type LastResortVisibleReplyKind = 'turn' | 'continue_prompt' | 'continue_resume' | 'approval_resume';
export type RuntimeFailureReplyKind = 'turn' | 'continue_resume';
export type RuntimeFailureCategory = 'provider' | 'runtime';

export function buildLastResortVisibleReply(kind: LastResortVisibleReplyKind): string {
  switch (kind) {
    case 'continue_prompt':
      return 'I need you to press Continue so I can keep going.';
    case 'continue_resume':
      return 'I still need another Continue to keep going from here.';
    case 'approval_resume':
      return 'That review is done, so please ask me again if you want me to keep going.';
    case 'turn':
    default:
      return 'Please send me one more message so I can keep going.';
  }
}

export function buildContinuationUnavailableReply(): string {
  return "I can't reopen that anymore, so please send me a new message if you want me to keep going.";
}

export function buildRuntimeFailureReply(params: {
  kind: RuntimeFailureReplyKind;
  category: RuntimeFailureCategory;
}): string {
  if (params.category === 'provider') {
    return params.kind === 'continue_resume'
      ? 'I lost the model connection while I was picking that back up, so please press Retry or Continue again.'
      : 'I lost the model connection before I could finish, so please try again.';
  }

  return params.kind === 'continue_resume'
    ? 'I ran into a problem while I was picking that back up, so please press Retry or Continue again.'
    : 'I ran into a problem before I could finish, so please try again.';
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
  return params.emptyFallback;
}

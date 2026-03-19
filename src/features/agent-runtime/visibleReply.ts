import { scrubFinalReplyText } from './finalReplyScrubber';
import type { GraphDeliveryDisposition } from './langgraph/types';

export type LastResortVisibleReplyKind = 'turn' | 'background_resume' | 'approval_resume';
export type RuntimeFailureReplyKind = 'turn' | 'background_resume';
export type RuntimeFailureCategory =
  | 'provider'
  | 'provider_auth'
  | 'provider_config'
  | 'provider_model'
  | 'provider_rate_limit'
  | 'provider_timeout'
  | 'provider_network'
  | 'runtime';
export type TaskRunLimitReplyKind = 'duration' | 'idle_wait' | 'resume_limit';

export function buildLastResortVisibleReply(kind: LastResortVisibleReplyKind): string {
  switch (kind) {
    case 'background_resume':
      return 'I need one more message from you before I can keep going.';
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
  if (params.category === 'provider_auth') {
    return params.kind === 'background_resume'
      ? 'I lost access to the model while I was picking that back up, so please try again after fixing the key.'
      : 'I could not reach the model because the provider key or access is invalid.';
  }

  if (params.category === 'provider_model') {
    return 'The configured model could not handle that request, so please try again after fixing the model setup.';
  }

  if (params.category === 'provider_config') {
    return 'The configured model endpoint could not handle that request, so please try again after fixing the provider setup.';
  }

  if (params.category === 'provider_rate_limit') {
    return params.kind === 'background_resume'
      ? 'The model provider rate-limited me while I was picking that back up, so please try again.'
      : 'The model provider rate-limited me before I could finish, so please try again.';
  }

  if (
    params.category === 'provider' ||
    params.category === 'provider_timeout' ||
    params.category === 'provider_network'
  ) {
    return params.kind === 'background_resume'
      ? 'I lost the model connection while I was picking that back up, so please try again.'
      : 'I lost the model connection before I could finish, so please try again.';
  }

  return params.kind === 'background_resume'
    ? 'I ran into a problem while I was picking that back up, so please try again.'
    : 'I ran into a problem before I could finish, so please try again.';
}

export function buildTaskRunLimitReply(kind: TaskRunLimitReplyKind): string {
  switch (kind) {
    case 'idle_wait':
      return 'I waited too long for that reply, so please ask me again.';
    case 'resume_limit':
      return 'I had to stop that task after too many retries, so please ask me again.';
    case 'duration':
    default:
      return 'That task took too long, so please ask me again in a smaller step.';
  }
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

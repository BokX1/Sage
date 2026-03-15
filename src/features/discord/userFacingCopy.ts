function joinFlow(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

export function buildInteractionFailureText(): string {
  return joinFlow([
    'Sage hit a snag while I was handling that action.',
    'Try that button or form again.',
    'If it keeps happening, ask me to open a fresh flow here.',
  ]);
}

export function buildMessageFailureText(): string {
  return joinFlow([
    'Sage hit a snag before I could finish that reply.',
    'Try again.',
    'If it keeps happening, send a fresh message and I will start over from there.',
  ]);
}

export function buildExpiredInteractionText(kind: 'button' | 'form'): string {
  const subject = kind === 'form' ? 'form' : 'button';
  return [
    `This Sage ${subject} expired.`,
    'Why: interactive sessions stay live for a limited time.',
    'Next: ask Sage again to open a fresh one.',
  ].join(' ');
}

export function buildConsumedInteractionText(kind: 'button' | 'form'): string {
  const subject = kind === 'form' ? 'form' : 'button';
  return [
    `This Sage ${subject} was already used.`,
    'Next: wait for Sage to finish the first run, or ask Sage to open a fresh one if you still need it.',
  ].join(' ');
}

export function buildContinueOwnerMismatchText(): string {
  return [
    'This Continue button belongs to the person who asked Sage to keep going.',
    'Next: ask them to continue it, or ask Sage to start a fresh pass for you.',
  ].join(' ');
}

export function buildContinueChannelMismatchText(channelId: string): string {
  return [
    'This Continue button only works in the original channel.',
    `Next: go back to <#${channelId}> and use it there, or ask Sage for a fresh continuation here.`,
  ].join(' ');
}

export function buildRetryOwnerMismatchText(): string {
  return [
    'This Retry button belongs to the person who asked Sage for that retry.',
    'Next: ask them to retry it, or ask Sage to start a fresh pass for you.',
  ].join(' ');
}

export function buildRetryChannelMismatchText(channelId: string): string {
  return [
    'This Retry button only works in the original channel.',
    `Next: go back to <#${channelId}> and use it there, or ask Sage for a fresh pass here.`,
  ].join(' ');
}

export function buildContinuationButtonLabel(params?: {
  completedWindows?: number;
  maxWindows?: number;
}): string {
  const completed = params?.completedWindows;
  const max = params?.maxWindows;
  if (
    typeof completed === 'number' &&
    typeof max === 'number' &&
    Number.isFinite(completed) &&
    Number.isFinite(max) &&
    max > 1
  ) {
    const currentWindow = Math.min(max, completed + 1);
    return `Continue (${currentWindow}/${max})`;
  }
  return 'Continue';
}

export function buildRetryButtonLabel(): string {
  return 'Retry';
}

export function buildContinuationAccessDeniedText(): string {
  return [
    'I can only reopen that continuation for the original person in the original channel.',
    'Next: ask Sage there from a fresh message if you still need another pass.',
  ].join(' ');
}

export function buildContinuationAlreadyClosedText(): string {
  return [
    'That continuation is already closed.',
    'Next: send me a fresh message if you want another pass.',
  ].join(' ');
}

export function buildContinuationExpiredText(): string {
  return [
    'That continuation expired before I could reopen it.',
    'Next: send me a fresh message if you want me to keep going.',
  ].join(' ');
}

export function buildApprovalQueuedHandoffText(params?: {
  reviewChannelId?: string | null;
  sourceChannelId?: string | null;
}): string {
  const reviewChannelId = params?.reviewChannelId?.trim();
  const sourceChannelId = params?.sourceChannelId?.trim();
  if (reviewChannelId && reviewChannelId !== sourceChannelId) {
    return `I queued that for review. Next: check <#${reviewChannelId}> for the approval card.`;
  }

  return 'I queued that for review. Next: check the approval card for the next step.';
}

export function buildMissingHostedGuildActivationFallbackText(): string {
  return [
    'Sage is not active for this server yet.',
    'Why: the hosted bot does not have a server key for this guild yet.',
    'Next: ask a server admin to activate Hosted Sage for this server, then try again.',
  ].join(' ');
}

export function buildMissingSelfHostedGuildApiKeyText(): string {
  return [
    'Self-hosted Sage is not configured for chat in this server yet.',
    'Why: this bot instance has no `AI_PROVIDER_API_KEY`, and the hosted Pollinations server-key flow only applies to the hosted invite bot.',
    'Next: ask the bot operator to add the self-hosted provider key, then try again.',
  ].join(' ');
}

export function buildMissingHostApiKeyText(): string {
  return [
    'Sage is not configured for chat yet.',
    'Why: this self-hosted runtime has no `AI_PROVIDER_API_KEY` available.',
    'Next: add the host provider key for this bot instance, then try again.',
  ].join(' ');
}

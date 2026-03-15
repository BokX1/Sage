export function buildInteractionFailureText(): string {
  return [
    'Something went wrong while I was handling that interaction.',
    'Next: try it again.',
    'If it keeps happening, ask me to open a fresh flow.',
  ].join(' ');
}

export function buildMessageFailureText(): string {
  return [
    'Something went wrong while I was working on that reply.',
    'Next: try again.',
    'If it keeps happening, send a fresh message and I will restart from there.',
  ].join(' ');
}

export function buildExpiredInteractionText(kind: 'button' | 'form'): string {
  const subject = kind === 'form' ? 'form' : 'button';
  return [
    `This Sage ${subject} expired.`,
    'Why: interactive sessions stay live for a limited time.',
    'Next: ask Sage again to open a fresh one.',
  ].join(' ');
}

export function buildContinueOwnerMismatchText(): string {
  return [
    'This Continue button belongs to the person who started this request.',
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
    'This Retry button belongs to the person who started this request.',
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

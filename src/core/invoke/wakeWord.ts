export type Invocation = {
  kind: 'mention' | 'reply' | 'wakeword';
  cleanedText: string;
  intent: 'summarize' | 'qa' | 'action' | 'admin' | 'unknown';
};

export type DetectInvocationParams = {
  rawContent: string;
  isMentioned: boolean;
  isReplyToBot: boolean;
  botUserId?: string;
  wakeWords: string[];
  prefixes: string[];
};

const MENTION_REGEX = /<@!?\d+>/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMentions(text: string): string {
  return text.replace(MENTION_REGEX, '');
}

function stripLeadingPunctuation(text: string): string {
  return text.replace(/^[\p{P}\p{S}]+/u, '');
}

function detectIntent(text: string): Invocation['intent'] {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }

  if (
    /\b(summarize|summary|tldr|recap|catch up|what are they talking about)\b/i.test(
      normalized,
    )
  ) {
    return 'summarize';
  }

  if (normalized.startsWith('admin') || (normalized.includes('admin') && normalized.includes('stats'))) {
    return 'admin';
  }

  if (/\b(do|create|set|update)\b\s+\w+/i.test(normalized)) {
    return 'action';
  }

  if (/\?/.test(text) || /^\s*(what|why|how|when|where|can you)\b/i.test(normalized)) {
    return 'qa';
  }

  return 'unknown';
}

function cleanupText(text: string): string {
  return text.trim();
}

function buildWakeWordRegex(wakeWords: string[], prefixes: string[]): RegExp | null {
  const normalizedWakeWords = wakeWords.map((word) => word.trim()).filter(Boolean);
  if (normalizedWakeWords.length === 0) {
    return null;
  }

  const wakePattern = `(?:${normalizedWakeWords.map(escapeRegex).join('|')})`;
  const normalizedPrefixes = prefixes.map((prefix) => prefix.trim()).filter(Boolean);
  if (normalizedPrefixes.length > 0) {
    const prefixPattern = `(?:${normalizedPrefixes.map(escapeRegex).join('|')})`;
    return new RegExp(
      `^(?:(?:${prefixPattern})\\s+)?${wakePattern}(?=$|[\\s\\p{P}\\p{S}])`,
      'iu',
    );
  }

  return new RegExp(`^${wakePattern}(?=$|[\\s\\p{P}\\p{S}])`, 'iu');
}

function detectWakeWord(
  text: string,
  wakeWords: string[],
  prefixes: string[],
): { cleanedText: string } | null {
  const trimmed = cleanupText(text);
  if (!trimmed) {
    return null;
  }

  const withoutLeadingPunctuation = stripLeadingPunctuation(trimmed).trimStart();
  if (!withoutLeadingPunctuation) {
    return null;
  }

  const wakeRegex = buildWakeWordRegex(wakeWords, prefixes);
  if (!wakeRegex) {
    return null;
  }

  if (withoutLeadingPunctuation.length > 32) {
    const probe = withoutLeadingPunctuation.slice(0, 32);
    if (!wakeRegex.test(probe)) {
      return null;
    }
  }

  const match = withoutLeadingPunctuation.match(wakeRegex);
  if (!match || match.index !== 0) {
    return null;
  }

  const remainder = withoutLeadingPunctuation.slice(match[0].length);
  const cleanedText = remainder.replace(/^[\s\p{P}\p{S}]+/u, '').trim();
  if (!cleanedText) {
    return null;
  }

  return { cleanedText };
}

export function detectInvocation(params: DetectInvocationParams): Invocation | null {
  const { rawContent, isMentioned, isReplyToBot, wakeWords, prefixes } = params;

  const withoutMentions = stripMentions(rawContent);
  const cleanedBase = cleanupText(withoutMentions);

  if (isReplyToBot) {
    if (!cleanedBase) {
      return null;
    }
    return {
      kind: 'reply',
      cleanedText: cleanedBase,
      intent: detectIntent(cleanedBase),
    };
  }

  if (isMentioned) {
    if (!cleanedBase) {
      return null;
    }
    return {
      kind: 'mention',
      cleanedText: cleanedBase,
      intent: detectIntent(cleanedBase),
    };
  }

  const wakewordMatch = detectWakeWord(cleanedBase, wakeWords, prefixes);
  if (!wakewordMatch) {
    return null;
  }

  const { cleanedText } = wakewordMatch;
  return {
    kind: 'wakeword',
    cleanedText,
    intent: detectIntent(cleanedText),
  };
}

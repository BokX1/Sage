export type Invocation = {
  kind: 'mention' | 'reply' | 'wakeword' | 'autopilot';
  cleanedText: string;
  intent: 'autopilot' | 'unknown';
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


function cleanupText(text: string): string {
  return text.trim();
}

// Cache compiled wake-word regex patterns to avoid rebuilding on every call
const wakeWordRegexCache = new Map<string, RegExp | null>();

function getCachedWakeWordRegex(wakeWords: string[], prefixes: string[]): RegExp | null {
  const key = JSON.stringify([wakeWords, prefixes]);
  if (!wakeWordRegexCache.has(key)) {
    wakeWordRegexCache.set(key, buildWakeWordRegex(wakeWords, prefixes));
  }
  return wakeWordRegexCache.get(key) ?? null;
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
    return new RegExp(`^(?:(?:${prefixPattern})\\s+)?${wakePattern}(?=$|[\\s\\p{P}\\p{S}])`, 'iu');
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

  const wakeRegex = getCachedWakeWordRegex(wakeWords, prefixes);
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
      intent: 'unknown',
    };
  }

  if (isMentioned) {
    if (!cleanedBase) {
      return null;
    }
    return {
      kind: 'mention',
      cleanedText: cleanedBase,
      intent: 'unknown',
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
    intent: 'unknown',
  };
}

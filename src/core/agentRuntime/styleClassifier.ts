/**
 * Infer stylistic guidance from user text samples.
 *
 * Responsibilities:
 * - Classify immediate style signals from the latest prompt.
 * - Build an optional mimicry hint from recent user history.
 *
 * Non-goals:
 * - Persist user preferences.
 * - Apply style transformations directly.
 */
export type StyleLevel = 'low' | 'medium' | 'high';

export type HumorLevel = 'none' | 'subtle' | 'normal' | 'high';

/** Describe style dimensions consumed by prompt composition. */
export interface StyleProfile {
  verbosity: StyleLevel;
  formality: StyleLevel;
  humor: HumorLevel;
  directness: StyleLevel;
}

/**
 * Classify style attributes from a single user message.
 *
 * @param text - Raw user prompt text.
 * @returns Style profile inferred from keyword and length heuristics.
 *
 * Side effects:
 * - None.
 *
 * Error behavior:
 * - Never throws.
 *
 * Invariants:
 * - Every style dimension is always returned.
 */
export function classifyStyle(text: string): StyleProfile {
  const lower = text.toLowerCase();

  let humor: HumorLevel = 'normal';
  if (/\b(serious|no jokes|no humor|professional)\b/.test(lower)) {
    humor = 'none';
  } else if (/\b(joke|funny|hilarious|lol|lmao|crack me up)\b/.test(lower)) {
    humor = 'high';
  }

  let verbosity: StyleLevel = 'medium';
  const wordCount = text.split(/\s+/).length;

  if (/\b(brief|short|concise|summarize|tl;dr|quick)\b/.test(lower)) {
    verbosity = 'low';
  } else if (/\b(detail|explain|elaborate|comprehensive|step-by-step|guide)\b/.test(lower)) {
    verbosity = 'high';
  } else if (wordCount < 5) {
    verbosity = 'low';
  }

  let formality: StyleLevel = 'medium';
  if (/\b(sir|madam|please|kindly|regards|thank you)\b/.test(lower)) {
    formality = 'high';
  } else if (/\b(yo|sup|dude|bro|bruh|u|ur|plz)\b/.test(lower)) {
    formality = 'low';
  }

  let directness: StyleLevel = 'medium';
  if (/\b(just|only|merely)\b/.test(lower) && /\b(code|answer|result)\b/.test(lower)) {
    directness = 'high';
  }

  return { verbosity, formality, humor, directness };
}

/**
 * Generate a lightweight style mimicry instruction from user history.
 *
 * @param history - Recent user-authored messages ordered chronologically.
 * @returns A single instruction sentence or an empty string when no signal exists.
 *
 * Side effects:
 * - None.
 *
 * Error behavior:
 * - Never throws.
 *
 * Invariants:
 * - Output is safe to append to prompt context as plain text.
 */
export function analyzeUserStyle(history: string[]): string {
  if (!history || history.length === 0) return '';

  const total = history.length;
  let lowercaseCount = 0;
  let emojiCount = 0;
  let slangCount = 0;
  let shortCount = 0;
  let punctuationCount = 0;

  const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
  const slangRegex = /\b(lol|lmao|idk|rn|ur|u|pls|plz|thx|ty|omg|bruh|sup|yo|nah|yea)\b/i;

  for (const msg of history) {
    if (msg === msg.toLowerCase() && msg !== msg.toUpperCase()) lowercaseCount++;
    if (emojiRegex.test(msg)) emojiCount++;
    if (slangRegex.test(msg)) slangCount++;
    if (msg.split(/\s+/).length < 6) shortCount++;
    if (/[.!?]$/.test(msg.trim())) punctuationCount++;
  }

  const traits: string[] = [];

  if (lowercaseCount / total > 0.6) {
    traits.push('use all lowercase');
  }

  if (slangCount / total > 0.3) {
    traits.push('be very casual and use slang (lol, rn, ur)');
  } else if (punctuationCount / total > 0.8 && history.some((m) => m.length > 50)) {
    traits.push('be polite and use proper punctuation');
  } else {
    traits.push('be conversational');
  }

  if (emojiCount / total > 0.4) {
    traits.push('use emojis frequently 🌟');
  } else if (emojiCount > 0) {
    traits.push('use emojis occasionally');
  }

  if (shortCount / total > 0.7) {
    traits.push('keep responses short and punchy');
  }

  if (traits.length === 0) return '';
  return `Mirror the user's style: ${traits.join(', ')}.`;
}

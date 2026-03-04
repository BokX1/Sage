/**
 * Infer stylistic guidance from user text samples.
 *
 * Responsibilities:
 * - Classify immediate style signals from the latest user message.
 *
 * Non-goals:
 * - Persist user preferences.
 * - Apply style transformations directly.
 */
export type StyleLevel = 'low' | 'medium' | 'high';

/**
 * Represents the HumorLevel type.
 */
export type HumorLevel = 'none' | 'normal' | 'high';

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
  if (/\b(yo|sup|dude|bro|bruh|plz)\b/.test(lower) || /(?:^|\s)(u|ur)(?:\s|$)/.test(lower)) {
    formality = 'low';
  } else if (/\b(sir|madam|kindly|regards|thank you)\b/.test(lower)) {
    formality = 'high';
  }

  let directness: StyleLevel = 'medium';
  if (/\b(just|only|merely)\b/.test(lower) && /\b(code|answer|result)\b/.test(lower)) {
    directness = 'high';
  }

  return { verbosity, formality, humor, directness };
}

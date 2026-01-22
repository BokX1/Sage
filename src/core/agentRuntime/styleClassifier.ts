/**
 * Represent a relative intensity level for style dimensions.
 *
 * Details: used for verbosity, formality, and directness scoring.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export type StyleLevel = 'low' | 'medium' | 'high';
/**
 * Represent a relative humor preference level.
 *
 * Details: values range from no humor to high humor signals.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export type HumorLevel = 'none' | 'subtle' | 'normal' | 'high';

/**
 * Describe inferred style preferences from a user message.
 *
 * Details: aggregates heuristic signals into named style dimensions.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface StyleProfile {
  verbosity: StyleLevel;
  formality: StyleLevel;
  humor: HumorLevel;
  directness: StyleLevel;
}

/**
 * Classify style preferences from a user message.
 *
 * Details: applies deterministic keyword and length heuristics to infer
 * verbosity, formality, humor, and directness.
 *
 * Side effects: none.
 * Error behavior: none.
 *
 * @param text - User message text to analyze.
 * @returns Inferred style profile.
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

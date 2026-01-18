export type StyleLevel = 'low' | 'medium' | 'high';
export type HumorLevel = 'none' | 'subtle' | 'normal' | 'high';

export interface StyleProfile {
  verbosity: StyleLevel;
  formality: StyleLevel;
  humor: HumorLevel;
  directness: StyleLevel;
}

/**
 * Pure deterministic heuristics to classify user style from their message.
 * Inspects the input text for signals like length, specific keywords, and punctuation.
 */
export function classifyStyle(text: string): StyleProfile {
  const lower = text.toLowerCase();

  // 1. Humor (Default: normal)
  // Safety override: "serious", "no jokes", "be serious"
  let humor: HumorLevel = 'normal';
  if (/\b(serious|no jokes|no humor|professional)\b/.test(lower)) {
    humor = 'none';
  } else if (/\b(joke|funny|hilarious|lol|lmao|crack me up)\b/.test(lower)) {
    humor = 'high';
  }

  // 2. Verbosity (Default: medium)
  let verbosity: StyleLevel = 'medium';
  const wordCount = text.split(/\s+/).length;

  if (/\b(brief|short|concise|summarize|tl;dr|quick)\b/.test(lower)) {
    verbosity = 'low';
  } else if (/\b(detail|explain|elaborate|comprehensive|step-by-step|guide)\b/.test(lower)) {
    verbosity = 'high';
  } else if (wordCount < 5) {
    // Very short prompt often implies "just give me the answer" (low verbosity)
    // but we stick to medium or low.
    verbosity = 'low';
  }

  // 3. Formality (Default: medium)
  let formality: StyleLevel = 'medium';
  if (/\b(sir|madam|please|kindly|regards|thank you)\b/.test(lower)) {
    formality = 'high';
  } else if (/\b(yo|sup|dude|bro|bruh|u|ur|plz)\b/.test(lower)) {
    formality = 'low';
  }

  // 4. Directness (Default: medium)
  // "just the code", "only the answer" => high directness
  let directness: StyleLevel = 'medium';
  if (/\b(just|only|merely)\b/.test(lower) && /\b(code|answer|result)\b/.test(lower)) {
    directness = 'high';
  }

  return { verbosity, formality, humor, directness };
}

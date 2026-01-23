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

/**
 * Analyze a user's recent message history to generate a style mimicry instruction.
 * 
 * @param history - Array of recent user message strings.
 * @returns A natural language instruction for the LLM (e.g., "Write in all lowercase, be casual.").
 */
export function analyzeUserStyle(history: string[]): string {
  if (!history || history.length === 0) return '';

  const total = history.length;
  let lowercaseCount = 0;
  let emojiCount = 0;
  let slangCount = 0;
  let shortCount = 0;
  let questionCount = 0;
  let punctuationCount = 0; // Proper punctuation usage

  const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
  const slangRegex = /\b(lol|lmao|idk|rn|ur|u|pls|plz|thx|ty|omg|bruh|sup|yo|nah|yea)\b/i;

  for (const msg of history) {
    if (msg === msg.toLowerCase() && msg !== msg.toUpperCase()) lowercaseCount++;
    if (emojiRegex.test(msg)) emojiCount++;
    if (slangRegex.test(msg)) slangCount++;
    if (msg.split(/\s+/).length < 6) shortCount++;
    if (msg.includes('?')) questionCount++;
    if (/[.!?]$/.test(msg.trim())) punctuationCount++;
  }

  const traits: string[] = [];

  // Casing
  if (lowercaseCount / total > 0.6) {
    traits.push('use all lowercase');
  }

  // Tone/Formality
  if (slangCount / total > 0.3) {
    traits.push('be very casual and use slang (lol, rn, ur)');
  } else if (punctuationCount / total > 0.8 && history.some(m => m.length > 50)) {
    traits.push('be polite and use proper punctuation');
  } else {
    traits.push('be conversational');
  }

  // Emojis
  if (emojiCount / total > 0.4) {
    traits.push('use emojis frequently 🌟');
  } else if (emojiCount > 0) {
    traits.push('use emojis occasionally');
  }

  // Length
  if (shortCount / total > 0.7) {
    traits.push('keep responses short and punchy');
  }

  if (traits.length === 0) return '';

  return `Mirror the user's style: ${traits.join(', ')}.`;
}

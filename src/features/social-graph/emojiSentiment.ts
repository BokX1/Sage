const EMOJI_VALENCE: Record<string, number> = {
  // ── Strongly Positive (+0.8 to +1.0) ──
  '❤️': 1.0,
  '❤': 1.0,
  '😍': 1.0,
  '🥰': 1.0,
  '💕': 0.9,
  '💖': 0.9,
  '💗': 0.9,
  '💜': 0.9,
  '💙': 0.9,
  '💚': 0.9,
  '🧡': 0.9,
  '🤍': 0.8,
  '🫶': 0.8,
  '🥳': 0.9,
  '🎉': 0.8,
  '🎊': 0.8,

  // ── Positive (+0.3 to +0.7) ──
  '👍': 0.6,
  '👍🏻': 0.6,
  '👍🏼': 0.6,
  '👍🏽': 0.6,
  '👍🏾': 0.6,
  '👍🏿': 0.6,
  '✅': 0.5,
  '☑️': 0.5,
  '👏': 0.6,
  '🙌': 0.7,
  '💪': 0.5,
  '🔥': 0.5,
  '⭐': 0.5,
  '🌟': 0.5,
  '✨': 0.4,
  '😊': 0.5,
  '😄': 0.6,
  '😂': 0.4,
  '🤣': 0.4,
  '😁': 0.5,
  '😀': 0.4,
  '🙂': 0.3,
  '😃': 0.5,
  '💯': 0.6,
  '🆙': 0.3,
  '👌': 0.4,
  '🤝': 0.5,
  '🫡': 0.4,

  // ── Neutral (-0.2 to +0.2) ──
  '👀': 0.0,
  '🤔': 0.0,
  '😐': 0.0,
  '😶': 0.0,
  '🤷': 0.0,
  '❓': 0.0,
  '🧐': 0.0,
  '👁️': 0.0,
  '💤': -0.1,
  '😴': -0.1,
  '🥱': -0.1,

  // ── Negative (-0.3 to -0.7) ──
  '👎': -0.6,
  '👎🏻': -0.6,
  '👎🏼': -0.6,
  '👎🏽': -0.6,
  '👎🏾': -0.6,
  '👎🏿': -0.6,
  '😒': -0.4,
  '😕': -0.3,
  '🙁': -0.4,
  '😢': -0.5,
  '😭': -0.5,
  '😞': -0.5,
  '😔': -0.4,
  '❌': -0.5,
  '⛔': -0.5,
  '🚫': -0.5,
  '💔': -0.6,

  // ── Strongly Negative (-0.8 to -1.0) ──
  '😡': -0.9,
  '🤬': -1.0,
  '😠': -0.8,
  '🖕': -1.0,
  '💀': -0.3, // context-dependent, often humorous on Discord
  '☠️': -0.4,
  '🤮': -0.8,
  '🤢': -0.7,
  '😤': -0.6,
  '👿': -0.8,
  '😈': -0.3, // often playful on Discord
};

export function getEmojiSentiment(emoji: string): number {
  // Direct lookup
  const direct = EMOJI_VALENCE[emoji];
  if (direct !== undefined) return direct;

  // Try stripping variation selectors (VS16 = \uFE0F)
  const stripped = emoji.replace(/\uFE0F/g, '');
  const strippedResult = EMOJI_VALENCE[stripped];
  if (strippedResult !== undefined) return strippedResult;

  // Custom Discord emojis (e.g., <:pepeLaugh:123456>) — return neutral
  return 0.0;
}

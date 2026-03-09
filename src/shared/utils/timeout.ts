/**
 * @description Normalizes timeout values into safe bounded milliseconds.
 */
export type TimeoutNormalizationOptions = {
  fallbackMs: number;
  minMs?: number;
  maxMs?: number;
  belowMinMode?: 'fallback' | 'clamp';
};

const DEFAULT_FALLBACK_TIMEOUT_MS = 30_000;
const MAX_JS_TIMER_DELAY_MS = 2_147_483_647;

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const finiteValue = value as number;
  const normalized = Math.floor(finiteValue);
  return normalized > 0 ? normalized : fallback;
}

/** Clamp values to Node.js/JS timer-compatible millisecond bounds. */
function clampTimerDelayMs(value: number): number {
  return Math.min(value, MAX_JS_TIMER_DELAY_MS);
}

/**
 * Normalize a possibly invalid timeout into a bounded positive integer.
 *
 * @param rawTimeoutMs - User or config timeout candidate.
 * @param options - Fallback and bounds configuration.
 * @returns Safe timeout value in milliseconds.
 */
export function normalizeTimeoutMs(
  rawTimeoutMs: number | undefined,
  options: TimeoutNormalizationOptions,
): number {
  const fallbackMs = clampTimerDelayMs(toPositiveInt(options.fallbackMs, DEFAULT_FALLBACK_TIMEOUT_MS));
  const minMs = clampTimerDelayMs(toPositiveInt(options.minMs, 1));
  const maxMs = Math.max(minMs, clampTimerDelayMs(toPositiveInt(options.maxMs, MAX_JS_TIMER_DELAY_MS)));
  const boundedFallback = Math.min(Math.max(fallbackMs, minMs), maxMs);

  if (!Number.isFinite(rawTimeoutMs)) {
    return boundedFallback;
  }

  const finiteRawTimeoutMs = rawTimeoutMs as number;
  const normalized = clampTimerDelayMs(Math.floor(finiteRawTimeoutMs));
  if (normalized < minMs) {
    return options.belowMinMode === 'clamp' ? minMs : boundedFallback;
  }

  return Math.min(normalized, maxMs);
}

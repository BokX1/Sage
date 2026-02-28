export type TimeoutNormalizationOptions = {
  fallbackMs: number;
  minMs?: number;
  maxMs?: number;
  belowMinMode?: 'fallback' | 'clamp';
};

const DEFAULT_FALLBACK_TIMEOUT_MS = 30_000;

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

export function normalizeTimeoutMs(
  rawTimeoutMs: number | undefined,
  options: TimeoutNormalizationOptions,
): number {
  const fallbackMs = toPositiveInt(options.fallbackMs, DEFAULT_FALLBACK_TIMEOUT_MS);
  const minMs = toPositiveInt(options.minMs, 1);
  const maxMs = toPositiveInt(options.maxMs, Number.MAX_SAFE_INTEGER);
  const boundedFallback = Math.min(Math.max(fallbackMs, minMs), maxMs);

  if (typeof rawTimeoutMs !== 'number' || !Number.isFinite(rawTimeoutMs)) {
    return boundedFallback;
  }

  const normalized = Math.floor(rawTimeoutMs);
  if (normalized < minMs) {
    return options.belowMinMode === 'clamp' ? minMs : boundedFallback;
  }

  if (normalized > maxMs) {
    return maxMs;
  }

  return normalized;
}

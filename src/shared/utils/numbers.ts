/**
 * @description Shared numeric normalization helpers used across the codebase.
 */

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalize a bounded integer by clamping into [min, max].
 * Falls back when the input is not a finite number.
 */
export function normalizeBoundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!isFiniteNumber(value)) return fallback;
  const normalized = Math.floor(value);
  return Math.max(min, Math.min(max, normalized));
}

/**
 * Normalize an integer by clamping to at least `min`.
 * Falls back when the input is not a finite number.
 */
export function normalizeAtLeastInt(
  value: number | undefined,
  fallback: number,
  min: number,
): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

/** Normalize an integer to be non-negative (>= 0). */
export function normalizeNonNegativeInt(value: number | undefined, fallback: number): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/** Normalize an integer to be positive (>= 1). */
export function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

/**
 * Normalize an integer to be strictly positive (> 0).
 * Falls back when the input is not a finite number or is <= 0.
 */
export function normalizeStrictlyPositiveInt(value: number | undefined, fallback: number): number {
  if (!isFiniteNumber(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

/**
 * Normalize an integer to be strictly positive (> 0) after flooring.
 * Falls back when the floored input is <= 0.
 */
export function normalizePositiveIntOrFallback(value: number | undefined, fallback: number): number {
  if (!isFiniteNumber(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}


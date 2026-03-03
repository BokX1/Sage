/**
 * @module src/core/rate-limiter
 * @description Defines the rate limiter module.
 */
import { config } from '../config';

const limits = new Map<string, number[]>();

const DEFAULT_RATE_LIMIT_WINDOW_SEC = 10;
const DEFAULT_RATE_LIMIT_MAX = 5;
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute
let lastCleanup = Date.now();

/**
 * Runs isRateLimited.
 *
 * @param channelId - Describes the channelId input.
 * @returns Returns the function result.
 */
export function isRateLimited(channelId: string): boolean {
  const now = Date.now();
  const windowSec = config.RATE_LIMIT_WINDOW_SEC || DEFAULT_RATE_LIMIT_WINDOW_SEC;
  const max = config.RATE_LIMIT_MAX || DEFAULT_RATE_LIMIT_MAX;
  const windowMs = windowSec * 1000;

  // Periodic cleanup of stale channels to prevent memory leak
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    for (const [id, timestamps] of limits.entries()) {
      if (timestamps.every((t) => now - t >= windowMs)) {
        limits.delete(id);
      }
    }
    lastCleanup = now;
  }

  const timestamps = limits.get(channelId) || [];
  const validTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (validTimestamps.length >= max) {
    limits.set(channelId, validTimestamps);
    return true;
  }

  validTimestamps.push(now);
  limits.set(channelId, validTimestamps);
  return false;
}

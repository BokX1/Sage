import { limitConcurrency } from './concurrency';

interface KeyLimiterEntry {
    concurrency: number;
    limiter: <T>(fn: () => Promise<T>) => Promise<T>;
    lastUsed: number;
}

const limiters = new Map<string, KeyLimiterEntry>();

const CLEANUP_INTERVAL_MS = 300_000; // 5 minutes
const TTL_MS = 900_000; // 15 minutes idle time before cleanup
let lastCleanup = Date.now();

function assertValidConcurrency(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new RangeError('concurrency must be a positive integer');
    }
}

/**
 * Cleanup stale limiters that haven't been used recently.
 * Called periodically during normal operation.
 */
function cleanupStaleLimiters(): void {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;

    for (const [key, entry] of limiters.entries()) {
        if (now - entry.lastUsed > TTL_MS) {
            limiters.delete(key);
        }
    }
}

/**
 * Limit concurrent executions for a specific key.
 *
 * Details: creates one limiter per key; different keys can run in parallel while
 * the same key is capped by the provided concurrency.
 *
 * Side effects: caches and reuses per-key limiters in memory.
 * Stale limiters are cleaned up after 15 minutes of inactivity.
 * Error behavior: throws if concurrency is invalid or changes for an existing key.
 *
 * @param key - Unique identifier for the concurrency bucket.
 * @param concurrency - Maximum number of in-flight tasks for the key.
 * @returns Function that enforces the per-key concurrency limit.
 */
export function limitByKey(key: string, concurrency: number = 1) {
    assertValidConcurrency(concurrency);

    // Run cleanup periodically
    cleanupStaleLimiters();

    const now = Date.now();
    const existing = limiters.get(key);

    if (!existing) {
        const limiter = limitConcurrency(concurrency);
        limiters.set(key, { concurrency, limiter, lastUsed: now });
        return limiter;
    }

    if (existing.concurrency !== concurrency) {
        throw new RangeError(`concurrency for key "${key}" is already set to ${existing.concurrency}`);
    }

    // Update last used time
    existing.lastUsed = now;
    return existing.limiter;
}

/**
 * Drop the concurrency limiter for a key.
 *
 * Details: removing the limiter allows a fresh limiter to be created on the next call.
 *
 * Side effects: mutates the in-memory limiter cache.
 * Error behavior: none.
 *
 * @param key - Unique identifier for the concurrency bucket.
 */
export function clearKeyLimit(key: string) {
    limiters.delete(key);
}

/**
 * Get the current number of cached limiters (for testing/monitoring).
 */
export function getLimiterCount(): number {
    return limiters.size;
}

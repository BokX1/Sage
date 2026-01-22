import { limitConcurrency } from './concurrency';

const limiters = new Map<string, <T>(fn: () => Promise<T>) => Promise<T>>();

/**
 * Limit concurrent executions for a specific key.
 *
 * Details: creates one limiter per key; different keys can run in parallel while
 * the same key is capped by the provided concurrency.
 *
 * Side effects: caches and reuses per-key limiters in memory.
 * Error behavior: none.
 *
 * @param key - Unique identifier for the concurrency bucket.
 * @param concurrency - Maximum number of in-flight tasks for the key.
 * @returns Function that enforces the per-key concurrency limit.
 */
export function limitByKey(key: string, concurrency: number = 1) {
    if (!limiters.has(key)) {
        limiters.set(key, limitConcurrency(concurrency));
    }
    return limiters.get(key)!;
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

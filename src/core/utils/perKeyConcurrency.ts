import { limitConcurrency } from './concurrency';

type KeyLimiter = {
    concurrency: number;
    limiter: <T>(fn: () => Promise<T>) => Promise<T>;
};

const limiters = new Map<string, KeyLimiter>();

function assertValidConcurrency(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new RangeError('concurrency must be a positive integer');
    }
}

/**
 * Limit concurrent executions for a specific key.
 *
 * Details: creates one limiter per key; different keys can run in parallel while
 * the same key is capped by the provided concurrency.
 *
 * Side effects: caches and reuses per-key limiters in memory.
 * Error behavior: throws if concurrency is invalid or changes for an existing key.
 *
 * @param key - Unique identifier for the concurrency bucket.
 * @param concurrency - Maximum number of in-flight tasks for the key.
 * @returns Function that enforces the per-key concurrency limit.
 */
export function limitByKey(key: string, concurrency: number = 1) {
    assertValidConcurrency(concurrency);

    const existing = limiters.get(key);
    if (!existing) {
        const limiter = limitConcurrency(concurrency);
        limiters.set(key, { concurrency, limiter });
        return limiter;
    }

    if (existing.concurrency !== concurrency) {
        throw new RangeError(`concurrency for key "${key}" is already set to ${existing.concurrency}`);
    }

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

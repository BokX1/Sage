/**
 * @module src/core/utils/concurrency
 * @description Provides a lightweight in-memory concurrency limiter.
 */
/**
 * Limit concurrent async executions.
 *
 * Details: queues tasks beyond the configured concurrency. This mirrors p-limit
 * behavior while avoiding ESM/CJS compatibility issues in this project.
 *
 * Side effects: schedules asynchronous work and may defer execution.
 * Error behavior: rejects the returned promise if the task throws or rejects.
 *
 * @param concurrency - Maximum number of in-flight tasks.
 * @returns Function that enforces the concurrency limit for tasks.
 */
export function limitConcurrency(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }

  const queue: Array<(() => void) | undefined> = [];
  let queueHead = 0;
  let activeCount = 0;

  function enqueue(job: () => void): void {
    queue.push(job);
  }

  function dequeue(): (() => void) | undefined {
    if (queueHead >= queue.length) {
      return undefined;
    }

    const job = queue[queueHead];
    queue[queueHead] = undefined;
    queueHead += 1;

    // Compact consumed queue entries periodically to avoid unbounded sparse growth.
    if (queueHead > 1024 && queueHead * 2 >= queue.length) {
      queue.splice(0, queueHead);
      queueHead = 0;
    }

    return job;
  }

  function next(): void {
    activeCount -= 1;
    dequeue()?.();
  }

  async function runTask<T>(
    fn: () => Promise<T>,
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ): Promise<void> {
    activeCount += 1;
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      next();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const job = () => void runTask(fn, resolve, reject);
      if (activeCount < concurrency) {
        job();
      } else {
        enqueue(job);
      }
    });
}

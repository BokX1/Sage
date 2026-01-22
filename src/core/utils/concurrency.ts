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
    const queue: (() => void)[] = [];
    let activeCount = 0;

    const next = () => {
        activeCount--;
        if (queue.length > 0) {
            const job = queue.shift();
            job?.();
        }
    };

    const run = async (fn: () => Promise<any>, resolve: (value: any) => void, reject: (reason?: any) => void) => {
        activeCount++;
        try {
            const result = await fn();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            next();
        }
    };

    return <T>(fn: () => Promise<T>): Promise<T> => {
        return new Promise((resolve, reject) => {
            const job = () => run(fn, resolve, reject);

            if (activeCount < concurrency) {
                job();
            } else {
                queue.push(job);
            }
        });
    };
}

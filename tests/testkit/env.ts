/**
 * @module tests/testkit/env
 * @description Defines the env module.
 */
export type EnvSnapshot = Record<string, string | undefined>;

/**
 * Runs snapshotEnv.
 *
 * @returns Returns the function result.
 */
export function snapshotEnv(): EnvSnapshot {
  return { ...process.env };
}

/**
 * Runs restoreEnv.
 *
 * @param snapshot - Describes the snapshot input.
 * @returns Returns the function result.
 */
export function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

/**
 * Runs withEnv.
 *
 * @param patch - Describes the patch input.
 * @param fn - Describes the fn input.
 * @returns Returns the function result.
 */
export async function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const snapshot = snapshotEnv();
  Object.assign(process.env, patch);
  try {
    return await fn();
  } finally {
    restoreEnv(snapshot);
  }
}


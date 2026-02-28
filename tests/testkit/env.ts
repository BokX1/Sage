export type EnvSnapshot = Record<string, string | undefined>;

export function snapshotEnv(): EnvSnapshot {
  return { ...process.env };
}

export function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

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


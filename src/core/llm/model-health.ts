import { config } from '../config/legacy-config-adapter';
import { logger } from '../utils/logger';
import { clearModelHealthStates, listModelHealthStates, upsertModelHealthState } from './model-health-repo';

export interface RecordModelOutcomeParams {
  model: string;
  success: boolean;
  latencyMs?: number;
}

export interface ModelHealthEntry {
  score: number;
  samples: number;
  lastUpdatedAt: string;
}

const DEFAULT_HEALTH_SCORE = 0.5;
const ALPHA = 0.2;
const modelHealth = new Map<string, { score: number; samples: number; updatedAt: number }>();
const hydratedModelIds = new Set<string>();
const persistenceEnabled = !!config.agenticPersistStateEnabled;
let persistenceMode: 'db' | 'memory' = persistenceEnabled ? 'db' : 'memory';
let degradedMode = false;
let lastPersistenceError: string | null = null;
let hasLoggedModelHealthDegradedMode = false;

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function degradeModelHealthPersistence(error: unknown): void {
  persistenceMode = 'memory';
  degradedMode = true;
  lastPersistenceError = normalizeErrorMessage(error);
  if (!hasLoggedModelHealthDegradedMode) {
    logger.warn(
      { error: lastPersistenceError },
      'Model health persistence unavailable; falling back to in-memory degraded mode',
    );
    hasLoggedModelHealthDegradedMode = true;
  }
}

async function hydrateModelsFromPersistence(models: string[]): Promise<void> {
  const normalizedIds = Array.from(
    new Set(
      models
        .map(normalizeModelId)
        .filter((id) => id.length > 0 && !hydratedModelIds.has(id)),
    ),
  );
  if (normalizedIds.length === 0) return;

  if (!persistenceEnabled || persistenceMode !== 'db') {
    for (const id of normalizedIds) hydratedModelIds.add(id);
    return;
  }

  try {
    const rows = await listModelHealthStates(normalizedIds);
    const byModel = new Map(rows.map((row) => [normalizeModelId(row.modelId), row]));
    for (const id of normalizedIds) {
      const row = byModel.get(id);
      if (row) {
        modelHealth.set(id, {
          score: row.score,
          samples: row.samples,
          updatedAt: row.updatedAt.getTime(),
        });
      }
      hydratedModelIds.add(id);
    }
  } catch (error) {
    degradeModelHealthPersistence(error);
    for (const id of normalizedIds) hydratedModelIds.add(id);
  }
}

function scoreOutcome(params: RecordModelOutcomeParams): number {
  if (!params.success) return 0;
  const latency = Number(params.latencyMs);
  if (!Number.isFinite(latency) || latency <= 0) return 1;
  if (latency <= 30_000) return 1;
  if (latency <= 60_000) return 0.9;
  if (latency <= 120_000) return 0.75;
  return 0.6;
}

export function recordModelOutcome(params: RecordModelOutcomeParams): void {
  const model = normalizeModelId(params.model);
  if (!model) return;

  const now = Date.now();
  const outcomeScore = scoreOutcome(params);
  const existing = modelHealth.get(model);
  if (!existing) {
    modelHealth.set(model, {
      score: outcomeScore,
      samples: 1,
      updatedAt: now,
    });
    hydratedModelIds.add(model);
    if (persistenceEnabled && persistenceMode === 'db') {
      void upsertModelHealthState({
        modelId: model,
        score: outcomeScore,
        samples: 1,
      }).catch((error) => degradeModelHealthPersistence(error));
    }
    return;
  }

  existing.score = existing.score * (1 - ALPHA) + outcomeScore * ALPHA;
  existing.samples += 1;
  existing.updatedAt = now;
  modelHealth.set(model, existing);
  hydratedModelIds.add(model);
  if (persistenceEnabled && persistenceMode === 'db') {
    void upsertModelHealthState({
      modelId: model,
      score: existing.score,
      samples: existing.samples,
    }).catch((error) => degradeModelHealthPersistence(error));
  }
}

export async function getModelHealthScore(model: string): Promise<number> {
  const normalized = normalizeModelId(model);
  if (!normalized) return DEFAULT_HEALTH_SCORE;
  await hydrateModelsFromPersistence([normalized]);
  return modelHealth.get(normalized)?.score ?? DEFAULT_HEALTH_SCORE;
}

export async function getModelHealthScores(models: string[]): Promise<Record<string, number>> {
  await hydrateModelsFromPersistence(models);
  const scores: Record<string, number> = {};
  for (const model of models) {
    const normalized = normalizeModelId(model);
    if (!normalized || scores[normalized] !== undefined) continue;
    scores[normalized] = modelHealth.get(normalized)?.score ?? DEFAULT_HEALTH_SCORE;
  }
  return scores;
}

export function getModelHealthSnapshot(models?: string[]): Record<string, ModelHealthEntry> {
  const ids = models && models.length > 0 ? models.map(normalizeModelId) : [...modelHealth.keys()];
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)));
  const snapshot: Record<string, ModelHealthEntry> = {};

  for (const id of unique) {
    const existing = modelHealth.get(id);
    if (!existing) {
      snapshot[id] = {
        score: DEFAULT_HEALTH_SCORE,
        samples: 0,
        lastUpdatedAt: new Date(0).toISOString(),
      };
      continue;
    }

    snapshot[id] = {
      score: existing.score,
      samples: existing.samples,
      lastUpdatedAt: new Date(existing.updatedAt).toISOString(),
    };
  }

  return snapshot;
}

export function resetModelHealth(): void {
  modelHealth.clear();
  hydratedModelIds.clear();
  if (persistenceEnabled && persistenceMode === 'db') {
    void clearModelHealthStates().catch((error) => degradeModelHealthPersistence(error));
  }
  if (!persistenceEnabled) {
    persistenceMode = 'memory';
  }
}

export function getModelHealthRuntimeStatus(): {
  persistenceEnabled: boolean;
  persistenceMode: 'db' | 'memory';
  degradedMode: boolean;
  lastPersistenceError: string | null;
} {
  return {
    persistenceEnabled,
    persistenceMode,
    degradedMode,
    lastPersistenceError,
  };
}

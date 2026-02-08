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

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
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
    return;
  }

  existing.score = existing.score * (1 - ALPHA) + outcomeScore * ALPHA;
  existing.samples += 1;
  existing.updatedAt = now;
  modelHealth.set(model, existing);
}

export function getModelHealthScore(model: string): number {
  const normalized = normalizeModelId(model);
  if (!normalized) return DEFAULT_HEALTH_SCORE;
  return modelHealth.get(normalized)?.score ?? DEFAULT_HEALTH_SCORE;
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
}

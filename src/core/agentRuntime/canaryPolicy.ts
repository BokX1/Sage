import { logger } from '../utils/logger';
import { clearPersistedCanaryState, readPersistedCanaryState, writePersistedCanaryState } from './canaryStateRepo';

export interface AgenticCanaryConfig {
  enabled: boolean;
  rolloutPercent: number;
  routeAllowlist: string[];
  maxFailureRate: number;
  minSamples: number;
  cooldownMs: number;
  windowSize: number;
  persistStateEnabled: boolean;
}

export interface AgenticCanaryDecision {
  allowAgentic: boolean;
  reason:
    | 'disabled'
    | 'route_not_allowlisted'
    | 'out_of_rollout_sample'
    | 'error_budget_cooldown'
    | 'allowed';
  samplePercent?: number;
}

export const CANARY_OUTCOME_REASON_CODES = [
  'graph_failed_tasks',
  'hard_gate_unmet',
  'tool_loop_failed',
] as const;

export type AgenticCanaryOutcomeReason = (typeof CANARY_OUTCOME_REASON_CODES)[number];

export interface AgenticCanaryOutcome {
  success: boolean;
  reasonCodes: AgenticCanaryOutcomeReason[];
  recordedAt: string;
}

export interface AgenticCanarySnapshot {
  totalSamples: number;
  totalFailures: number;
  failureRate: number;
  cooldownUntil: string | null;
  tripped: boolean;
  recentFailureReasonCounts: Record<AgenticCanaryOutcomeReason, number>;
  latestOutcome: AgenticCanaryOutcome | null;
  persistenceMode: 'db' | 'memory';
  degradedMode: boolean;
  lastPersistenceError: string | null;
}

type CanaryOutcomeSample = {
  success: boolean;
  reasonCodes: AgenticCanaryOutcomeReason[];
  recordedAtMs: number;
};

type CanaryState = {
  outcomes: CanaryOutcomeSample[];
  cooldownUntilMs: number;
  initialized: boolean;
  persistenceMode: 'db' | 'memory';
  degradedMode: boolean;
  lastPersistenceError: string | null;
};

const state: CanaryState = {
  outcomes: [],
  cooldownUntilMs: 0,
  initialized: false,
  persistenceMode: 'memory',
  degradedMode: false,
  lastPersistenceError: null,
};

let hasLoggedCanaryDegradedMode = false;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeRouteAllowlist(allowlist: string[]): string[] {
  return Array.from(
    new Set(
      allowlist
        .map((route) => route.trim().toLowerCase())
        .filter((route) => route.length > 0),
    ),
  );
}

export function normalizeCanaryConfig(input: Partial<AgenticCanaryConfig>): AgenticCanaryConfig {
  const rolloutRaw = Number(input.rolloutPercent);
  const maxFailureRaw = Number(input.maxFailureRate);
  const minSamplesRaw = Number(input.minSamples);
  const cooldownRaw = Number(input.cooldownMs);
  const windowRaw = Number(input.windowSize);

  return {
    enabled: !!input.enabled,
    rolloutPercent: Number.isFinite(rolloutRaw) ? Math.max(0, Math.min(100, rolloutRaw)) : 100,
    routeAllowlist: normalizeRouteAllowlist(input.routeAllowlist ?? []),
    maxFailureRate: clamp01(Number.isFinite(maxFailureRaw) ? maxFailureRaw : 0.3),
    minSamples: Number.isFinite(minSamplesRaw) ? Math.max(1, Math.floor(minSamplesRaw)) : 20,
    cooldownMs: Number.isFinite(cooldownRaw) ? Math.max(1_000, Math.floor(cooldownRaw)) : 300_000,
    windowSize: Number.isFinite(windowRaw) ? Math.max(10, Math.floor(windowRaw)) : 100,
    persistStateEnabled: !!input.persistStateEnabled,
  };
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function routeIsAllowlisted(route: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.includes(route.trim().toLowerCase());
}

function computeFailureRate(outcomes: CanaryOutcomeSample[]): number {
  if (outcomes.length === 0) return 0;
  const failures = outcomes.filter((entry) => !entry.success).length;
  return failures / outcomes.length;
}

function createEmptyReasonCounts(): Record<AgenticCanaryOutcomeReason, number> {
  return {
    graph_failed_tasks: 0,
    hard_gate_unmet: 0,
    tool_loop_failed: 0,
  };
}

function normalizeReasonCodes(input: unknown): AgenticCanaryOutcomeReason[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }
  const allowed = new Set<string>(CANARY_OUTCOME_REASON_CODES);
  const normalized = new Set<AgenticCanaryOutcomeReason>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const lowered = item.trim().toLowerCase();
    if (allowed.has(lowered)) {
      normalized.add(lowered as AgenticCanaryOutcomeReason);
    }
  }
  return [...normalized];
}

function parseOutcomeSamples(value: unknown): CanaryOutcomeSample[] {
  if (!Array.isArray(value)) return [];
  const samples: CanaryOutcomeSample[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const success = typeof record.success === 'boolean' ? record.success : null;
    const recordedAtMs = Number(record.recordedAtMs);
    if (success === null || !Number.isFinite(recordedAtMs)) continue;
    samples.push({
      success,
      reasonCodes: success ? [] : normalizeReasonCodes(record.reasonCodes),
      recordedAtMs: Math.floor(recordedAtMs),
    });
  }
  return samples;
}

function parsePersistedState(row: { outcomesJson: unknown; cooldownUntil: Date | null }): {
  outcomes: CanaryOutcomeSample[];
  cooldownUntilMs: number;
} {
  return {
    outcomes: parseOutcomeSamples(row.outcomesJson),
    cooldownUntilMs: row.cooldownUntil ? row.cooldownUntil.getTime() : 0,
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function degradeCanaryPersistence(error: unknown): void {
  state.persistenceMode = 'memory';
  state.degradedMode = true;
  state.lastPersistenceError = normalizeErrorMessage(error);
  if (!hasLoggedCanaryDegradedMode) {
    logger.warn(
      { error: state.lastPersistenceError },
      'Canary persistence unavailable; falling back to in-memory degraded mode',
    );
    hasLoggedCanaryDegradedMode = true;
  }
}

async function ensureCanaryStateInitialized(config: AgenticCanaryConfig): Promise<void> {
  if (state.initialized) return;
  state.initialized = true;
  if (!config.persistStateEnabled) {
    state.persistenceMode = 'memory';
    state.degradedMode = false;
    state.lastPersistenceError = null;
    return;
  }

  try {
    const persisted = await readPersistedCanaryState();
    if (persisted) {
      const parsed = parsePersistedState(persisted);
      state.outcomes = parsed.outcomes;
      state.cooldownUntilMs = parsed.cooldownUntilMs;
    }
    state.persistenceMode = 'db';
    state.degradedMode = false;
    state.lastPersistenceError = null;
  } catch (error) {
    degradeCanaryPersistence(error);
  }
}

async function persistCanaryState(config: AgenticCanaryConfig): Promise<void> {
  if (!config.persistStateEnabled || state.persistenceMode !== 'db') return;
  try {
    await writePersistedCanaryState({
      outcomesJson: state.outcomes,
      cooldownUntilMs: state.cooldownUntilMs,
    });
  } catch (error) {
    degradeCanaryPersistence(error);
  }
}

function pushOutcome(outcome: CanaryOutcomeSample, windowSize: number): void {
  state.outcomes.push(outcome);
  while (state.outcomes.length > windowSize) {
    state.outcomes.shift();
  }
}

export async function evaluateAgenticCanary(params: {
  traceId: string;
  routeKind: string;
  guildId: string | null;
  config: AgenticCanaryConfig;
  nowMs?: number;
}): Promise<AgenticCanaryDecision> {
  await ensureCanaryStateInitialized(params.config);
  const nowMs = params.nowMs ?? Date.now();
  const routeKind = params.routeKind.trim().toLowerCase();

  if (!params.config.enabled) {
    return { allowAgentic: true, reason: 'disabled' };
  }

  if (!routeIsAllowlisted(routeKind, params.config.routeAllowlist)) {
    return { allowAgentic: false, reason: 'route_not_allowlisted' };
  }

  if (nowMs < state.cooldownUntilMs) {
    return { allowAgentic: false, reason: 'error_budget_cooldown' };
  }

  const sampleKey = `${params.guildId ?? 'noguild'}:${routeKind}:${params.traceId}`;
  const sample = (fnv1a32(sampleKey) % 10_000) / 100;
  if (sample >= params.config.rolloutPercent) {
    return {
      allowAgentic: false,
      reason: 'out_of_rollout_sample',
      samplePercent: sample,
    };
  }

  return {
    allowAgentic: true,
    reason: 'allowed',
    samplePercent: sample,
  };
}

export async function recordAgenticOutcome(params: {
  success: boolean;
  reasonCodes?: AgenticCanaryOutcomeReason[];
  config: AgenticCanaryConfig;
  nowMs?: number;
}): Promise<void> {
  await ensureCanaryStateInitialized(params.config);
  const nowMs = params.nowMs ?? Date.now();
  const reasonCodes = params.success ? [] : normalizeReasonCodes(params.reasonCodes);
  pushOutcome(
    {
      success: params.success,
      reasonCodes,
      recordedAtMs: nowMs,
    },
    params.config.windowSize,
  );

  if (state.outcomes.length >= params.config.minSamples) {
    const failureRate = computeFailureRate(state.outcomes);
    if (failureRate > params.config.maxFailureRate) {
      state.cooldownUntilMs = Math.max(state.cooldownUntilMs, nowMs + params.config.cooldownMs);
    }
  }

  await persistCanaryState(params.config);
}

export async function getAgenticCanarySnapshot(params?: {
  nowMs?: number;
  config?: AgenticCanaryConfig;
}): Promise<AgenticCanarySnapshot> {
  const nowMs = params?.nowMs ?? Date.now();
  if (params?.config) {
    await ensureCanaryStateInitialized(params.config);
  }
  const totalSamples = state.outcomes.length;
  const totalFailures = state.outcomes.filter((entry) => !entry.success).length;
  const failureRate = totalSamples > 0 ? totalFailures / totalSamples : 0;
  const tripped = nowMs < state.cooldownUntilMs;
  const reasonCounts = createEmptyReasonCounts();
  for (const entry of state.outcomes) {
    if (entry.success) continue;
    for (const reasonCode of entry.reasonCodes) {
      reasonCounts[reasonCode] += 1;
    }
  }
  const latestOutcomeEntry = state.outcomes.length > 0 ? state.outcomes[state.outcomes.length - 1] : null;
  const latestOutcome = latestOutcomeEntry
    ? {
        success: latestOutcomeEntry.success,
        reasonCodes: [...latestOutcomeEntry.reasonCodes],
        recordedAt: new Date(latestOutcomeEntry.recordedAtMs).toISOString(),
      }
    : null;

  return {
    totalSamples,
    totalFailures,
    failureRate,
    cooldownUntil: state.cooldownUntilMs > 0 ? new Date(state.cooldownUntilMs).toISOString() : null,
    tripped,
    recentFailureReasonCounts: reasonCounts,
    latestOutcome,
    persistenceMode: state.persistenceMode,
    degradedMode: state.degradedMode,
    lastPersistenceError: state.lastPersistenceError,
  };
}

export async function resetAgenticCanaryState(config?: AgenticCanaryConfig): Promise<void> {
  const persistEnabled = !!config?.persistStateEnabled || state.persistenceMode === 'db';
  if (persistEnabled) {
    await clearPersistedCanaryState();
  }
  state.outcomes = [];
  state.cooldownUntilMs = 0;
  state.initialized = false;
  state.persistenceMode = 'memory';
  state.degradedMode = false;
  state.lastPersistenceError = null;
  hasLoggedCanaryDegradedMode = false;
}

export function parseRouteAllowlistCsv(csv: string | undefined | null): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

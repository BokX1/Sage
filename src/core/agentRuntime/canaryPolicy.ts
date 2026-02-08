export interface AgenticCanaryConfig {
  enabled: boolean;
  rolloutPercent: number;
  routeAllowlist: string[];
  maxFailureRate: number;
  minSamples: number;
  cooldownMs: number;
  windowSize: number;
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

export interface AgenticCanarySnapshot {
  totalSamples: number;
  totalFailures: number;
  failureRate: number;
  cooldownUntil: string | null;
  tripped: boolean;
}

type CanaryState = {
  outcomes: boolean[];
  cooldownUntilMs: number;
};

const state: CanaryState = {
  outcomes: [],
  cooldownUntilMs: 0,
};

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

function computeFailureRate(outcomes: boolean[]): number {
  if (outcomes.length === 0) return 0;
  const failures = outcomes.filter((success) => !success).length;
  return failures / outcomes.length;
}

function pushOutcome(success: boolean, windowSize: number): void {
  state.outcomes.push(success);
  while (state.outcomes.length > windowSize) {
    state.outcomes.shift();
  }
}

export function evaluateAgenticCanary(params: {
  traceId: string;
  routeKind: string;
  guildId: string | null;
  config: AgenticCanaryConfig;
  nowMs?: number;
}): AgenticCanaryDecision {
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

export function recordAgenticOutcome(params: {
  success: boolean;
  config: AgenticCanaryConfig;
  nowMs?: number;
}): void {
  const nowMs = params.nowMs ?? Date.now();
  pushOutcome(params.success, params.config.windowSize);

  if (state.outcomes.length < params.config.minSamples) {
    return;
  }

  const failureRate = computeFailureRate(state.outcomes);
  if (failureRate > params.config.maxFailureRate) {
    state.cooldownUntilMs = Math.max(state.cooldownUntilMs, nowMs + params.config.cooldownMs);
  }
}

export function getAgenticCanarySnapshot(nowMs = Date.now()): AgenticCanarySnapshot {
  const totalSamples = state.outcomes.length;
  const totalFailures = state.outcomes.filter((success) => !success).length;
  const failureRate = totalSamples > 0 ? totalFailures / totalSamples : 0;
  const tripped = nowMs < state.cooldownUntilMs;

  return {
    totalSamples,
    totalFailures,
    failureRate,
    cooldownUntil: state.cooldownUntilMs > 0 ? new Date(state.cooldownUntilMs).toISOString() : null,
    tripped,
  };
}

export function resetAgenticCanaryState(): void {
  state.outcomes = [];
  state.cooldownUntilMs = 0;
}

export function parseRouteAllowlistCsv(csv: string | undefined | null): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

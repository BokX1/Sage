import { AgentKind } from '../orchestration/agentSelector';

export type ValidationStrictness = 'off' | 'warn' | 'enforce';

export interface RouteValidationPolicy {
  strictness: ValidationStrictness;
  checkEmptyReply: boolean;
  checkToolEnvelopeLeak: boolean;
  checkUnsupportedCertainty: boolean;
  checkSearchSourceUrls: boolean;
  checkSearchCheckedOnDate: boolean;
}

type RouteValidationPolicyOverride = Partial<
  Omit<RouteValidationPolicy, 'strictness'> & {
    strictness: ValidationStrictness;
  }
>;

const DEFAULT_ROUTE_POLICIES: Record<AgentKind, RouteValidationPolicy> = {
  search: {
    strictness: 'enforce',
    checkEmptyReply: true,
    checkToolEnvelopeLeak: true,
    checkUnsupportedCertainty: true,
    checkSearchSourceUrls: true,
    checkSearchCheckedOnDate: true,
  },
  coding: {
    strictness: 'warn',
    checkEmptyReply: true,
    checkToolEnvelopeLeak: true,
    checkUnsupportedCertainty: true,
    checkSearchSourceUrls: false,
    checkSearchCheckedOnDate: false,
  },
  chat: {
    strictness: 'warn',
    checkEmptyReply: true,
    checkToolEnvelopeLeak: true,
    checkUnsupportedCertainty: true,
    checkSearchSourceUrls: false,
    checkSearchCheckedOnDate: false,
  },
  creative: {
    strictness: 'off',
    checkEmptyReply: false,
    checkToolEnvelopeLeak: false,
    checkUnsupportedCertainty: false,
    checkSearchSourceUrls: false,
    checkSearchCheckedOnDate: false,
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeStrictness(
  value: unknown,
  fallback: ValidationStrictness,
): ValidationStrictness {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'warn' || normalized === 'enforce') {
    return normalized;
  }
  return fallback;
}

function normalizeOverride(
  base: RouteValidationPolicy,
  override: unknown,
): RouteValidationPolicy {
  const record = asRecord(override);
  if (!record) return base;

  return {
    strictness: normalizeStrictness(record.strictness, base.strictness),
    checkEmptyReply: asBoolean(record.checkEmptyReply) ?? base.checkEmptyReply,
    checkToolEnvelopeLeak:
      asBoolean(record.checkToolEnvelopeLeak) ?? base.checkToolEnvelopeLeak,
    checkUnsupportedCertainty:
      asBoolean(record.checkUnsupportedCertainty) ?? base.checkUnsupportedCertainty,
    checkSearchSourceUrls:
      asBoolean(record.checkSearchSourceUrls) ?? base.checkSearchSourceUrls,
    checkSearchCheckedOnDate:
      asBoolean(record.checkSearchCheckedOnDate) ?? base.checkSearchCheckedOnDate,
  };
}

function parsePolicyJson(
  policyJson: string | undefined,
): {
  defaultOverride: RouteValidationPolicyOverride | null;
  routeOverrides: Partial<Record<AgentKind, RouteValidationPolicyOverride>>;
} {
  const empty = {
    defaultOverride: null,
    routeOverrides: {} as Partial<Record<AgentKind, RouteValidationPolicyOverride>>,
  };
  const raw = policyJson?.trim();
  if (!raw) return empty;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const root = asRecord(parsed);
    if (!root) return empty;

    const routeOverrides: Partial<Record<AgentKind, RouteValidationPolicyOverride>> = {};
    const defaultOverride = asRecord(root.default) as RouteValidationPolicyOverride | null;
    for (const route of ['chat', 'coding', 'search', 'creative'] as const) {
      const routeRecord = asRecord(root[route]) as RouteValidationPolicyOverride | null;
      if (routeRecord) {
        routeOverrides[route] = routeRecord;
      }
    }

    return {
      defaultOverride,
      routeOverrides,
    };
  } catch {
    return empty;
  }
}

export function resolveRouteValidationPolicy(params: {
  routeKind: AgentKind;
  validatorsEnabled: boolean;
  policyJson?: string;
}): RouteValidationPolicy {
  const routeKind = params.routeKind;
  const base = { ...DEFAULT_ROUTE_POLICIES[routeKind] };
  const { defaultOverride, routeOverrides } = parsePolicyJson(params.policyJson);
  const mergedWithDefault = defaultOverride
    ? normalizeOverride(base, defaultOverride)
    : base;
  const mergedRoute = routeOverrides[routeKind]
    ? normalizeOverride(mergedWithDefault, routeOverrides[routeKind])
    : mergedWithDefault;

  if (!params.validatorsEnabled) {
    return {
      ...mergedRoute,
      strictness: 'off',
    };
  }

  return mergedRoute;
}

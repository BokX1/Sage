export interface TenantAgenticPolicy {
  maxParallel?: number;
  critic?: {
    enabled?: boolean;
    maxLoops?: number;
    minScore?: number;
  };
  tools?: {
    allowExternalWrite?: boolean;
    allowHighRisk?: boolean;
    blockedTools?: string[];
  };
  allowedModels?: string[];
}

export interface TenantPolicyRegistry {
  default?: TenantAgenticPolicy;
  guilds?: Record<string, TenantAgenticPolicy>;
}

export interface ResolvedTenantPolicy {
  maxParallel?: number;
  criticEnabled?: boolean;
  criticMaxLoops?: number;
  criticMinScore?: number;
  toolAllowExternalWrite?: boolean;
  toolAllowHighRisk?: boolean;
  toolBlockedTools?: string[];
  allowedModels?: string[];
}

let cachedRaw = '';
let cachedRegistry: TenantPolicyRegistry = {};

function parseRegistry(rawJson: string): TenantPolicyRegistry {
  const trimmed = rawJson.trim();
  if (!trimmed) return {};

  if (trimmed === cachedRaw) {
    return cachedRegistry;
  }

  try {
    const parsed = JSON.parse(trimmed) as TenantPolicyRegistry;
    cachedRaw = trimmed;
    cachedRegistry = parsed ?? {};
    return cachedRegistry;
  } catch {
    cachedRaw = trimmed;
    cachedRegistry = {};
    return {};
  }
}

function normalizeModelList(models: string[] | undefined): string[] | undefined {
  if (!models || models.length === 0) return undefined;
  const deduped = Array.from(
    new Set(
      models
        .map((model) => model.trim().toLowerCase())
        .filter((model) => model.length > 0),
    ),
  );
  return deduped.length > 0 ? deduped : undefined;
}

function normalizeToolList(tools: string[] | undefined): string[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const deduped = Array.from(
    new Set(
      tools
        .map((tool) => tool.trim().toLowerCase())
        .filter((tool) => tool.length > 0),
    ),
  );
  return deduped.length > 0 ? deduped : undefined;
}

function normalizeInteger(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeScore(value: number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

export function resolveTenantPolicy(params: {
  guildId: string | null;
  policyJson: string | undefined;
}): ResolvedTenantPolicy {
  const registry = parseRegistry(params.policyJson ?? '');
  const defaultPolicy = registry.default ?? {};
  const guildPolicy = params.guildId ? registry.guilds?.[params.guildId] : undefined;
  const merged: TenantAgenticPolicy = {
    ...defaultPolicy,
    ...guildPolicy,
    critic: {
      ...(defaultPolicy.critic ?? {}),
      ...(guildPolicy?.critic ?? {}),
    },
    tools: {
      ...(defaultPolicy.tools ?? {}),
      ...(guildPolicy?.tools ?? {}),
    },
  };

  return {
    maxParallel: normalizeInteger(merged.maxParallel, 1, 16),
    criticEnabled: merged.critic?.enabled,
    criticMaxLoops: normalizeInteger(merged.critic?.maxLoops, 0, 2),
    criticMinScore: normalizeScore(merged.critic?.minScore),
    toolAllowExternalWrite: merged.tools?.allowExternalWrite,
    toolAllowHighRisk: merged.tools?.allowHighRisk,
    toolBlockedTools: normalizeToolList(merged.tools?.blockedTools),
    allowedModels: normalizeModelList(merged.allowedModels),
  };
}

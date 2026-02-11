import type { ToolRiskClassValue } from './toolRegistry';

export type ToolRiskClass = ToolRiskClassValue;

export type ToolPolicyDecisionCode =
  | 'allow_unconfigured'
  | 'allowed'
  | 'blocked_tool'
  | 'max_calls_per_round_truncated'
  | 'unclassified_tool_high_risk'
  | 'network_read_disabled'
  | 'data_exfiltration_disabled'
  | 'external_write_disabled'
  | 'high_risk_disabled';

export interface ToolPolicyConfig {
  allowNetworkRead?: boolean;
  allowDataExfiltrationRisk?: boolean;
  allowExternalWrite?: boolean;
  allowHighRisk?: boolean;
  blockedTools?: string[];
  riskOverrides?: Record<string, ToolRiskClass>;
}

export interface ToolPolicyDecision {
  allow: boolean;
  risk: ToolRiskClass;
  code: ToolPolicyDecisionCode;
  reason: string;
}

const TOOL_RISK_CLASSES: readonly ToolRiskClass[] = [
  'read_only',
  'network_read',
  'data_exfiltration_risk',
  'external_write',
  'high_risk',
] as const;

const TOOL_RISK_CLASS_SET = new Set<ToolRiskClass>(TOOL_RISK_CLASSES);

const DEFAULT_TOOL_RISK: Record<string, ToolRiskClass> = {
  get_current_datetime: 'read_only',
  web_search: 'network_read',
  web_scrape: 'network_read',
  github_repo_lookup: 'network_read',
  github_file_lookup: 'network_read',
  npm_package_lookup: 'network_read',
  wikipedia_lookup: 'network_read',
  stack_overflow_search: 'network_read',
  channel_file_lookup: 'data_exfiltration_risk',
  local_llm_models: 'read_only',
  local_llm_infer: 'data_exfiltration_risk',
  join_voice_channel: 'external_write',
  leave_voice_channel: 'external_write',
  // Backward-compatible aliases used in older tests/prompts.
  join_voice: 'external_write',
  leave_voice: 'external_write',
};

const FAIL_CLOSED_TOOL_POLICY: ToolPolicyConfig = {
  allowNetworkRead: false,
  allowDataExfiltrationRisk: false,
  allowExternalWrite: false,
  allowHighRisk: false,
  blockedTools: [],
};

type ToolRiskSource = 'override' | 'declared' | 'default' | 'fallback';

function isToolRiskClass(value: unknown): value is ToolRiskClass {
  return typeof value === 'string' && TOOL_RISK_CLASS_SET.has(value as ToolRiskClass);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeBlockedTools(blockedTools: string[] | undefined): string[] {
  if (!blockedTools) return [];
  return Array.from(
    new Set(
      blockedTools
        .map((tool) => normalizeToolName(tool))
        .filter((tool) => tool.length > 0),
    ),
  );
}

function normalizeRiskOverrides(
  overrides: Record<string, ToolRiskClass> | undefined,
): Record<string, ToolRiskClass> | undefined {
  if (!overrides) return undefined;
  const normalizedEntries = Object.entries(overrides)
    .map(([toolName, risk]) => [normalizeToolName(toolName), risk] as const)
    .filter(([toolName, risk]) => toolName.length > 0 && isToolRiskClass(risk));
  if (normalizedEntries.length === 0) return undefined;
  return Object.fromEntries(normalizedEntries);
}

function parseBooleanFlag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parseBlockedTools(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return parseToolBlocklistCsv(value);
  }
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((entry): entry is string => typeof entry === 'string');
  return normalizeBlockedTools(filtered);
}

function parseRiskOverrides(value: unknown): Record<string, ToolRiskClass> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const normalizedEntries = Object.entries(record)
    .map(([toolName, risk]) => [normalizeToolName(toolName), risk] as const)
    .filter(([toolName, risk]) => toolName.length > 0 && isToolRiskClass(risk));
  if (normalizedEntries.length === 0) return undefined;
  return Object.fromEntries(normalizedEntries) as Record<string, ToolRiskClass>;
}

export function mergeToolPolicyConfig(
  base: ToolPolicyConfig | undefined,
  overlay: ToolPolicyConfig | undefined,
): ToolPolicyConfig {
  const mergedBlocked = normalizeBlockedTools([
    ...(base?.blockedTools ?? []),
    ...(overlay?.blockedTools ?? []),
  ]);
  const mergedRiskOverrides = normalizeRiskOverrides({
    ...(base?.riskOverrides ?? {}),
    ...(overlay?.riskOverrides ?? {}),
  });
  return {
    allowNetworkRead: overlay?.allowNetworkRead ?? base?.allowNetworkRead,
    allowDataExfiltrationRisk:
      overlay?.allowDataExfiltrationRisk ?? base?.allowDataExfiltrationRisk,
    allowExternalWrite: overlay?.allowExternalWrite ?? base?.allowExternalWrite,
    allowHighRisk: overlay?.allowHighRisk ?? base?.allowHighRisk,
    blockedTools: mergedBlocked,
    riskOverrides: mergedRiskOverrides,
  };
}

export function classifyToolRisk(
  toolName: string,
  config?: ToolPolicyConfig,
  declaredRisk?: ToolRiskClass,
): ToolRiskClass {
  return resolveToolRisk(toolName, config, declaredRisk).risk;
}

function resolveToolRisk(
  toolName: string,
  config?: ToolPolicyConfig,
  declaredRisk?: ToolRiskClass,
): { risk: ToolRiskClass; source: ToolRiskSource; normalizedToolName: string } {
  const normalized = normalizeToolName(toolName);
  const override = config?.riskOverrides?.[normalized];
  if (override && isToolRiskClass(override)) {
    return {
      risk: override,
      source: 'override',
      normalizedToolName: normalized,
    };
  }
  if (declaredRisk && isToolRiskClass(declaredRisk)) {
    return {
      risk: declaredRisk,
      source: 'declared',
      normalizedToolName: normalized,
    };
  }
  if (DEFAULT_TOOL_RISK[normalized]) {
    return {
      risk: DEFAULT_TOOL_RISK[normalized],
      source: 'default',
      normalizedToolName: normalized,
    };
  }
  return {
    risk: 'high_risk',
    source: 'fallback',
    normalizedToolName: normalized,
  };
}

export function evaluateToolPolicy(
  toolName: string,
  config?: ToolPolicyConfig,
  declaredRisk?: ToolRiskClass,
): ToolPolicyDecision {
  const classification = resolveToolRisk(toolName, config, declaredRisk);
  const normalized = classification.normalizedToolName;
  const risk = classification.risk;
  if (!config) {
    return {
      allow: true,
      risk,
      code: 'allow_unconfigured',
      reason: `No policy configured for "${normalized}", allowing execution.`,
    };
  }

  const blocked = new Set(normalizeBlockedTools(config.blockedTools));
  const allowNetworkRead = config.allowNetworkRead ?? true;
  const allowDataExfiltrationRisk = config.allowDataExfiltrationRisk ?? true;
  const allowExternalWrite = config.allowExternalWrite ?? false;
  const allowHighRisk = config.allowHighRisk ?? false;

  if (classification.source === 'fallback' && !allowHighRisk) {
    return {
      allow: false,
      risk,
      code: 'unclassified_tool_high_risk',
      reason: `Tool "${normalized}" has no risk metadata and is treated as high-risk by default.`,
    };
  }

  if (blocked.has(normalized)) {
    return {
      allow: false,
      risk,
      code: 'blocked_tool',
      reason: `Tool "${normalized}" is blocked by policy.`,
    };
  }

  if (risk === 'high_risk' && !allowHighRisk) {
    return {
      allow: false,
      risk,
      code: 'high_risk_disabled',
      reason: `Tool "${normalized}" is high-risk and is disabled by policy.`,
    };
  }

  if (risk === 'external_write' && !allowExternalWrite) {
    return {
      allow: false,
      risk,
      code: 'external_write_disabled',
      reason: `Tool "${normalized}" performs external side effects and is disabled by policy.`,
    };
  }

  if (risk === 'data_exfiltration_risk' && !allowDataExfiltrationRisk) {
    return {
      allow: false,
      risk,
      code: 'data_exfiltration_disabled',
      reason: `Tool "${normalized}" is classified as data-exfiltration risk and is disabled by policy.`,
    };
  }

  if (risk === 'network_read' && !allowNetworkRead) {
    return {
      allow: false,
      risk,
      code: 'network_read_disabled',
      reason: `Tool "${normalized}" requires network reads and is disabled by policy.`,
    };
  }

  return {
    allow: true,
    risk,
    code: 'allowed',
    reason: `Tool "${normalized}" is allowed by policy.`,
  };
}

export function parseToolPolicyJson(raw: string | undefined | null): ToolPolicyConfig | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const root = asRecord(parsed);
    if (!root) return { ...FAIL_CLOSED_TOOL_POLICY };
    const candidate = (asRecord(root.default) ?? root) as Record<string, unknown>;
    const blockedTools = parseBlockedTools(candidate.blockedTools);
    const parsedConfig: ToolPolicyConfig = {
      allowNetworkRead: parseBooleanFlag(candidate.allowNetworkRead),
      allowDataExfiltrationRisk: parseBooleanFlag(candidate.allowDataExfiltrationRisk),
      allowExternalWrite: parseBooleanFlag(candidate.allowExternalWrite),
      allowHighRisk: parseBooleanFlag(candidate.allowHighRisk),
      blockedTools,
      riskOverrides: parseRiskOverrides(candidate.riskOverrides),
    };
    const hasAnyConfig = Object.values(parsedConfig).some((value) => value !== undefined);
    if (!hasAnyConfig) return undefined;
    return parsedConfig;
  } catch {
    return { ...FAIL_CLOSED_TOOL_POLICY };
  }
}

export function parseToolBlocklistCsv(csv: string | undefined | null): string[] {
  if (!csv) return [];
  return normalizeBlockedTools(
    csv
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

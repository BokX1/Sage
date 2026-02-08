export type ToolRiskClass = 'read_only' | 'external_write' | 'high_risk';

export interface ToolPolicyConfig {
  allowExternalWrite: boolean;
  allowHighRisk: boolean;
  blockedTools: string[];
  riskOverrides?: Record<string, ToolRiskClass>;
}

export interface ToolPolicyDecision {
  allow: boolean;
  risk: ToolRiskClass;
  reason?: string;
}

const DEFAULT_TOOL_RISK: Record<string, ToolRiskClass> = {
  join_voice: 'external_write',
  leave_voice: 'external_write',
};

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeBlockedTools(blockedTools: string[]): Set<string> {
  return new Set(
    blockedTools
      .map((tool) => normalizeToolName(tool))
      .filter((tool) => tool.length > 0),
  );
}

export function classifyToolRisk(toolName: string, config?: ToolPolicyConfig): ToolRiskClass {
  const normalized = normalizeToolName(toolName);
  const override = config?.riskOverrides?.[normalized];
  if (override) return override;
  return DEFAULT_TOOL_RISK[normalized] ?? 'read_only';
}

export function evaluateToolPolicy(toolName: string, config?: ToolPolicyConfig): ToolPolicyDecision {
  if (!config) {
    return {
      allow: true,
      risk: classifyToolRisk(toolName),
    };
  }

  const normalized = normalizeToolName(toolName);
  const blocked = normalizeBlockedTools(config.blockedTools);
  const risk = classifyToolRisk(normalized, config);

  if (blocked.has(normalized)) {
    return {
      allow: false,
      risk,
      reason: `Tool "${normalized}" is blocked by policy.`,
    };
  }

  if (risk === 'high_risk' && !config.allowHighRisk) {
    return {
      allow: false,
      risk,
      reason: `Tool "${normalized}" is high-risk and requires explicit approval.`,
    };
  }

  if (risk === 'external_write' && !config.allowExternalWrite) {
    return {
      allow: false,
      risk,
      reason: `Tool "${normalized}" performs external side effects and is disabled by policy.`,
    };
  }

  return { allow: true, risk };
}

export function parseToolBlocklistCsv(csv: string | undefined | null): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

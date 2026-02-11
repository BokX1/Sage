interface ParsedToolBudget {
  toolsExecuted: boolean;
  successfulToolCount: number;
  toolResultCount: number;
  failed: boolean;
}

export interface TraceToolTelemetry {
  signalPresent: boolean;
  enabled: boolean | null;
  routeToolCount: number;
  legacyExecuted: boolean;
  main: ParsedToolBudget | null;
  critic: ParsedToolBudget[];
  toolsExecuted: boolean;
  successfulToolCount: number;
  toolResultCount: number;
  hardGateRequired: boolean;
  hardGateSatisfied: boolean | null;
  hardGateForcedPassUsed: boolean;
  toolLoopFailed: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseBudget(value: unknown): ParsedToolBudget | null {
  const record = asRecord(value);
  if (!record) return null;

  const hasKnownField =
    Object.prototype.hasOwnProperty.call(record, 'toolsExecuted') ||
    Object.prototype.hasOwnProperty.call(record, 'successfulToolCount') ||
    Object.prototype.hasOwnProperty.call(record, 'toolResultCount') ||
    Object.prototype.hasOwnProperty.call(record, 'failed');

  if (!hasKnownField) return null;

  return {
    toolsExecuted: readBoolean(record, 'toolsExecuted') ?? false,
    successfulToolCount: Math.max(0, Math.floor(readNumber(record, 'successfulToolCount') ?? 0)),
    toolResultCount: Math.max(0, Math.floor(readNumber(record, 'toolResultCount') ?? 0)),
    failed: readBoolean(record, 'failed') ?? false,
  };
}

export function parseTraceToolTelemetry(toolJson: unknown): TraceToolTelemetry {
  const root = asRecord(toolJson);
  if (!root) {
    return {
      signalPresent: false,
      enabled: null,
      routeToolCount: 0,
      legacyExecuted: false,
      main: null,
      critic: [],
      toolsExecuted: false,
      successfulToolCount: 0,
      toolResultCount: 0,
      hardGateRequired: false,
      hardGateSatisfied: null,
      hardGateForcedPassUsed: false,
      toolLoopFailed: false,
    };
  }

  const main = parseBudget(root.main);
  const criticRaw = Array.isArray(root.critic) ? root.critic : [];
  const critic = criticRaw
    .map((entry) => parseBudget(entry))
    .filter((entry): entry is ParsedToolBudget => entry !== null);
  const legacyExecuted = readBoolean(root, 'executed') ?? false;
  const enabled = readBoolean(root, 'enabled');
  const routeTools = Array.isArray(root.routeTools) ? root.routeTools : [];
  const routeToolCount = routeTools.length;
  const mainRecord = asRecord(root.main);
  const hardGateRequired = readBoolean(mainRecord, 'hardGateRequired') ?? false;
  const hardGateSatisfied = readBoolean(mainRecord, 'hardGateSatisfied');
  const hardGateForcedPassUsed = !!(mainRecord && mainRecord.hardGateForcedPass);
  const successfulToolCount =
    (main?.successfulToolCount ?? 0) +
    critic.reduce((sum, budget) => sum + budget.successfulToolCount, 0);
  const toolResultCount = (main?.toolResultCount ?? 0) + critic.reduce((sum, budget) => sum + budget.toolResultCount, 0);
  const toolsExecuted =
    legacyExecuted ||
    (main?.toolsExecuted ?? false) ||
    critic.some((budget) => budget.toolsExecuted) ||
    successfulToolCount > 0;
  const toolLoopFailed = (main?.failed ?? false) || critic.some((budget) => budget.failed);

  return {
    signalPresent: true,
    enabled,
    routeToolCount,
    legacyExecuted,
    main,
    critic,
    toolsExecuted,
    successfulToolCount,
    toolResultCount,
    hardGateRequired,
    hardGateSatisfied,
    hardGateForcedPassUsed,
    toolLoopFailed,
  };
}

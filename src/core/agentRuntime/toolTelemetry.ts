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
  main: ParsedToolBudget | null;
  toolsExecuted: boolean;
  successfulToolCount: number;
  toolResultCount: number;
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
      main: null,
      toolsExecuted: false,
      successfulToolCount: 0,
      toolResultCount: 0,
      toolLoopFailed: false,
    };
  }

  const main = parseBudget(root.main);
  const enabled = readBoolean(root, 'enabled');
  const routeTools = Array.isArray(root.routeTools) ? root.routeTools : [];
  const routeToolCount = routeTools.length;
  const successfulToolCount = main?.successfulToolCount ?? 0;
  const toolResultCount = main?.toolResultCount ?? 0;
  const toolsExecuted =
    (main?.toolsExecuted ?? false) ||
    successfulToolCount > 0;
  const toolLoopFailed = main?.failed ?? false;

  return {
    signalPresent: true,
    enabled,
    routeToolCount,
    main,
    toolsExecuted,
    successfulToolCount,
    toolResultCount,
    toolLoopFailed,
  };
}

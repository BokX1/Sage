/** Model typed error categories emitted by tool execution stages. */
export type ToolErrorKind = 'validation' | 'execution' | 'timeout';

/**
 * Actionable failure categories surfaced to the model for recovery planning.
 * These are orthogonal to ToolErrorKind (which is about *where* the failure happened).
 */
export type ToolFailureCategory =
  | 'validation'
  | 'guardrail'
  | 'timeout'
  | 'rate_limited'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'bad_request'
  | 'server_error'
  | 'network_error'
  | 'misconfigured'
  | 'upstream_error'
  | 'unknown';

export interface ToolErrorDetails {
  category: ToolFailureCategory;
  httpStatus?: number;
  retryAfterMs?: number;
  provider?: string;
  host?: string;
  url?: string;
  code?: string;
  operationKey?: string;
  timeoutMs?: number;
  hint?: string;
  retryable?: boolean;
}

function defaultRetryable(category: ToolFailureCategory, httpStatus?: number): boolean {
  if (category === 'validation') return false;
  if (category === 'guardrail') return false;
  if (category === 'misconfigured') return false;
  if (category === 'not_found') return false;
  if (category === 'bad_request') return false;
  if (category === 'unauthorized') return false;
  if (category === 'forbidden') return false;

  if (category === 'timeout') return true;
  if (category === 'rate_limited') return true;
  if (category === 'network_error') return true;

  if (category === 'server_error' || category === 'upstream_error') {
    return true;
  }

  if (typeof httpStatus === 'number') {
    if (httpStatus >= 500) return true;
    if (httpStatus === 429) return true;
  }

  return false;
}

export function buildToolErrorDetails(details: ToolErrorDetails): ToolErrorDetails {
  return {
    ...details,
    retryable:
      typeof details.retryable === 'boolean'
        ? details.retryable
        : defaultRetryable(details.category, details.httpStatus),
  };
}

export class ToolDetailedError extends Error {
  readonly details: ToolErrorDetails;

  constructor(message: string, details: ToolErrorDetails, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ToolDetailedError';
    this.details = buildToolErrorDetails(details);
  }
}

function parseHttpStatusFromMessage(message: string): number | null {
  const match = message.match(/\bhttp\s+(\d{3})\b/i) ?? message.match(/\bstatus\s+(\d{3})\b/i);
  if (!match) return null;
  const code = Number(match[1]);
  if (!Number.isFinite(code) || code < 100 || code > 599) return null;
  return Math.floor(code);
}

export function classifyHttpStatus(status: number): ToolFailureCategory {
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 400) return 'bad_request';
  if (status >= 500) return 'server_error';
  return 'upstream_error';
}

export function extractToolErrorDetails(error: unknown): ToolErrorDetails | null {
  if (error instanceof ToolDetailedError) {
    return error.details;
  }

  if (error instanceof Error) {
    const message = error.message ?? '';
    const lower = message.toLowerCase();

    if (lower.includes('not configured') || lower.includes('missing api key')) {
      return buildToolErrorDetails({ category: 'misconfigured' });
    }

    if (lower.includes('timed out') || lower.includes('timeout')) {
      return buildToolErrorDetails({ category: 'timeout' });
    }

    const httpStatus = parseHttpStatusFromMessage(message);
    if (httpStatus !== null) {
      return buildToolErrorDetails({
        category: classifyHttpStatus(httpStatus),
        httpStatus,
      });
    }

    const errorCode = (error as unknown as { code?: unknown }).code;
    if (typeof errorCode === 'string' && errorCode.trim()) {
      return buildToolErrorDetails({
        category: 'network_error',
        code: errorCode.trim(),
      });
    }

    if (
      lower.includes('fetch failed') ||
      lower.includes('econnreset') ||
      lower.includes('enetunreach') ||
      lower.includes('enotfound') ||
      lower.includes('socket') ||
      lower.includes('network')
    ) {
      return buildToolErrorDetails({ category: 'network_error' });
    }
  }

  return null;
}

/**
 * Signal that tool input failed validation before execution.
 *
 * @param toolName - Registry name of the failing tool.
 * @param message - Validation failure detail.
 */
export class ToolValidationError extends Error {
  readonly toolName: string;
  readonly kind: ToolErrorKind = 'validation';

  constructor(toolName: string, message: string) {
    super(message);
    this.name = 'ToolValidationError';
    this.toolName = toolName;
  }
}

/**
 * Signal that a tool failed during execution.
 *
 * @param toolName - Registry name of the failing tool.
 * @param message - Execution failure detail.
 */
export class ToolExecutionError extends Error {
  readonly toolName: string;
  readonly kind: ToolErrorKind = 'execution';

  constructor(toolName: string, message: string) {
    super(message);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
  }
}

/**
 * Signal that a tool did not complete before timeout.
 *
 * @param toolName - Registry name of the timed-out tool.
 * @param timeoutMs - Timeout limit applied to the execution.
 */
export class ToolTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;
  readonly kind: ToolErrorKind = 'timeout';

  constructor(toolName: string, timeoutMs: number) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

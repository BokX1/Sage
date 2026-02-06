/** Model typed error categories emitted by tool execution stages. */
export type ToolErrorKind = 'validation' | 'execution' | 'timeout';

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

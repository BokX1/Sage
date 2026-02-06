/** Execute validated tool calls with timeout and structured result logging. */
import { ToolExecutionContext, ToolRegistry } from './toolRegistry';
import { logger } from '../utils/logger';
import { ToolExecutionError, ToolTimeoutError, ToolValidationError, ToolErrorKind } from './toolErrors';


/** Represent one completed tool invocation result. */
export interface ToolResult {
  name: string;
  success: boolean;
  result?: unknown;
  error?: string;
  errorType?: ToolErrorKind;
  latencyMs: number;
}


/**
 * Execute one tool call with timeout protection and normalized error reporting.
 *
 * @param registry - Tool registry used for validation and execution.
 * @param call - Tool call envelope containing name and args payload.
 * @param ctx - Request-scoped execution context for logging and auth decisions.
 * @param timeoutMs - Hard timeout in milliseconds for this invocation.
 * @returns Structured tool result with latency and typed failure metadata.
 */
export async function executeToolWithTimeout(
  registry: ToolRegistry,
  call: { name: string; args: unknown },
  ctx: ToolExecutionContext,
  timeoutMs: number,
): Promise<ToolResult> {
  const start = Date.now();
  logger.info(
    { traceId: ctx.traceId, toolName: call.name, event: 'tool_invocation_start' },
    'Tool invocation started',
  );

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<ToolResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      const timeoutError = new ToolTimeoutError(call.name, timeoutMs);
      resolve({
        name: call.name,
        success: false,
        error: timeoutError.message,
        errorType: timeoutError.kind,
        latencyMs: timeoutMs,
      });
    }, timeoutMs);
  });

  const executionPromise = registry.executeValidated(call, ctx).then((result) => ({
    name: call.name,
    success: result.success,
    result: result.success ? result.result : undefined,
    error: result.success ? undefined : result.error,
    errorType: result.success ? undefined : result.errorType,
    latencyMs: Date.now() - start,
  }));

  const result = await Promise.race([executionPromise, timeoutPromise]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  const latencyMs = Math.max(0, Date.now() - start);

  const finalResult = {
    ...result,
    latencyMs: result.latencyMs ?? latencyMs,
  } satisfies ToolResult;

  if (!finalResult.success) {
    const errorType = finalResult.errorType ?? 'execution';
    if (errorType === 'validation') {
      const error = new ToolValidationError(call.name, finalResult.error ?? 'Invalid tool call');
      logger.warn(
        {
          traceId: ctx.traceId,
          toolName: call.name,
          errorType,
          errorName: error.name,
          latencyMs: finalResult.latencyMs,
        },
        'Tool invocation rejected',
      );
    } else if (errorType === 'timeout') {
      const error = new ToolTimeoutError(call.name, timeoutMs);
      logger.warn(
        {
          traceId: ctx.traceId,
          toolName: call.name,
          errorType,
          errorName: error.name,
          latencyMs: finalResult.latencyMs,
        },
        'Tool invocation timed out',
      );
    } else {
      const error = new ToolExecutionError(call.name, finalResult.error ?? 'Tool execution failed');
      logger.warn(
        {
          traceId: ctx.traceId,
          toolName: call.name,
          errorType,
          errorName: error.name,
          latencyMs: finalResult.latencyMs,
        },
        'Tool invocation failed',
      );
    }
  } else {
    logger.info(
      { traceId: ctx.traceId, toolName: call.name, latencyMs: finalResult.latencyMs },
      'Tool invocation succeeded',
    );
  }

  return finalResult;
}

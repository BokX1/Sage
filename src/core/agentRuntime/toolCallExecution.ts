/** Execute validated tool calls with timeout and structured result logging. */
import { ToolExecutionContext, ToolRegistry } from './toolRegistry';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import {
  buildToolErrorDetails,
  ToolExecutionError,
  type ToolErrorDetails,
  ToolTimeoutError,
  ToolValidationError,
  ToolErrorKind,
} from './toolErrors';


/** Represent one completed tool invocation result. */
export interface ToolAttachment {
  data: Buffer;
  filename: string;
  mimetype?: string;
}

export interface ToolResult {
  name: string;
  success: boolean;
  result?: unknown;
  attachments?: ToolAttachment[];
  error?: string;
  errorType?: ToolErrorKind;
  errorDetails?: ToolErrorDetails;
  latencyMs: number;
  cacheHit?: boolean;
  cacheKind?: 'round' | 'global' | 'dedupe';
  cacheScopeKey?: string;
}

function sanitizeErrorMessage(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [REDACTED]')
    .trim();
  if (!normalized) return undefined;
  const maxChars = 280;
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function normalizeAttachments(value: unknown): ToolAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments: ToolAttachment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const data = record.data;
    const filename = typeof record.filename === 'string' ? record.filename.trim() : '';
    const mimetype =
      typeof record.mimetype === 'string' && record.mimetype.trim().length > 0
        ? record.mimetype.trim()
        : undefined;
    if (!filename || !Buffer.isBuffer(data)) continue;
    attachments.push({ data, filename, mimetype });
  }
  return attachments.length > 0 ? attachments : undefined;
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

  // Create AbortController for timeout cancellation support
  const abortController = new AbortController();
  const ctxWithSignal: ToolExecutionContext = {
    ...ctx,
    signal: abortController.signal,
  };

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<ToolResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      // Abort the signal so tools can detect cancellation
      abortController.abort();
      const timeoutError = new ToolTimeoutError(call.name, timeoutMs);
      resolve({
        name: call.name,
        success: false,
        error: timeoutError.message,
        errorType: timeoutError.kind,
        errorDetails: buildToolErrorDetails({ category: 'timeout', timeoutMs }),
        latencyMs: timeoutMs,
      });
    }, timeoutMs);
    timeoutHandle.unref?.();
  });

  const executionPromise = registry.executeValidated(call, ctxWithSignal).then((result) => {
    const latencyMs = Date.now() - start;
    if (result.success) {
      let normalizedResult: unknown = result.result;
      let attachments: ToolAttachment[] | undefined;
      if (result.result && typeof result.result === 'object' && !Array.isArray(result.result)) {
        const record = result.result as Record<string, unknown>;
        if ('attachments' in record) {
          attachments = normalizeAttachments(record.attachments);
          if (attachments) {
            const rest = { ...record };
            delete rest.attachments;
            normalizedResult = rest;
          }
        }
      }
      return {
        name: call.name,
        success: true,
        result: normalizedResult,
        attachments,
        latencyMs,
      };
    }
    return {
      name: call.name,
      success: false,
      error: result.error,
      errorType: result.errorType,
      errorDetails: result.errorDetails,
      latencyMs,
    };
  });

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
          errorMessage: sanitizeErrorMessage(finalResult.error ?? error.message),
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
          errorMessage: sanitizeErrorMessage(finalResult.error ?? error.message),
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
          errorMessage: sanitizeErrorMessage(finalResult.error ?? error.message),
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

  // Emit structured metrics for observability
  metrics.increment('tool_execution_total', {
    tool: call.name,
    status: finalResult.success ? 'success' : (finalResult.errorType ?? 'unknown'),
  });
  metrics.histogram('tool_latency_ms', finalResult.latencyMs, { tool: call.name });

  return finalResult;
}

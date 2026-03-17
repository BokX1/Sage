/** Execute validated tool calls with timeout and structured result logging. */
import { logger } from '../../platform/logging/logger';
import { metrics } from '../../shared/observability/metrics';
import {
  ToolExecutionError,
  type ToolErrorDetails,
  ToolErrorKind,
  ToolTimeoutError,
  ToolValidationError,
  buildToolErrorDetails,
} from './toolErrors';
import { isToolControlSignal } from './toolControlSignals';
import {
  normalizeToolSuccessResult,
  type ToolArtifact,
  type ToolExecutionContext,
  type ToolObservationPolicy,
  type ToolRegistry,
} from './toolRegistry';

export interface ToolResultTelemetry {
  latencyMs: number;
  cacheHit?: boolean;
  cacheKind?: 'round' | 'global' | 'dedupe';
  cacheScopeKey?: string;
  observationPolicy?: ToolObservationPolicy;
}

export interface ToolResult {
  name: string;
  success: boolean;
  structuredContent?: unknown;
  modelSummary?: string;
  artifacts?: ToolArtifact[];
  error?: string;
  errorType?: ToolErrorKind;
  errorDetails?: ToolErrorDetails;
  telemetry: ToolResultTelemetry;
}

function composeAbortSignal(parentSignal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!parentSignal) return timeoutSignal;
  if (parentSignal.aborted) return parentSignal;

  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', abort, { once: true });

  if (timeoutSignal.aborted) {
    controller.abort();
  }

  return controller.signal;
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

  const abortController = new AbortController();
  const ctxWithSignal: ToolExecutionContext = {
    ...ctx,
    signal: composeAbortSignal(ctx.signal, abortController.signal),
  };

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<ToolResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      abortController.abort();
      const timeoutError = new ToolTimeoutError(call.name, timeoutMs);
      resolve({
        name: call.name,
        success: false,
        error: timeoutError.message,
        errorType: timeoutError.kind,
        errorDetails: buildToolErrorDetails({ category: 'timeout', timeoutMs }),
        telemetry: { latencyMs: timeoutMs },
      });
    }, timeoutMs);
    timeoutHandle.unref?.();
  });

  const executionPromise = registry.executeValidated(call, ctxWithSignal)
    .then((result) => {
      const latencyMs = Date.now() - start;
      const definition = registry.get(call.name);
      if (result.success) {
        if (!definition) {
          return {
            name: call.name,
            success: false,
            error: `Unknown tool "${call.name}".`,
            errorType: 'validation',
            telemetry: { latencyMs },
          } satisfies ToolResult;
        }
        const normalized = result.result as ReturnType<typeof normalizeToolSuccessResult>;

        return {
          name: call.name,
          success: true,
          structuredContent: normalized.structuredContent,
          modelSummary: normalized.modelSummary,
          artifacts: normalized.artifacts,
          telemetry: {
            latencyMs,
            observationPolicy: definition.runtime.observationPolicy,
          },
        } satisfies ToolResult;
      }
      return {
        name: call.name,
        success: false,
        error: result.error,
        errorType: result.errorType,
        errorDetails: result.errorDetails,
        telemetry: {
          latencyMs,
          observationPolicy: definition?.runtime.observationPolicy,
        },
      } satisfies ToolResult;
    })
    .catch((error) => {
      if (isToolControlSignal(error)) {
        throw error;
      }
      throw error;
    });

  const result = await Promise.race([executionPromise, timeoutPromise]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  const finalResult: ToolResult = {
    ...result,
    telemetry: {
      ...result.telemetry,
      latencyMs: result.telemetry.latencyMs ?? Math.max(0, Date.now() - start),
    },
  };

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
          latencyMs: finalResult.telemetry.latencyMs,
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
          latencyMs: finalResult.telemetry.latencyMs,
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
          latencyMs: finalResult.telemetry.latencyMs,
        },
        'Tool invocation failed',
      );
    }
  } else {
    logger.info(
      { traceId: ctx.traceId, toolName: call.name, latencyMs: finalResult.telemetry.latencyMs },
      'Tool invocation succeeded',
    );
  }

  metrics.increment('tool_execution_total', {
    tool: call.name,
    status: finalResult.success ? 'success' : (finalResult.errorType ?? 'unknown'),
  });
  metrics.histogram('tool_latency_ms', finalResult.telemetry.latencyMs, { tool: call.name });

  return finalResult;
}

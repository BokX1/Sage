import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';
import { config as appConfig } from '../../../platform/config/env';

type LangSmithClientLike = Client & {
  awaitPendingTraceBatches?: () => Promise<void>;
};

export interface LangSmithRunReferences {
  langSmithRunId: string | null;
  langSmithTraceId: string | null;
}

export interface AgentRunTelemetry {
  callbacks: LangChainTracer[];
  getRunReferences(runId: string): LangSmithRunReferences;
  flush(): Promise<void>;
}

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined
  );
}

export function isLangSmithTracingEnabled(): boolean {
  return !isTestRuntime() && appConfig.LANGSMITH_TRACING;
}

export function createAgentRunTelemetry(): AgentRunTelemetry {
  if (!isLangSmithTracingEnabled()) {
    return {
      callbacks: [],
      getRunReferences: () => ({
        langSmithRunId: null,
        langSmithTraceId: null,
      }),
      flush: async () => undefined,
    };
  }

  const client = new Client({
    apiKey: appConfig.LANGSMITH_API_KEY,
  }) as LangSmithClientLike;
  const tracer = new LangChainTracer({
    client,
    projectName: appConfig.LANGSMITH_PROJECT?.trim() || 'sage',
  });

  return {
    callbacks: [tracer],
    getRunReferences(runId: string): LangSmithRunReferences {
      const run = tracer.getRun(runId);
      return {
        langSmithRunId: run?.id ?? null,
        langSmithTraceId: run?.trace_id ?? run?.id ?? null,
      };
    },
    async flush(): Promise<void> {
      if (typeof client.awaitPendingTraceBatches === 'function') {
        await client.awaitPendingTraceBatches();
      }
    },
  };
}

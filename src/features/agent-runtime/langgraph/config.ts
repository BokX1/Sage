import { config as appConfig } from '../../../platform/config/env';
import { normalizeStrictlyPositiveInt } from '../../../shared/utils/numbers';

export interface AgentGraphConfig {
  sliceMaxSteps: number;
  toolTimeoutMs: number;
  maxOutputTokens: number;
  sliceMaxDurationMs: number;
  maxTotalDurationMs: number;
  maxIdleWaitMs: number;
  workerPollMs: number;
  leaseTtlMs: number;
  heartbeatMs: number;
  maxResumes: number;
  compactionEnabled: boolean;
  compactionTriggerEstimatedTokens: number;
  compactionTriggerRounds: number;
  compactionTriggerToolResults: number;
  compactionMaxRawMessages: number;
  compactionMaxToolObservations: number;
  recursionLimit: number;
  maxToolCallsPerRound: number;
  maxIdenticalToolBatches: number;
  maxLoopGuardRecoveries: number;
}

const DERIVED_RECURSION_BASE_STEPS = 24;
const DERIVED_RECURSION_STEPS_PER_SLICE_STEP = 8;

export function deriveAgentGraphRecursionLimit(sliceMaxSteps: number): number {
  const normalizedSliceMaxSteps = normalizeStrictlyPositiveInt(sliceMaxSteps, 10);
  return DERIVED_RECURSION_BASE_STEPS +
    normalizedSliceMaxSteps * DERIVED_RECURSION_STEPS_PER_SLICE_STEP;
}

export function buildAgentGraphConfigFromEnv(
  env: Partial<typeof appConfig> = appConfig,
): AgentGraphConfig {
  const sliceMaxSteps = normalizeStrictlyPositiveInt(
    env.AGENT_RUN_SLICE_MAX_STEPS as number | undefined,
    10,
  );

  return {
    sliceMaxSteps,
    toolTimeoutMs: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_TOOL_TIMEOUT_MS as number | undefined,
      45_000,
    ),
    maxOutputTokens: normalizeStrictlyPositiveInt(
      env.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
      4_096,
    ),
    sliceMaxDurationMs: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_SLICE_MAX_DURATION_MS as number | undefined,
      120_000,
    ),
    maxTotalDurationMs: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_MAX_TOTAL_DURATION_MS as number | undefined,
      3_600_000,
    ),
    maxIdleWaitMs: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_MAX_IDLE_WAIT_MS as number | undefined,
      86_400_000,
    ),
    workerPollMs: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_WORKER_POLL_MS as number | undefined,
      5_000,
    ),
    leaseTtlMs: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_LEASE_TTL_MS as number | undefined,
      30_000,
    ),
    heartbeatMs: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_HEARTBEAT_MS as number | undefined,
      10_000,
    ),
    maxResumes: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_MAX_RESUMES as number | undefined,
      256,
    ),
    compactionEnabled:
      (env.AGENT_RUN_COMPACTION_ENABLED as boolean | undefined) ?? true,
    compactionTriggerEstimatedTokens: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_COMPACTION_TRIGGER_EST_TOKENS as number | undefined,
      64_000,
    ),
    compactionTriggerRounds: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_COMPACTION_TRIGGER_ROUNDS as number | undefined,
      6,
    ),
    compactionTriggerToolResults: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_COMPACTION_TRIGGER_TOOL_RESULTS as number | undefined,
      24,
    ),
    compactionMaxRawMessages: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_COMPACTION_MAX_RAW_MESSAGES as number | undefined,
      24,
    ),
    compactionMaxToolObservations: normalizeStrictlyPositiveInt(
      env.AGENT_RUN_COMPACTION_MAX_TOOL_OBSERVATIONS as number | undefined,
      12,
    ),
    // LangGraph recursion is an internal hop fail-safe. Sage's real slice budget is
    // AGENT_RUN_SLICE_MAX_STEPS, so keep the recursion ceiling comfortably above it
    // unless an operator explicitly overrides the low-level safeguard.
    recursionLimit: normalizeStrictlyPositiveInt(
      env.AGENT_GRAPH_RECURSION_LIMIT as number | undefined,
      deriveAgentGraphRecursionLimit(sliceMaxSteps),
    ),
    maxToolCallsPerRound: normalizeStrictlyPositiveInt(
      env.AGENT_GRAPH_MAX_TOOL_CALLS_PER_ROUND as number | undefined,
      12,
    ),
    maxIdenticalToolBatches: normalizeStrictlyPositiveInt(
      env.AGENT_GRAPH_MAX_IDENTICAL_TOOL_BATCHES as number | undefined,
      4,
    ),
    maxLoopGuardRecoveries: normalizeStrictlyPositiveInt(
      env.AGENT_GRAPH_MAX_LOOP_GUARD_RECOVERIES as number | undefined,
      3,
    ),
  };
}

export function buildAgentGraphConfig(): AgentGraphConfig {
  return buildAgentGraphConfigFromEnv(appConfig);
}

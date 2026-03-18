import { config as appConfig } from '../../../platform/config/env';
import { normalizeStrictlyPositiveInt } from '../../../shared/utils/numbers';

export interface AgentGraphConfig {
  sliceMaxSteps: number;
  toolTimeoutMs: number;
  maxOutputTokens: number;
  githubGroundedMode: boolean;
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

export function buildAgentGraphConfig(): AgentGraphConfig {
  return {
    sliceMaxSteps: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_SLICE_MAX_STEPS as number | undefined,
      10,
    ),
    toolTimeoutMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_TOOL_TIMEOUT_MS as number | undefined,
      45_000,
    ),
    maxOutputTokens: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
      4_096,
    ),
    githubGroundedMode:
      (appConfig.AGENT_GRAPH_GITHUB_GROUNDED_MODE as boolean | undefined) ?? true,
    sliceMaxDurationMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_SLICE_MAX_DURATION_MS as number | undefined,
      120_000,
    ),
    maxTotalDurationMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_MAX_TOTAL_DURATION_MS as number | undefined,
      3_600_000,
    ),
    maxIdleWaitMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_MAX_IDLE_WAIT_MS as number | undefined,
      86_400_000,
    ),
    workerPollMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_WORKER_POLL_MS as number | undefined,
      5_000,
    ),
    leaseTtlMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_LEASE_TTL_MS as number | undefined,
      30_000,
    ),
    heartbeatMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_HEARTBEAT_MS as number | undefined,
      10_000,
    ),
    maxResumes: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_MAX_RESUMES as number | undefined,
      256,
    ),
    compactionEnabled:
      (appConfig.AGENT_RUN_COMPACTION_ENABLED as boolean | undefined) ?? true,
    compactionTriggerEstimatedTokens: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_COMPACTION_TRIGGER_EST_TOKENS as number | undefined,
      36_000,
    ),
    compactionTriggerRounds: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_COMPACTION_TRIGGER_ROUNDS as number | undefined,
      6,
    ),
    compactionTriggerToolResults: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_COMPACTION_TRIGGER_TOOL_RESULTS as number | undefined,
      12,
    ),
    compactionMaxRawMessages: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_COMPACTION_MAX_RAW_MESSAGES as number | undefined,
      24,
    ),
    compactionMaxToolObservations: normalizeStrictlyPositiveInt(
      appConfig.AGENT_RUN_COMPACTION_MAX_TOOL_OBSERVATIONS as number | undefined,
      12,
    ),
    recursionLimit: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_RECURSION_LIMIT as number | undefined,
      32,
    ),
    maxToolCallsPerRound: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_TOOL_CALLS_PER_ROUND as number | undefined,
      12,
    ),
    maxIdenticalToolBatches: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_IDENTICAL_TOOL_BATCHES as number | undefined,
      4,
    ),
    maxLoopGuardRecoveries: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_LOOP_GUARD_RECOVERIES as number | undefined,
      3,
    ),
  };
}

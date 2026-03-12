import { config as appConfig } from '../../../platform/config/env';
import { normalizeStrictlyPositiveInt } from '../../../shared/utils/numbers';

export interface AgentGraphConfig {
  maxSteps: number;
  maxToolCallsPerStep: number;
  toolTimeoutMs: number;
  maxOutputTokens: number;
  maxResultChars: number;
  githubGroundedMode: boolean;
  parallelReadOnlyTools: boolean;
  maxParallelReadOnlyTools: number;
  memoEnabled: boolean;
  memoTtlMs: number;
  memoMaxEntries: number;
  memoMaxResultJsonChars: number;
  maxDurationMs: number;
  recursionLimit: number;
}

export function buildAgentGraphConfig(): AgentGraphConfig {
  return {
    maxSteps: normalizeStrictlyPositiveInt(appConfig.AGENT_GRAPH_MAX_STEPS as number | undefined, 6),
    maxToolCallsPerStep: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_TOOL_CALLS_PER_STEP as number | undefined,
      5,
    ),
    toolTimeoutMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_TOOL_TIMEOUT_MS as number | undefined,
      45_000,
    ),
    maxOutputTokens: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
      1_200,
    ),
    maxResultChars: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_RESULT_CHARS as number | undefined,
      8_000,
    ),
    githubGroundedMode:
      (appConfig.AGENT_GRAPH_GITHUB_GROUNDED_MODE as boolean | undefined) ?? true,
    parallelReadOnlyTools:
      (appConfig.AGENT_GRAPH_READONLY_PARALLEL_ENABLED as boolean | undefined) ?? true,
    maxParallelReadOnlyTools: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_PARALLEL_READONLY as number | undefined,
      4,
    ),
    memoEnabled: (appConfig.AGENT_GRAPH_MEMO_ENABLED as boolean | undefined) ?? true,
    memoTtlMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MEMO_TTL_MS as number | undefined,
      15 * 60_000,
    ),
    memoMaxEntries: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MEMO_MAX_ENTRIES as number | undefined,
      250,
    ),
    memoMaxResultJsonChars: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MEMO_MAX_RESULT_JSON_CHARS as number | undefined,
      200_000,
    ),
    maxDurationMs: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_MAX_DURATION_MS as number | undefined,
      120_000,
    ),
    recursionLimit: normalizeStrictlyPositiveInt(
      appConfig.AGENT_GRAPH_RECURSION_LIMIT as number | undefined,
      16,
    ),
  };
}

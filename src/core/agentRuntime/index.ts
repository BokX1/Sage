/**
 * Re-export public agent-runtime surfaces used by handlers and tests.
 *
 * Non-goals:
 * - Hold runtime state.
 * - Execute chat turns directly.
 */
export { runChatTurn, type RunChatTurnParams, type RunChatTurnResult } from './agentRuntime';

export {
  composeSystemPrompt,
  getCorePromptContent,
  type ComposeSystemPromptParams,
} from './promptComposer';
export { buildContextMessages, type BuildContextMessagesParams } from './contextBuilder';
export {
  ToolRegistry,
  globalToolRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolValidationResult,
  type OpenAIToolSpec,
} from './toolRegistry';

export {
  runToolCallLoop,
  type ToolCallLoopConfig,
  type ToolCallLoopParams,
  type ToolCallLoopResult,
} from './toolCallLoop';

export { type ToolCallEnvelope } from './toolCallParser';
export { type ToolResult } from './toolCallExecution';
export { ToolResultCache, buildToolCacheKey, type ToolCacheEntry } from './toolCache';
export {
  classifyToolRisk,
  evaluateToolPolicy,
  parseToolBlocklistCsv,
  type ToolRiskClass,
  type ToolPolicyConfig,
  type ToolPolicyDecision,
} from './toolPolicy';
export {
  resolveTenantPolicy,
  type TenantAgenticPolicy,
  type TenantPolicyRegistry,
  type ResolvedTenantPolicy,
} from './tenantPolicy';
export {
  evaluateAgenticCanary,
  recordAgenticOutcome,
  getAgenticCanarySnapshot,
  resetAgenticCanaryState,
  normalizeCanaryConfig,
  parseRouteAllowlistCsv,
  type AgenticCanaryConfig,
  type AgenticCanaryDecision,
  type AgenticCanarySnapshot,
} from './canaryPolicy';

export {
  type AgentName,
  type AgentResultStatus,
  type ArtifactKind,
  type AgentTaskBudget,
  type AgentTaskNode,
  type AgentGraphEdge,
  type AgentGraph,
  type ArtifactProvenance,
  type BlackboardArtifact,
  type AgentResult,
} from './agent-types';

export {
  type BlackboardState,
  createBlackboardState,
  markTaskStarted,
  appendArtifacts,
  recordTaskResult,
  addUnresolvedQuestion,
  expertPacketsToArtifacts,
  renderExpertPacketContext,
} from './blackboard';

export {
  type AgentEventType,
  type AgentEvent,
  createAgentEventFactory,
} from './agent-events';

export {
  buildLinearExpertGraph,
  buildFanoutExpertGraph,
  buildDependencyAwareExpertGraph,
  buildPlannedExpertGraph,
} from './plannerAgent';
export { validateAgentGraph, type GraphValidationResult } from './graphPolicy';
export { executeAgentGraph, type ExecuteAgentGraphParams, type ExecuteAgentGraphResult } from './graphExecutor';
export { evaluateDraftWithCritic, type CriticAssessment, type EvaluateDraftWithCriticParams } from './criticAgent';
export {
  normalizeCriticConfig,
  shouldRequestRevision,
  shouldRunCritic,
  type CriticRuntimeConfig,
} from './qualityPolicy';
export { scoreTraceOutcome, type OutcomeScorerInput, type OutcomeScore } from './outcomeScorer';
export {
  evaluateRecentTraceOutcomes,
  type ReplayEvaluationRow,
  type ReplayEvaluationReport,
} from './replayHarness';

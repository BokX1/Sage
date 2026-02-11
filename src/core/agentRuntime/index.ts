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
  type ToolMetadata,
  type ToolRiskClassValue,
  type ToolValidationResult,
  type OpenAIToolSpec,
} from './toolRegistry';
export { registerDefaultAgenticTools } from './defaultTools';

export {
  runToolCallLoop,
  type ToolCallLoopConfig,
  type ToolCallLoopParams,
  type ToolCallLoopResult,
  type ToolPolicyTraceDecision,
} from './toolCallLoop';

export { type ToolCallEnvelope } from './toolCallParser';
export { type ToolResult } from './toolCallExecution';
export { ToolResultCache, buildToolCacheKey, type ToolCacheEntry } from './toolCache';
export {
  classifyToolRisk,
  evaluateToolPolicy,
  mergeToolPolicyConfig,
  parseToolPolicyJson,
  parseToolBlocklistCsv,
  type ToolRiskClass,
  type ToolPolicyConfig,
  type ToolPolicyDecisionCode,
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
  contextPacketsToArtifacts,
  renderContextPacketContext,
} from './blackboard';

export {
  type AgentEventType,
  type AgentEvent,
  createAgentEventFactory,
} from './agent-events';

export {
  buildLinearContextGraph,
  buildFanoutContextGraph,
  buildContextGraph,
  getStandardProvidersForAgent,
} from './graphBuilder';
export { validateAgentGraph, type GraphValidationResult } from './graphPolicy';
export { executeAgentGraph, type ExecuteAgentGraphParams, type ExecuteAgentGraphResult } from './graphExecutor';
export { evaluateDraftWithCritic, type CriticAssessment, type EvaluateDraftWithCriticParams } from './criticAgent';
export {
  normalizeCriticConfig,
  shouldRefreshSearchFromCritic,
  shouldRequestRevision,
  shouldRunCritic,
  type CriticRuntimeConfig,
} from './qualityPolicy';
export { scoreTraceOutcome, type OutcomeScorerInput, type OutcomeScore } from './outcomeScorer';
export { parseTraceToolTelemetry, type TraceToolTelemetry } from './toolTelemetry';
export {
  validateResponseForRoute,
  buildValidationRepairInstruction,
  type ResponseValidationIssue,
  type ResponseValidationIssueCode,
  type ResponseValidationResult,
} from './responseValidators';
export {
  resolveRouteValidationPolicy,
  type RouteValidationPolicy,
  type ValidationStrictness,
} from './validationPolicy';
export {
  evaluateRecentTraceOutcomes,
  type ReplayEvaluationRow,
  type ReplayEvaluationReport,
  type ReplayToolingAggregate,
  type ReplayRouteBucket,
} from './replayHarness';
export {
  normalizeManagerWorkerConfig,
  planManagerWorker,
  type ManagerWorkerConfig,
  type ManagerWorkerTask,
  type ManagerWorkerPlan,
  type ManagerWorkerPlanningResult,
  type ManagerWorkerRoute,
  type ManagerWorkerKind,
} from './taskPlanner';
export { executeManagerWorkerPlan, type ExecuteManagerWorkerPlanParams } from './workerExecutor';
export { aggregateManagerWorkerArtifacts } from './workerAggregator';
export {
  type ManagerWorkerArtifact,
  type ManagerWorkerExecutionResult,
  type ManagerWorkerAggregate,
} from './managerWorkerTypes';
export {
  type EvalDimensionKey,
  type EvalDimensionScores,
  type EvalScoreWeights,
  type EvalAggregateScore,
  DEFAULT_EVAL_SCORE_WEIGHTS,
  normalizeEvalDimensionScores,
  computeEvalOverallScore,
  evaluateAggregateScore,
} from './evalScorer';
export {
  type EvalRubric,
  DEFAULT_EVAL_RUBRIC,
  getEvalRubric,
  buildEvalJudgePrompt,
} from './evalRubrics';
export {
  runLlmJudge,
  type LlmJudgeInput,
  type LlmJudgeAssessment,
  type LlmJudgeResult,
  type JudgeModelInvoker,
} from './llmJudge';
export {
  insertAgentEvaluation,
  listRecentAgentEvaluations,
  cleanupAgentEvaluationsByTrace,
  type AgentEvaluationWriteData,
  type AgentEvaluationRow,
} from './agent-eval-repo';

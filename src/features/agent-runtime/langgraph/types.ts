import type { BaseMessage } from '@langchain/core/messages';
import type { ApprovalInterruptPayload } from '../toolControlSignals';
import type { ToolResult } from '../toolCallExecution';
import type { PromptInputMode, PromptWaitingFollowUp } from '../promptContract';
import type { GraphToolCallDescriptor } from './nativeTools';

export interface GraphToolFile {
  name: string;
  dataBase64: string;
  mimetype?: string;
}

export interface GraphRebudgetEvent {
  beforeCount: number;
  afterCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  countSource: 'local_tokenizer' | 'fallback_estimator';
  tokenizerEncoding: string;
  imageTokenReserve: number;
  availableInputTokens: number;
  reservedOutputTokens: number;
  notes: string[];
  trimmed: boolean;
}

export interface GraphTokenUsage {
  countSource: 'local_tokenizer' | 'fallback_estimator';
  tokenizerEncoding: string;
  estimatedInputTokens: number;
  imageTokenReserve: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface ToolCallRoundEvent {
  round: number;
  requestedCallCount: number;
  executedCallCount: number;
  deduplicatedCallCount: number;
  uniqueCallCount: number;
  skippedDuplicateCallCount: number;
  overLimitCallCount: number;
  completedAt: string;
  guardReason?: 'too_many_tool_calls' | 'repeated_identical_batch' | 'recursion_limit';
  rebudgeting?: GraphRebudgetEvent;
}

export type GraphCompletionKind =
  | 'final_answer'
  | 'approval_pending'
  | 'user_input_pending'
  | 'loop_guard'
  | 'runtime_failure'
  | 'cancelled';

export type PlainTextOutcomeSource =
  | 'runtime_control_tool'
  | 'default_final_answer';

export type GraphStopReason =
  | 'assistant_turn_completed'
  | 'approval_interrupt'
  | 'user_input_interrupt'
  | 'background_yield'
  | 'loop_guard'
  | 'runtime_failure'
  | 'cancelled';

export type GraphDeliveryDisposition =
  | 'response_session'
  | 'approval_handoff';

export interface GraphArtifactDelivery {
  toolName: string;
  effectKind: 'governance_only' | 'discord_artifact';
  visibleSummary?: string;
}

export type GraphResponseSessionStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'waiting_user_input'
  | 'final'
  | 'failed';

export interface GraphResponseSession {
  responseSessionId: string;
  status: GraphResponseSessionStatus;
  latestText: string;
  draftRevision: number;
  sourceMessageId: string | null;
  responseMessageId: string | null;
  surfaceAttached?: boolean;
  overflowMessageIds?: string[];
  linkedArtifactMessageIds: string[];
}

export interface GraphContextFrame {
  objective: string;
  verifiedFacts: string[];
  completedActions: string[];
  openQuestions: string[];
  pendingApprovals: string[];
  deliveryState: 'none' | 'awaiting_approval' | 'paused' | 'final';
  nextAction: string;
  activeEvidenceRefs?: string[];
  droppedMessageCutoff?: number;
  compactionRevision?: number;
}

export interface GraphWaitingState {
  kind: 'approval_review' | 'user_input';
  prompt: string;
  requestedByUserId: string;
  channelId: string;
  guildId: string | null;
  responseMessageId?: string | null;
}

export interface GraphCompactionState {
  workingObjective: string;
  verifiedFacts: string[];
  completedActions: string[];
  openQuestions: string[];
  pendingApprovals: string[];
  deliveryState: GraphContextFrame['deliveryState'];
  nextAction: string;
  activeEvidenceRefs: string[];
  droppedMessageCutoff: number;
  compactionRevision: number;
  retainedRawMessageCount: number;
  retainedToolObservationCount: number;
  reason: 'tool_pressure' | 'round_pressure' | 'message_pressure' | 'approval_resolution' | 'yield_boundary';
  inputTokensEstimate: number;
  outputTokensEstimate: number;
}

export type GraphYieldReason =
  | 'slice_budget_exhausted'
  | 'provider_backoff'
  | 'awaiting_compaction'
  | 'worker_handoff';

export type GraphFinalizedBy =
  | 'assistant_no_tool_calls'
  | 'approval_interrupt'
  | 'user_input_interrupt'
  | 'background_yield'
  | 'loop_guard'
  | 'runtime_failure'
  | 'cancelled';

export interface ToolCallFinalizationEvent {
  attempted: boolean;
  succeeded: boolean;
  completedAt: string;
  stopReason: GraphStopReason;
  completionKind: GraphCompletionKind;
  deliveryDisposition: GraphDeliveryDisposition;
  finalizedBy: GraphFinalizedBy;
  draftRevision: number;
  contextFrame?: GraphContextFrame;
  rebudgeting?: GraphRebudgetEvent;
}

export interface SerializedToolResult extends Omit<ToolResult, 'artifacts'> {
  artifactsMeta?: Array<{
    kind: 'file' | 'discord_artifact' | 'governance_only';
    filename?: string;
    mimetype?: string;
    byteLength?: number;
    visibleSummary?: string;
  }>;
}

export interface ApprovalInterruptRequestState {
  requestId: string;
  call: GraphToolCallDescriptor;
  payload: ApprovalInterruptPayload;
  coalesced?: boolean;
  expiresAtIso?: string;
}

export interface ApprovalInterruptState {
  kind: 'approval_review';
  requestId: string;
  batchId: string;
  requests: ApprovalInterruptRequestState[];
}

export type GraphInterruptState = ApprovalInterruptState;

export interface ApprovalResolutionState {
  kind: 'approval_review';
  requestId: string;
  decision: 'approved' | 'rejected' | 'expired';
  status: 'approved' | 'rejected' | 'expired' | 'executed' | 'failed';
  reviewerId?: string | null;
  decisionReasonText?: string | null;
  errorText?: string | null;
}

export interface ApprovalBatchResolutionState {
  kind: 'approval_review_batch';
  batchId: string;
  resolutions: ApprovalResolutionState[];
}

export type GraphInterruptResolution =
  | ApprovalResolutionState
  | ApprovalBatchResolutionState;

export interface ApprovalResumeDecision {
  requestId: string;
  status: 'approved' | 'rejected' | 'expired';
  reviewerId?: string | null;
  decisionReasonText?: string | null;
}

export interface AgentGraphRuntimeContext {
  traceId: string;
  originTraceId: string;
  threadId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  apiKey?: string;
  model?: string;
  temperature: number;
  timeoutMs?: number;
  maxTokens?: number;
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  invokerIsAdmin?: boolean;
  invokerCanModerate?: boolean;
  activeToolNames: string[];
  routeKind: string;
  currentTurn: unknown;
  replyTarget: unknown;
  userProfileSummary?: string | null;
  guildSagePersona?: string | null;
  focusedContinuity?: string | null;
  recentTranscript?: string | null;
  voiceContext?: string | null;
  promptMode?: PromptInputMode;
  waitingFollowUp?: PromptWaitingFollowUp | null;
  promptVersion?: string | null;
  promptFingerprint?: string | null;
  runId?: string | null;
}

export type AgentGraphPersistedContext = Omit<AgentGraphRuntimeContext, 'apiKey'>;

export interface AgentGraphState {
  messages: BaseMessage[];
  resumeContext: AgentGraphPersistedContext;
  pendingReadCalls: GraphToolCallDescriptor[];
  pendingReadExecutionCalls: GraphToolCallDescriptor[];
  pendingWriteCalls: GraphToolCallDescriptor[];
  replyText: string;
  toolResults: SerializedToolResult[];
  files: GraphToolFile[];
  roundsCompleted: number;
  sliceIndex: number;
  totalRoundsCompleted: number;
  deduplicatedCallCount: number;
  lastToolBatchFingerprint: string | null;
  consecutiveIdenticalToolBatches: number;
  loopGuardRecoveries: number;
  roundEvents: ToolCallRoundEvent[];
  finalization: ToolCallFinalizationEvent;
  completionKind: GraphCompletionKind | null;
  stopReason: GraphStopReason;
  deliveryDisposition: GraphDeliveryDisposition;
  responseSession: GraphResponseSession;
  artifactDeliveries: GraphArtifactDelivery[];
  contextFrame: GraphContextFrame;
  waitingState: GraphWaitingState | null;
  compactionState: GraphCompactionState | null;
  yieldReason: GraphYieldReason | null;
  graphStatus: 'running' | 'interrupted' | 'completed' | 'failed';
  activeWindowDurationMs: number;
  pendingInterrupt: GraphInterruptState | null;
  interruptResolution: GraphInterruptResolution | null;
  tokenUsage: GraphTokenUsage;
  plainTextOutcomeSource: PlainTextOutcomeSource | null;
}

export type GraphResumeInput =
  | {
      interruptKind: 'approval_review';
      decisions: ApprovalResumeDecision[];
      resumeTraceId?: string | null;
    };

export interface PlainTextOutcomeTelemetry {
  plainTextOutcomeSource: PlainTextOutcomeSource | null;
}

import type { BaseMessage } from '@langchain/core/messages';
import type { ApprovalInterruptPayload } from '../toolControlSignals';
import type { ToolResult } from '../toolCallExecution';
import type { PromptInputMode } from '../promptContract';
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
  availableInputTokens: number;
  reservedOutputTokens: number;
  notes: string[];
  trimmed: boolean;
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
  | 'clarification_question'
  | 'approval_pending'
  | 'pause_handoff'
  | 'loop_guard'
  | 'runtime_failure';

export type GraphStopReason =
  | 'assistant_turn_completed'
  | 'approval_interrupt'
  | 'step_window_exhausted'
  | 'graph_timeout'
  | 'max_windows_reached'
  | 'continuation_expired'
  | 'loop_guard'
  | 'runtime_failure';

export type GraphDeliveryDisposition =
  | 'response_session'
  | 'approval_handoff'
  | 'response_session_with_continue';

export interface GraphArtifactDelivery {
  toolName: string;
  effectKind: 'governance_only' | 'discord_artifact';
  visibleSummary?: string;
}

export type GraphResponseSessionStatus = 'draft' | 'awaiting_approval' | 'paused' | 'final' | 'failed';

export interface GraphResponseSession {
  responseSessionId: string;
  status: GraphResponseSessionStatus;
  latestText: string;
  draftRevision: number;
  sourceMessageId: string | null;
  responseMessageId: string | null;
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
}

export type GraphFinalizedBy =
  | 'assistant_no_tool_calls'
  | 'approval_interrupt'
  | 'continuation_pause'
  | 'loop_guard'
  | 'runtime_failure';

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

export interface SerializedToolResult extends Omit<ToolResult, 'attachments'> {
  attachmentsMeta?: Array<{
    filename: string;
    mimetype?: string;
    byteLength: number;
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

export interface ContinuePromptInterruptState {
  kind: 'continue_prompt';
  continuationId: string;
  pauseReason: 'graph_timeout' | 'step_window_exhausted';
  requestedByUserId: string;
  channelId: string;
  guildId: string | null;
  summaryText: string;
  completedWindows: number;
  maxWindows: number;
  expiresAtIso: string;
  resumeNode: 'tool_call_turn' | 'route_tool_phase';
}

export type GraphInterruptState = ApprovalInterruptState | ContinuePromptInterruptState;

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

export interface ContinuePromptResolutionState {
  kind: 'continue_prompt';
  continuationId: string;
  decision: 'continue' | 'expired';
  resumedByUserId?: string | null;
}

export type GraphInterruptResolution =
  | ApprovalResolutionState
  | ApprovalBatchResolutionState
  | ContinuePromptResolutionState;

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
  promptVersion?: string | null;
  promptFingerprint?: string | null;
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
  completedWindows: number;
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
  graphStatus: 'running' | 'interrupted' | 'completed' | 'failed';
  activeWindowDurationMs: number;
  pendingInterrupt: GraphInterruptState | null;
  interruptResolution: GraphInterruptResolution | null;
}

export type GraphResumeInput =
  | {
      interruptKind: 'approval_review';
      decisions: ApprovalResumeDecision[];
      resumeTraceId?: string | null;
    }
  | {
      interruptKind: 'continue_prompt';
      decision: 'continue' | 'expired';
      continuationId: string;
      resumedByUserId?: string | null;
      resumeTraceId?: string | null;
    };

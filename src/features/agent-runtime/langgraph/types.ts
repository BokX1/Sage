import type { BaseMessage } from '@langchain/core/messages';
import type { ApprovalInterruptPayload } from '../toolControlSignals';
import type { ToolResult } from '../toolCallExecution';
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
  completedAt: string;
  rebudgeting?: GraphRebudgetEvent;
}

export type GraphTurnTerminationReason =
  | 'assistant_reply'
  | 'continue_prompt'
  | 'graph_timeout'
  | 'approval_interrupt'
  | 'max_windows_reached';

export interface ToolCallFinalizationEvent {
  attempted: boolean;
  succeeded: boolean;
  completedAt: string;
  terminationReason: GraphTurnTerminationReason;
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
  resumeNode: 'llm_call' | 'route_tool_phase';
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
}

export type AgentGraphPersistedContext = Omit<AgentGraphRuntimeContext, 'apiKey'>;

export interface AgentGraphState {
  messages: BaseMessage[];
  resumeContext: AgentGraphPersistedContext;
  pendingReadCalls: GraphToolCallDescriptor[];
  pendingWriteCalls: GraphToolCallDescriptor[];
  replyText: string;
  toolResults: SerializedToolResult[];
  files: GraphToolFile[];
  roundsCompleted: number;
  completedWindows: number;
  totalRoundsCompleted: number;
  deduplicatedCallCount: number;
  roundEvents: ToolCallRoundEvent[];
  finalization: ToolCallFinalizationEvent;
  terminationReason: GraphTurnTerminationReason;
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

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
  truncatedCallCount: number;
  guardrailBlockedCallCount: number;
  completedAt: string;
  rebudgeting?: GraphRebudgetEvent;
}

export type GraphTurnTerminationReason =
  | 'assistant_reply'
  | 'step_limit'
  | 'graph_timeout'
  | 'approval_interrupt';

export interface ToolCallFinalizationEvent {
  attempted: boolean;
  succeeded: boolean;
  fallbackUsed: boolean;
  returnedToolCallCount: number;
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

export interface ApprovalInterruptState {
  requestId: string;
  call: GraphToolCallDescriptor;
  payload: ApprovalInterruptPayload;
  coalesced?: boolean;
  expiresAtIso?: string;
}

export interface ApprovalResolutionState {
  requestId: string;
  decision: 'approved' | 'rejected' | 'expired';
  status: 'approved' | 'rejected' | 'expired' | 'executed' | 'failed';
  reviewerId?: string | null;
  decisionReasonText?: string | null;
  errorText?: string | null;
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
  activeToolNames: string[];
  routeKind: string;
  currentTurn: unknown;
  replyTarget: unknown;
}

export interface AgentGraphState {
  messages: BaseMessage[];
  resumeContext: AgentGraphRuntimeContext;
  pendingWriteCall: GraphToolCallDescriptor | null;
  replyText: string;
  toolResults: SerializedToolResult[];
  files: GraphToolFile[];
  roundsCompleted: number;
  deduplicatedCallCount: number;
  truncatedCallCount: number;
  guardrailBlockedCallCount: number;
  roundEvents: ToolCallRoundEvent[];
  finalization: ToolCallFinalizationEvent;
  terminationReason: GraphTurnTerminationReason;
  graphStatus: 'running' | 'interrupted' | 'completed' | 'failed';
  startedAtEpochMs: number;
  approvalInterrupt: ApprovalInterruptState | null;
  approvalResolution: ApprovalResolutionState | null;
}

export interface ApprovalResumeInput {
  status: 'approved' | 'rejected' | 'expired';
  reviewerId?: string | null;
  decisionReasonText?: string | null;
  resumeTraceId?: string | null;
}

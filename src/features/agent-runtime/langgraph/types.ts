import type { LLMChatMessage, LLMToolCall } from '../../../platform/llm/llm-types';
import type { ToolResult } from '../toolCallExecution';
import type { ApprovalInterruptPayload } from '../toolControlSignals';

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
  stagnation?: {
    repeatedBatch: boolean;
    madeProgress: boolean;
    triggered: boolean;
  };
}

export type GraphTurnTerminationReason =
  | 'assistant_reply'
  | 'step_limit'
  | 'graph_timeout'
  | 'stagnation'
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

export interface CallAttemptLedgerEntry {
  failedOuterExecutions: number;
  blockedReason?: 'non_retryable_failure' | 'failure_budget';
  lastFailureCategory?: string;
}

export interface ApprovalInterruptState {
  payload: ApprovalInterruptPayload;
  requestId?: string;
  coalesced?: boolean;
  expiresAtIso?: string;
}

export interface AgentGraphState {
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
  messages: LLMChatMessage[];
  activeToolNames: string[];
  routeKind: string;
  toolExecutionProfile: 'default' | 'search_high';
  currentTurn: unknown;
  replyTarget: unknown;
  pendingToolCalls: LLMToolCall[];
  pendingAssistantText: string;
  replyText: string;
  toolResults: SerializedToolResult[];
  files: GraphToolFile[];
  roundsCompleted: number;
  deduplicatedCallCount: number;
  truncatedCallCount: number;
  guardrailBlockedCallCount: number;
  cancellationCount: number;
  roundEvents: ToolCallRoundEvent[];
  finalization: ToolCallFinalizationEvent;
  terminationReason: GraphTurnTerminationReason;
  previousExecutedBatchFingerprint: string | null;
  previousSuccessfulReadObservationFingerprint: string | null;
  pendingApprovalResultsByFingerprint: Record<string, SerializedToolResult>;
  callAttemptLedger: Record<string, CallAttemptLedgerEntry>;
  sideEffectExecutedInLoop: boolean;
  graphStatus: 'running' | 'interrupted' | 'completed' | 'failed';
  startedAtEpochMs: number;
  approvalInterrupt: ApprovalInterruptState | null;
  traceEvents: Record<string, unknown>[];
}

export interface ApprovalResumeInput {
  status: 'approved' | 'rejected' | 'expired';
  reviewerId?: string | null;
  decisionReasonText?: string | null;
  resumeTraceId?: string | null;
}

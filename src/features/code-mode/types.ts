import type { ToolArtifact, ToolExecutionContext } from '../agent-runtime/toolRegistry';
import type { BridgeNamespace } from './bridge/types';

export type CodeModeLanguage = 'javascript';

export interface CodeModeExecutionRequest {
  executionId: string;
  taskId: string;
  language: CodeModeLanguage;
  code: string;
  toolContext: ToolExecutionContext;
  timeoutMs: number;
  approvalGrant?: CodeModeApprovalGrant | null;
}

export interface CodeModeApprovalGrant {
  requestId: string;
  effectIndex: number;
  requestHash: string;
  reviewerId?: string | null;
}

export interface SerializedToolArtifact {
  kind: ToolArtifact['kind'];
  name?: string;
  filename?: string;
  mimetype?: string;
  visibleSummary?: string;
  payload?: unknown;
  dataBase64?: string;
}

export interface CodeModeEffectRecord {
  index: number;
  operationKind: BridgeNamespace | 'http' | 'workspace';
  requestHash: string;
  mutability: 'read' | 'write';
  status: 'executed' | 'approval_required' | 'denied' | 'failed';
  label: string;
  result?: unknown;
  errorText?: string | null;
  artifacts?: SerializedToolArtifact[];
  approval?: {
    requestId?: string | null;
    requestHash?: string | null;
    kind?: string | null;
    reviewChannelId?: string | null;
  } | null;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CodeModeExecutionSnapshot {
  executionId: string;
  taskId: string;
  language: CodeModeLanguage;
  code: string;
  timeoutMs: number;
  toolContext: ToolExecutionContext;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CodeModeBridgeCallLogEntry {
  index: number;
  operationKind: BridgeNamespace | 'http' | 'workspace';
  label: string;
  mutability: 'read' | 'write';
  status: 'executed' | 'approval_required' | 'denied' | 'failed' | 'replayed';
  replayed: boolean;
}

export interface CodeModeExecutionResult {
  language: CodeModeLanguage;
  executionId: string;
  taskId: string;
  result: unknown;
  stdout: string[];
  stderr: string[];
  bridgeCalls: CodeModeBridgeCallLogEntry[];
  artifacts: ToolArtifact[];
  workspaceSummary: {
    taskId: string;
    relativeRoot: string;
  };
}

export interface CodeModeApprovalExecutionPayload {
  executionId: string;
  taskId: string;
  effectIndex: number;
  effectLabel: string;
  requestHash?: string;
}

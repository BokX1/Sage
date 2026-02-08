import { ExpertName, ExpertPacket } from '../orchestration/experts/expert-types';

/**
 * Canonical runtime agent identities.
 * Expert agents map 1:1 to existing expert modules for incremental adoption.
 */
export type AgentName = ExpertName | 'Planner' | 'Critic' | 'Synthesizer';

export type AgentResultStatus = 'ok' | 'retryable_error' | 'fatal_error' | 'skipped';

export type ArtifactKind =
  | 'expert_packet'
  | 'tool_result'
  | 'diagnostic'
  | 'answer_draft'
  | 'final_answer';

export interface AgentTaskBudget {
  maxLatencyMs: number;
  maxRetries: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface AgentTaskNode {
  id: string;
  agent: AgentName;
  objective: string;
  inputs: string[];
  successCriteria: string[];
  budget: AgentTaskBudget;
  dependsOn: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentGraphEdge {
  from: string;
  to: string;
}

export interface AgentGraph {
  version: 'v1';
  routeKind: string;
  createdAt: string;
  nodes: AgentTaskNode[];
  edges: AgentGraphEdge[];
}

export interface ArtifactProvenance {
  source: string;
  type: 'expert' | 'tool' | 'system' | 'user';
  timestamp: string;
}

export interface BlackboardArtifact {
  id: string;
  kind: ArtifactKind;
  label: string;
  content: string;
  confidence: number;
  sourceAgent: AgentName;
  provenance: ArtifactProvenance[];
  packet?: ExpertPacket;
  json?: unknown;
}

export interface AgentResult {
  taskId: string;
  agent: AgentName;
  status: AgentResultStatus;
  attempts: number;
  startedAt: string;
  finishedAt: string;
  summary: string;
  confidence: number;
  artifacts: BlackboardArtifact[];
  packets: ExpertPacket[];
  error?: string;
  retryHint?: string;
  metadata?: Record<string, unknown>;
}

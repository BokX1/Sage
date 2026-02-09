import { ContextProviderName, ContextPacket } from '../context/context-types';

/**
 * Canonical runtime agent identities.
 */
export type AgentName = ContextProviderName | 'Planner' | 'Critic' | 'Synthesizer' | 'ChatAgent' | 'CodingAgent' | 'SearchAgent' | 'CreativeAgent';

export type AgentResultStatus = 'ok' | 'retryable_error' | 'fatal_error' | 'skipped';

export type ArtifactKind =
  | 'context_packet'
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
  type: 'provider' | 'tool' | 'system' | 'user';
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
  packet?: ContextPacket;
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
  packets: ContextPacket[];
  error?: string;
  retryHint?: string;
  metadata?: Record<string, unknown>;
}

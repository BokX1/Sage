import { ContextPacket } from '../context/context-types';
import { estimateTokens } from './tokenEstimate';
import {
  AgentGraph,
  AgentResult,
  AgentResultStatus,
  AgentTaskNode,
  BlackboardArtifact,
} from './agent-types';

interface TaskSnapshot {
  id: string;
  agent: AgentTaskNode['agent'];
  objective: string;
  status: AgentResultStatus | 'pending' | 'running';
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface BlackboardState {
  schemaVersion: '1.0';
  traceId: string;
  routeKind: string;
  userText: string;
  createdAt: string;
  updatedAt: string;
  graph: AgentGraph;
  artifacts: BlackboardArtifact[];
  tasks: Record<string, TaskSnapshot>;
  unresolvedQuestions: string[];
  counters: {
    completedTasks: number;
    failedTasks: number;
    totalEstimatedTokens: number;
  };
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function createBlackboardState(params: {
  traceId: string;
  routeKind: string;
  userText: string;
  graph: AgentGraph;
}): BlackboardState {
  const now = new Date().toISOString();

  const tasks: Record<string, TaskSnapshot> = {};
  for (const node of params.graph.nodes) {
    tasks[node.id] = {
      id: node.id,
      agent: node.agent,
      objective: node.objective,
      status: 'pending',
      attempts: 0,
    };
  }

  return {
    schemaVersion: '1.0',
    traceId: params.traceId,
    routeKind: params.routeKind,
    userText: params.userText,
    createdAt: now,
    updatedAt: now,
    graph: params.graph,
    artifacts: [],
    tasks,
    unresolvedQuestions: [],
    counters: {
      completedTasks: 0,
      failedTasks: 0,
      totalEstimatedTokens: 0,
    },
  };
}

export function markTaskStarted(state: BlackboardState, taskId: string, startedAt: string): void {
  const task = state.tasks[taskId];
  if (!task) return;
  task.status = 'running';
  task.startedAt = startedAt;
  task.attempts += 1;
  state.updatedAt = startedAt;
}

export function appendArtifacts(state: BlackboardState, artifacts: BlackboardArtifact[]): void {
  if (artifacts.length === 0) return;

  const existing = new Set(state.artifacts.map((artifact) => artifact.id));
  for (const artifact of artifacts) {
    if (existing.has(artifact.id)) continue;

    state.artifacts.push({
      ...artifact,
      confidence: clampConfidence(artifact.confidence),
    });
    state.counters.totalEstimatedTokens += estimateTokens(artifact.content);
    existing.add(artifact.id);
  }
  state.updatedAt = new Date().toISOString();
}

export function recordTaskResult(state: BlackboardState, result: AgentResult): void {
  const task = state.tasks[result.taskId];
  if (!task) return;

  task.status = result.status;
  task.attempts = result.attempts;
  task.startedAt = result.startedAt;
  task.finishedAt = result.finishedAt;
  task.error = result.error;

  if (result.status === 'ok' || result.status === 'skipped') {
    state.counters.completedTasks += 1;
  } else {
    state.counters.failedTasks += 1;
  }

  appendArtifacts(state, result.artifacts);
  state.updatedAt = result.finishedAt;
}

export function addUnresolvedQuestion(state: BlackboardState, question: string): void {
  const trimmed = question.trim();
  if (!trimmed) return;
  if (state.unresolvedQuestions.includes(trimmed)) return;
  state.unresolvedQuestions.push(trimmed);
  state.updatedAt = new Date().toISOString();
}

export function contextPacketsToArtifacts(params: {
  taskId: string;
  agent: AgentTaskNode['agent'];
  packets: ContextPacket[];
  now: string;
}): BlackboardArtifact[] {
  const { taskId, agent, packets, now } = params;

  return packets.map((packet, index) => {
    const id = `${taskId}:packet:${index}:${packet.name}`;
    const confidence =
      typeof packet.json === 'object' && packet.json !== null && 'error' in packet.json ? 0.2 : 0.7;

    return {
      id,
      kind: 'context_packet', // Renamed from expert_packet
      label: packet.name,
      content: packet.content,
      confidence,
      sourceAgent: agent,
      provenance: [
        {
          source: packet.name,
          type: 'provider', // Renamed from expert
          timestamp: now,
        },
      ],
      packet,
      json: packet.json,
    };
  });
}

export function renderContextPacketContext(state: BlackboardState): string {
  const packets = state.artifacts
    .filter((artifact) => artifact.kind === 'context_packet')
    .map((artifact) => artifact.packet)
    .filter((packet): packet is ContextPacket => !!packet);

  if (packets.length === 0) return '';
  return packets.map((packet) => `[${packet.name}] ${packet.content}`).join('\n\n');
}

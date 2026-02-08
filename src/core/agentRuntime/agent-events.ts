import { AgentName, AgentResultStatus } from './agent-types';

export type AgentEventType =
  | 'graph_started'
  | 'graph_completed'
  | 'graph_validation_failed'
  | 'node_started'
  | 'node_retry'
  | 'node_completed'
  | 'node_failed'
  | 'artifact_written';

export interface AgentEvent {
  id: string;
  traceId: string;
  type: AgentEventType;
  timestamp: string;
  nodeId?: string;
  agent?: AgentName;
  status?: AgentResultStatus;
  attempt?: number;
  details?: Record<string, unknown>;
}

export interface AgentEventFactory {
  nextEvent(params: Omit<AgentEvent, 'id'>): AgentEvent;
}

export function createAgentEventFactory(traceId: string): AgentEventFactory {
  let counter = 0;
  return {
    nextEvent(params: Omit<AgentEvent, 'id'>): AgentEvent {
      counter += 1;
      return {
        ...params,
        id: `${traceId}:${counter}`,
      };
    },
  };
}

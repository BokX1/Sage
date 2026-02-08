import { LLMChatMessage, LLMMessageContent } from '../llm/llm-types';
import { logger } from '../utils/logger';
import { ExpertName, ExpertPacket } from '../orchestration/experts/expert-types';
import { runExperts } from '../orchestration/runExperts';
import { AgentEvent, createAgentEventFactory } from './agent-events';
import {
  addUnresolvedQuestion,
  createBlackboardState,
  expertPacketsToArtifacts,
  markTaskStarted,
  recordTaskResult,
  BlackboardState,
} from './blackboard';
import { validateAgentGraph } from './graphPolicy';
import { AgentGraph, AgentResult, AgentTaskNode } from './agent-types';

export interface ExecuteAgentGraphParams {
  traceId: string;
  graph: AgentGraph;
  guildId: string | null;
  channelId: string;
  userId: string;
  userText: string;
  userContent?: LLMMessageContent;
  replyReferenceContent?: LLMMessageContent | null;
  conversationHistory?: LLMChatMessage[];
  apiKey?: string;
  maxParallel?: number;
}

export interface ExecuteAgentGraphResult {
  blackboard: BlackboardState;
  events: AgentEvent[];
  packets: ExpertPacket[];
  nodeRuns: AgentNodeRun[];
}

export interface AgentNodeRun {
  traceId: string;
  nodeId: string;
  agent: string;
  status: string;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  errorText: string | null;
  metadataJson?: Record<string, unknown>;
}

const EXPERT_NAMES: ExpertName[] = [
  'Memory',
  'Summarizer',
  'SocialGraph',
  'VoiceAnalytics',
  'ImageGenerator',
];

function asExpertName(agent: AgentTaskNode['agent']): ExpertName | null {
  return EXPERT_NAMES.includes(agent as ExpertName) ? (agent as ExpertName) : null;
}

function timeoutError(nodeId: string, timeoutMs: number): Error {
  return new Error(`Agent node "${nodeId}" timed out after ${timeoutMs}ms`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, nodeId: string): Promise<T> {
  if (timeoutMs <= 0) return promise;

  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(timeoutError(nodeId, timeoutMs));
      }, timeoutMs);
    }),
  ]);
}

async function executeNode(params: {
  node: AgentTaskNode;
  traceId: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  userText: string;
  userContent?: LLMMessageContent;
  replyReferenceContent?: LLMMessageContent | null;
  conversationHistory?: LLMChatMessage[];
  apiKey?: string;
}): Promise<{ packets: ExpertPacket[]; summary: string; confidence: number }> {
  const expertName = asExpertName(params.node.agent);

  if (!expertName) {
    return {
      packets: [],
      summary: `No execution adapter registered for agent "${params.node.agent}".`,
      confidence: 0,
    };
  }

  const packets = await runExperts({
    experts: [expertName],
    guildId: params.guildId,
    channelId: params.channelId,
    userId: params.userId,
    traceId: params.traceId,
    skipMemory: false,
    userText: params.userText,
    userContent: params.userContent,
    replyReferenceContent: params.replyReferenceContent,
    conversationHistory: params.conversationHistory,
    apiKey: params.apiKey,
  });

  if (packets.length === 0) {
    return {
      packets,
      summary: `${expertName} returned no packet.`,
      confidence: 0.4,
    };
  }

  const hadError = packets.some(
    (packet) => typeof packet.json === 'object' && packet.json !== null && 'error' in packet.json,
  );

  return {
    packets,
    summary: hadError
      ? `${expertName} returned degraded output with recoverable issues.`
      : `${expertName} completed successfully.`,
    confidence: hadError ? 0.4 : 0.8,
  };
}

function getReadyNodes(graph: AgentGraph, settled: Set<string>, pending: Set<string>): AgentTaskNode[] {
  const ready: AgentTaskNode[] = [];
  for (const node of graph.nodes) {
    if (!pending.has(node.id)) continue;
    if (node.dependsOn.every((dependency) => settled.has(dependency))) {
      ready.push(node);
    }
  }
  return ready;
}

async function executeNodeWithRetries(params: {
  node: AgentTaskNode;
  traceId: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  userText: string;
  userContent?: LLMMessageContent;
  replyReferenceContent?: LLMMessageContent | null;
  conversationHistory?: LLMChatMessage[];
  apiKey?: string;
  eventFactory: ReturnType<typeof createAgentEventFactory>;
  blackboard: BlackboardState;
}): Promise<{ result: AgentResult; events: AgentEvent[] }> {
  const events: AgentEvent[] = [];
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= params.node.budget.maxRetries + 1; attempt += 1) {
    const startedAt = new Date().toISOString();
    markTaskStarted(params.blackboard, params.node.id, startedAt);
    events.push(
      params.eventFactory.nextEvent({
        traceId: params.traceId,
        type: attempt === 1 ? 'node_started' : 'node_retry',
        timestamp: startedAt,
        nodeId: params.node.id,
        agent: params.node.agent,
        attempt,
      }),
    );

    try {
      const nodeExecution = await withTimeout(
        executeNode({
          node: params.node,
          traceId: params.traceId,
          guildId: params.guildId,
          channelId: params.channelId,
          userId: params.userId,
          userText: params.userText,
          userContent: params.userContent,
          replyReferenceContent: params.replyReferenceContent,
          conversationHistory: params.conversationHistory,
          apiKey: params.apiKey,
        }),
        params.node.budget.maxLatencyMs,
        params.node.id,
      );

      const finishedAt = new Date().toISOString();
      const artifacts = expertPacketsToArtifacts({
        taskId: params.node.id,
        agent: params.node.agent,
        packets: nodeExecution.packets,
        now: finishedAt,
      });

      return {
        result: {
          taskId: params.node.id,
          agent: params.node.agent,
          status: 'ok',
          attempts: attempt,
          startedAt,
          finishedAt,
          summary: nodeExecution.summary,
          confidence: nodeExecution.confidence,
          artifacts,
          packets: nodeExecution.packets,
        },
        events,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const canRetry = attempt <= params.node.budget.maxRetries;
      if (!canRetry) {
        const finishedAt = new Date().toISOString();
        return {
          result: {
            taskId: params.node.id,
            agent: params.node.agent,
            status: 'fatal_error',
            attempts: attempt,
            startedAt,
            finishedAt,
            summary: `${params.node.agent} failed.`,
            confidence: 0,
            artifacts: [],
            packets: [],
            error: lastError,
          },
          events,
        };
      }
    }
  }

  const now = new Date().toISOString();
  return {
    result: {
      taskId: params.node.id,
      agent: params.node.agent,
      status: 'fatal_error',
      attempts: params.node.budget.maxRetries + 1,
      startedAt: now,
      finishedAt: now,
      summary: `${params.node.agent} failed unexpectedly.`,
      confidence: 0,
      artifacts: [],
      packets: [],
      error: lastError ?? 'Unknown execution failure',
    },
    events,
  };
}

export async function executeAgentGraph(params: ExecuteAgentGraphParams): Promise<ExecuteAgentGraphResult> {
  const validation = validateAgentGraph(params.graph);
  const blackboard = createBlackboardState({
    traceId: params.traceId,
    routeKind: params.graph.routeKind,
    userText: params.userText,
    graph: params.graph,
  });
  const events: AgentEvent[] = [];
  const packets: ExpertPacket[] = [];
  const nodeRuns: AgentNodeRun[] = [];
  const eventFactory = createAgentEventFactory(params.traceId);

  events.push(
    eventFactory.nextEvent({
      traceId: params.traceId,
      type: 'graph_started',
      timestamp: new Date().toISOString(),
      details: {
        nodeCount: params.graph.nodes.length,
        edgeCount: params.graph.edges.length,
      },
    }),
  );

  if (!validation.ok) {
    addUnresolvedQuestion(blackboard, 'Execution graph failed validation.');
    events.push(
      eventFactory.nextEvent({
        traceId: params.traceId,
        type: 'graph_validation_failed',
        timestamp: new Date().toISOString(),
        details: { errors: validation.errors },
      }),
    );
    return { blackboard, events, packets, nodeRuns };
  }

  const pending = new Set(params.graph.nodes.map((node) => node.id));
  const settled = new Set<string>();

  while (pending.size > 0) {
    const readyNodes = getReadyNodes(params.graph, settled, pending);
    if (readyNodes.length === 0) {
      addUnresolvedQuestion(blackboard, 'No executable node found. Graph may contain unresolved dependencies.');
      break;
    }
    const maxParallel = Math.max(1, Math.floor(params.maxParallel ?? readyNodes.length));

    for (let index = 0; index < readyNodes.length; index += maxParallel) {
      const group = readyNodes.slice(index, index + maxParallel);
      const batch = await Promise.all(
        group.map((node) =>
          executeNodeWithRetries({
            node,
            traceId: params.traceId,
            guildId: params.guildId,
            channelId: params.channelId,
            userId: params.userId,
            userText: params.userText,
            userContent: params.userContent,
            replyReferenceContent: params.replyReferenceContent,
            conversationHistory: params.conversationHistory,
            apiKey: params.apiKey,
            eventFactory,
            blackboard,
          }),
        ),
      );

      for (const entry of batch) {
        events.push(...entry.events);
        const finalResult = entry.result;

        recordTaskResult(blackboard, finalResult);
        packets.push(...finalResult.packets);
        pending.delete(finalResult.taskId);
        settled.add(finalResult.taskId);

        if (finalResult.artifacts.length > 0) {
          for (const artifact of finalResult.artifacts) {
            events.push(
              eventFactory.nextEvent({
                traceId: params.traceId,
                type: 'artifact_written',
                timestamp: finalResult.finishedAt,
                nodeId: finalResult.taskId,
                agent: finalResult.agent,
                status: finalResult.status,
                details: {
                  artifactId: artifact.id,
                  label: artifact.label,
                  confidence: artifact.confidence,
                },
              }),
            );
          }
        }

        events.push(
          eventFactory.nextEvent({
            traceId: params.traceId,
            type: finalResult.status === 'ok' ? 'node_completed' : 'node_failed',
            timestamp: finalResult.finishedAt,
            nodeId: finalResult.taskId,
            agent: finalResult.agent,
            status: finalResult.status,
            attempt: finalResult.attempts,
            details: {
              summary: finalResult.summary,
              error: finalResult.error,
            },
          }),
        );

        if (finalResult.status !== 'ok') {
          logger.warn(
            {
              traceId: params.traceId,
              nodeId: finalResult.taskId,
              agent: finalResult.agent,
              error: finalResult.error,
            },
            'Agent graph node failed',
          );
        }

        const finishedAt = finalResult.finishedAt || null;
        const startedMs = Number.isNaN(Date.parse(finalResult.startedAt))
          ? null
          : Date.parse(finalResult.startedAt);
        const finishedMs =
          finishedAt && !Number.isNaN(Date.parse(finishedAt)) ? Date.parse(finishedAt) : null;
        const latencyMs =
          startedMs !== null && finishedMs !== null ? Math.max(0, finishedMs - startedMs) : null;

        nodeRuns.push({
          traceId: params.traceId,
          nodeId: finalResult.taskId,
          agent: finalResult.agent,
          status: finalResult.status,
          attempts: finalResult.attempts,
          startedAt: finalResult.startedAt,
          finishedAt,
          latencyMs,
          errorText: finalResult.error ?? null,
          metadataJson: {
            summary: finalResult.summary,
            confidence: finalResult.confidence,
            artifactCount: finalResult.artifacts.length,
            packetCount: finalResult.packets.length,
          },
        });
      }
    }
  }

  events.push(
    eventFactory.nextEvent({
      traceId: params.traceId,
      type: 'graph_completed',
      timestamp: new Date().toISOString(),
      details: {
        completedTasks: blackboard.counters.completedTasks,
        failedTasks: blackboard.counters.failedTasks,
        artifactCount: blackboard.artifacts.length,
      },
    }),
  );

  return { blackboard, events, packets, nodeRuns };
}

import { AgentGraph } from './agent-types';

export interface GraphValidationResult {
  ok: boolean;
  errors: string[];
}

function detectCycle(graph: AgentGraph): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const temp = new Set<string>();
  const perm = new Set<string>();

  const visit = (nodeId: string): boolean => {
    if (perm.has(nodeId)) return false;
    if (temp.has(nodeId)) return true;
    temp.add(nodeId);
    const neighbors = adjacency.get(nodeId) ?? [];
    for (const next of neighbors) {
      if (visit(next)) return true;
    }
    temp.delete(nodeId);
    perm.add(nodeId);
    return false;
  };

  for (const node of graph.nodes) {
    if (visit(node.id)) return true;
  }
  return false;
}

export function validateAgentGraph(graph: AgentGraph): GraphValidationResult {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const edges = new Set<string>();
  const dependencyLinks = new Set<string>();
  const MAX_NODE_LATENCY_MS = 5 * 60 * 1000;
  const MAX_NODE_RETRIES = 3;

  if (graph.version !== 'v1') {
    errors.push(`Unsupported graph version: ${graph.version}`);
  }

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);

    if (node.budget.maxLatencyMs <= 0) {
      errors.push(`Node ${node.id} has invalid maxLatencyMs`);
    }
    if (node.budget.maxLatencyMs > MAX_NODE_LATENCY_MS) {
      errors.push(`Node ${node.id} exceeds maxLatencyMs policy ceiling`);
    }
    if (node.budget.maxRetries < 0) {
      errors.push(`Node ${node.id} has invalid maxRetries`);
    }
    if (node.budget.maxRetries > MAX_NODE_RETRIES) {
      errors.push(`Node ${node.id} exceeds maxRetries policy ceiling`);
    }
    if (node.budget.maxInputTokens <= 0) {
      errors.push(`Node ${node.id} has invalid maxInputTokens`);
    }
    if (node.budget.maxOutputTokens <= 0) {
      errors.push(`Node ${node.id} has invalid maxOutputTokens`);
    }
    if (node.dependsOn.includes(node.id)) {
      errors.push(`Node ${node.id} cannot depend on itself`);
    }
    for (const dependency of node.dependsOn) {
      dependencyLinks.add(`${dependency}->${node.id}`);
    }
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references unknown source node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references unknown target node: ${edge.to}`);
    }
    if (edge.from === edge.to) {
      errors.push(`Self-loop edge detected on ${edge.from}`);
    }
    edges.add(`${edge.from}->${edge.to}`);
  }

  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn) {
      if (!nodeIds.has(dependency)) {
        errors.push(`Node ${node.id} depends on unknown node: ${dependency}`);
      }
      if (!edges.has(`${dependency}->${node.id}`)) {
        errors.push(`Missing edge for dependency ${dependency} -> ${node.id}`);
      }
    }
  }

  for (const edge of edges) {
    if (!dependencyLinks.has(edge)) {
      const [from, to] = edge.split('->');
      errors.push(`Edge ${from} -> ${to} not represented in dependsOn`);
    }
  }

  if (detectCycle(graph)) {
    errors.push('Graph contains a cycle');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

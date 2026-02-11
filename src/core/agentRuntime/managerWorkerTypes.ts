import { ManagerWorkerKind, ManagerWorkerPlan } from './taskPlanner';

export interface ManagerWorkerArtifact {
  taskId: string;
  worker: ManagerWorkerKind;
  objective: string;
  model: string;
  summary: string;
  keyPoints: string[];
  openQuestions: string[];
  citations: string[];
  confidence: number;
  latencyMs: number;
  failed: boolean;
  error?: string;
  rawText: string;
}

export interface ManagerWorkerExecutionResult {
  plan: ManagerWorkerPlan;
  artifacts: ManagerWorkerArtifact[];
  totalWorkers: number;
  failedWorkers: number;
}

export interface ManagerWorkerAggregate {
  contextBlock: string;
  successfulWorkers: number;
  failedWorkers: number;
  citationCount: number;
}

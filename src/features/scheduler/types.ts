export type ScheduledTaskKind = 'reminder_message' | 'agent_run';
export type ScheduledTaskStatus = 'active' | 'paused' | 'cancelled';
export type ScheduledTaskRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ReminderMessagePayload {
  kind: 'reminder_message';
  content: string;
  roleIds?: string[];
  userIds?: string[];
}

export interface AgentRunPayload {
  kind: 'agent_run';
  prompt: string;
  mentionedUserIds?: string[];
}

export type ScheduledTaskPayload = ReminderMessagePayload | AgentRunPayload;

export interface ScheduledTaskRecord {
  id: string;
  guildId: string;
  channelId: string;
  createdByUserId: string;
  kind: ScheduledTaskKind;
  status: ScheduledTaskStatus;
  timezone: string;
  cronExpr: string | null;
  runAt: Date | null;
  nextRunAt: Date | null;
  skipUntil: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  payloadJson: ScheduledTaskPayload;
  provenanceJson: Record<string, unknown> | null;
  lastErrorText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduledTaskRunRecord {
  id: string;
  taskId: string;
  dedupeKey: string;
  status: ScheduledTaskRunStatus;
  scheduledFor: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorText: string | null;
  resultJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduledTaskRuntimeDiagnostic {
  ready: boolean;
  activeTasks: number;
  pausedTasks: number;
  leasedTasks: number;
  dueTasks: number;
}

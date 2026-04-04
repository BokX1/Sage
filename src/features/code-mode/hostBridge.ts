import crypto from 'crypto';
import * as dns from 'node:dns/promises';
import { z } from 'zod';
import type { ToolExecutionContext } from '../agent-runtime/runtimeToolContract';
import { ApprovalRequiredSignal, type ApprovalInterruptPayload } from '../agent-runtime/toolControlSignals';
import { getGuildApprovalReviewChannelId } from '../settings/guildSettingsRepo';
import { isPrivateOrLocalHostname } from '../../platform/config/envSchema';
import type {
  CodeModeApprovalExecutionPayload,
  CodeModeApprovalGrant,
  CodeModeBridgeCallLogEntry,
  CodeModeEffectRecord,
  CodeModeEffectReviewRisk,
  CodeModeEffectReviewSnapshot,
} from './types';
import {
  deserializeArtifacts,
  loadCodeModeEffectLog,
  saveCodeModeEffectLog,
  type CodeModeTaskWorkspace,
} from './workspace';
import type { BridgeMethodSummary, BridgeNamespace } from './bridge/types';
import { assertBridgeAccess } from './bridge/common';
import {
  FIXED_BRIDGE_CONTRACT,
  listBridgeMethodSummariesForAuthority,
  type FixedBridgeContract,
} from './bridge/contract';

type CodeModeOperation =
  | {
      kind: 'bridge';
      namespace: BridgeNamespace;
      method: string;
      args: unknown;
    }
  | {
      kind: 'http';
      request: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        bodyText?: string;
      };
    }
  | {
      kind: 'workspace';
      action: string;
      args: Record<string, unknown>;
    };

export interface HostBridgeSession {
  readonly bridgeCalls: CodeModeBridgeCallLogEntry[];
  readonly artifacts: ReturnType<typeof deserializeArtifacts>;
  listMethods(): BridgeMethodSummary[];
  call(namespace: BridgeNamespace, method: string, args: unknown): Promise<unknown>;
  httpFetch(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
  }): Promise<unknown>;
  workspaceCall(action: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface HostBridgeSessionParams {
  executionId: string;
  workspace: CodeModeTaskWorkspace;
  toolContext: ToolExecutionContext;
  timeoutMs: number;
  approvalGrant?: CodeModeApprovalGrant | null;
  bridgeContract?: FixedBridgeContract;
  workspaceHandlers: {
    read(args: Record<string, unknown>): Promise<unknown>;
    write(args: Record<string, unknown>): Promise<unknown>;
    append(args: Record<string, unknown>): Promise<unknown>;
    list(args: Record<string, unknown>): Promise<unknown>;
    search(args: Record<string, unknown>): Promise<unknown>;
    delete(args: Record<string, unknown>): Promise<unknown>;
  };
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncatePreview(value: string | null, maxChars = 280): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(1, maxChars - 1))}…`;
}

function buildCodeModeEffectReviewSnapshot(params: {
  effectLabel: string;
  executionId: string;
  effectIndex: number;
  title?: string;
  intent?: string;
  target?: string;
  impact?: string;
  risk?: CodeModeEffectReviewRisk;
  preview?: string;
}): CodeModeEffectReviewSnapshot {
  return {
    kind: 'code_mode_effect',
    effectLabel: params.effectLabel,
    effectIndex: params.effectIndex,
    executionId: params.executionId,
    title: params.title,
    intent: params.intent,
    target: params.target,
    impact: params.impact,
    risk: params.risk,
    preview: params.preview,
  };
}

function describeBridgeEffect(params: {
  namespace: BridgeNamespace;
  method: string;
  args: unknown;
  definitionSummary: string;
}): Omit<CodeModeEffectReviewSnapshot, 'kind' | 'effectLabel' | 'effectIndex' | 'executionId'> {
  const record = typeof params.args === 'object' && params.args && !Array.isArray(params.args)
    ? params.args as Record<string, unknown>
    : {};
  const channelId = asTrimmedString(record.channelId);
  const messageId = asTrimmedString(record.messageId);
  const threadId = asTrimmedString(record.threadId);
  const userId = asTrimmedString(record.userId);
  const roleId = asTrimmedString(record.roleId);
  const content = asTrimmedString(record.content);
  const emoji = asTrimmedString(record.emoji);
  const name = asTrimmedString(record.name);
  const artifactId = asTrimmedString(record.artifactId);
  const caseId = asTrimmedString(record.caseId);
  const jobId = asTrimmedString(record.jobId);

  switch (`${params.namespace}.${params.method}`) {
    case 'discord.messages.send':
      return {
        title: 'Sage Action Review',
        intent: 'Send a Discord message',
        target: channelId ? `<#${channelId}>` : 'Selected channel',
        impact: 'Posts a new message in the selected channel.',
        risk: 'low',
        preview: truncatePreview(content),
      };
    case 'discord.messages.reply':
      return {
        title: 'Sage Action Review',
        intent: 'Reply to a Discord message',
        target: channelId && messageId ? `Message ${messageId} in <#${channelId}>` : 'Selected message',
        impact: 'Posts a reply in the same conversation thread.',
        risk: 'low',
        preview: truncatePreview(content),
      };
    case 'discord.messages.edit':
      return {
        title: 'Sage Action Review',
        intent: 'Edit a Sage message',
        target: channelId && messageId ? `Message ${messageId} in <#${channelId}>` : 'Existing Sage message',
        impact: 'Updates a message Sage already posted.',
        risk: 'medium',
        preview: truncatePreview(content),
      };
    case 'discord.reactions.add':
      return {
        title: 'Sage Action Review',
        intent: 'Add a reaction',
        target: channelId && messageId ? `Message ${messageId} in <#${channelId}>` : 'Selected message',
        impact: 'Adds one reaction to the selected message.',
        risk: 'low',
        preview: truncatePreview(emoji ? `Emoji: ${emoji}` : null),
      };
    case 'discord.reactions.remove':
      return {
        title: 'Sage Action Review',
        intent: 'Remove Sage’s reaction',
        target: channelId && messageId ? `Message ${messageId} in <#${channelId}>` : 'Selected message',
        impact: 'Removes Sage’s own reaction from the selected message.',
        risk: 'low',
        preview: truncatePreview(emoji ? `Emoji: ${emoji}` : null),
      };
    case 'discord.threads.create':
      return {
        title: 'Thread Review',
        intent: 'Create a Discord thread',
        target: channelId ? `<#${channelId}>` : 'Selected channel',
        impact: 'Starts a new discussion thread in the selected channel.',
        risk: 'medium',
        preview: truncatePreview(name ? `Thread name: ${name}` : null),
      };
    case 'discord.threads.update':
      return {
        title: 'Thread Review',
        intent: 'Update a Discord thread',
        target: threadId ? `Thread ${threadId}` : 'Selected thread',
        impact: 'Changes thread settings such as its name or archive state.',
        risk: 'medium',
        preview: truncatePreview(name ? `Thread name: ${name}` : null),
      };
    case 'discord.threads.join':
      return {
        title: 'Thread Review',
        intent: 'Join a Discord thread',
        target: threadId ? `Thread ${threadId}` : 'Selected thread',
        impact: 'Makes Sage join the selected thread.',
        risk: 'low',
      };
    case 'discord.threads.leave':
      return {
        title: 'Thread Review',
        intent: 'Leave a Discord thread',
        target: threadId ? `Thread ${threadId}` : 'Selected thread',
        impact: 'Makes Sage leave the selected thread.',
        risk: 'low',
      };
    case 'discord.threads.addMember':
      return {
        title: 'Thread Review',
        intent: 'Add someone to a thread',
        target: threadId ? `Thread ${threadId}` : 'Selected thread',
        impact: 'Adds a member to the selected thread.',
        risk: 'medium',
        preview: truncatePreview(userId ? `Member: <@${userId}>` : null),
      };
    case 'discord.threads.removeMember':
      return {
        title: 'Thread Review',
        intent: 'Remove someone from a thread',
        target: threadId ? `Thread ${threadId}` : 'Selected thread',
        impact: 'Removes a member from the selected thread.',
        risk: 'medium',
        preview: truncatePreview(userId ? `Member: <@${userId}>` : null),
      };
    case 'discord.threads.archive':
      return {
        title: 'Thread Review',
        intent: 'Archive a Discord thread',
        target: threadId ? `Thread ${threadId}` : 'Selected thread',
        impact: 'Closes the selected thread until it is reopened.',
        risk: 'medium',
      };
    case 'discord.threads.reopen':
      return {
        title: 'Thread Review',
        intent: 'Reopen a Discord thread',
        target: threadId ? `Thread ${threadId}` : 'Selected thread',
        impact: 'Reopens an archived thread.',
        risk: 'medium',
      };
    case 'discord.roles.add':
      return {
        title: 'Role Review',
        intent: 'Add a role to a member',
        target: userId ? `<@${userId}>` : 'Selected member',
        impact: 'Grants an existing role to a server member.',
        risk: 'high',
        preview: truncatePreview(roleId ? `Role ID: ${roleId}` : null),
      };
    case 'discord.roles.remove':
      return {
        title: 'Role Review',
        intent: 'Remove a role from a member',
        target: userId ? `<@${userId}>` : 'Selected member',
        impact: 'Removes an existing role from a server member.',
        risk: 'high',
        preview: truncatePreview(roleId ? `Role ID: ${roleId}` : null),
      };
    case 'artifacts.create':
      return {
        title: 'Artifact Review',
        intent: 'Create a text artifact',
        target: asTrimmedString(record.name) ?? 'New artifact',
        impact: 'Creates a reusable text artifact Sage can manage and publish later.',
        risk: 'medium',
        preview: truncatePreview(asTrimmedString(record.descriptionText) ?? asTrimmedString(record.content)),
      };
    case 'artifacts.update':
      return {
        title: 'Artifact Review',
        intent: 'Update a text artifact',
        target: artifactId ?? 'Existing artifact',
        impact: 'Changes the saved contents or metadata of an artifact.',
        risk: 'medium',
        preview: truncatePreview(asTrimmedString(record.descriptionText) ?? asTrimmedString(record.content)),
      };
    case 'artifacts.publish':
      return {
        title: 'Artifact Publish Review',
        intent: 'Publish an artifact to Discord',
        target: channelId ? `<#${channelId}>` : 'Selected channel',
        impact: 'Posts the latest artifact contents into the selected Discord channel.',
        risk: 'medium',
        preview: truncatePreview(artifactId ? `Artifact ID: ${artifactId}` : null),
      };
    case 'admin.instructions.update':
      return {
        title: 'Sage Persona Review',
        intent: 'Update Sage’s server instructions',
        target: 'Server-wide Sage behavior',
        impact: 'Changes how Sage behaves for future conversations in this server.',
        risk: 'high',
        preview: truncatePreview(asTrimmedString(record.instructionsText)),
      };
    case 'moderation.cases.acknowledge':
      return {
        title: 'Moderation Review',
        intent: 'Acknowledge a moderation case',
        target: caseId ?? 'Moderation case',
        impact: 'Marks a moderation case as acknowledged for follow-up.',
        risk: 'medium',
      };
    case 'moderation.cases.resolve':
      return {
        title: 'Moderation Review',
        intent: 'Resolve a moderation case',
        target: caseId ?? 'Moderation case',
        impact: 'Closes a moderation case with an outcome and optional reason.',
        risk: 'high',
        preview: truncatePreview(asTrimmedString(record.resolutionReasonText)),
      };
    case 'moderation.notes.create':
      return {
        title: 'Moderation Review',
        intent: 'Add a moderation note',
        target: caseId ?? 'Moderation case',
        impact: 'Adds an internal moderation note to the case record.',
        risk: 'medium',
        preview: truncatePreview(asTrimmedString(record.noteText)),
      };
    case 'moderation.messages.delete':
      return {
        title: 'Moderation Review',
        intent: 'Delete a Discord message',
        target: channelId && messageId ? `Message ${messageId} in <#${channelId}>` : 'Selected message',
        impact: 'Removes a message from the server through the moderation path.',
        risk: 'high',
        preview: truncatePreview(asTrimmedString(record.reasonText)),
      };
    case 'moderation.messages.bulkDelete':
      return {
        title: 'Moderation Review',
        intent: 'Bulk delete Discord messages',
        target: channelId ? `<#${channelId}>` : 'Selected channel',
        impact: 'Deletes multiple recent messages in one moderation action.',
        risk: 'critical',
        preview: truncatePreview(asTrimmedString(record.reasonText)),
      };
    case 'moderation.reactions.removeUser':
      return {
        title: 'Moderation Review',
        intent: 'Remove a user reaction',
        target: channelId && messageId ? `Message ${messageId} in <#${channelId}>` : 'Selected message',
        impact: 'Removes one user’s reaction from the selected message.',
        risk: 'medium',
        preview: truncatePreview(asTrimmedString(record.reasonText) ?? (userId ? `User: <@${userId}>` : null)),
      };
    case 'schedule.jobs.create':
      return {
        title: 'Schedule Review',
        intent: 'Create a scheduled job',
        target: channelId ? `<#${channelId}>` : 'Scheduled task',
        impact: 'Creates a new scheduled reminder or agent run.',
        risk: 'medium',
        preview: truncatePreview(asTrimmedString(record.runAtIso) ?? asTrimmedString(record.cronExpr)),
      };
    case 'schedule.jobs.update':
      return {
        title: 'Schedule Review',
        intent: 'Update a scheduled job',
        target: jobId ?? 'Scheduled job',
        impact: 'Changes an existing reminder or agent run schedule.',
        risk: 'medium',
        preview: truncatePreview(asTrimmedString(record.runAtIso) ?? asTrimmedString(record.cronExpr)),
      };
    case 'schedule.jobs.pause':
      return {
        title: 'Schedule Review',
        intent: 'Pause a scheduled job',
        target: jobId ?? 'Scheduled job',
        impact: 'Temporarily stops a scheduled job from running.',
        risk: 'medium',
      };
    case 'schedule.jobs.resume':
      return {
        title: 'Schedule Review',
        intent: 'Resume a scheduled job',
        target: jobId ?? 'Scheduled job',
        impact: 'Restarts a paused scheduled job.',
        risk: 'medium',
      };
    case 'schedule.jobs.cancel':
      return {
        title: 'Schedule Review',
        intent: 'Cancel a scheduled job',
        target: jobId ?? 'Scheduled job',
        impact: 'Permanently stops a scheduled job from running again.',
        risk: 'high',
      };
    case 'schedule.jobs.run':
      return {
        title: 'Schedule Review',
        intent: 'Run a scheduled job now',
        target: jobId ?? 'Scheduled job',
        impact: 'Triggers the selected scheduled job immediately.',
        risk: 'medium',
      };
    default:
      return {
        title: 'Sage Action Review',
        intent: params.definitionSummary,
        target: 'Requested Sage action',
        impact: 'Runs a reviewed action through Sage’s controlled runtime.',
        risk: params.namespace === 'moderation' || params.namespace === 'admin'
          ? 'high'
          : params.namespace === 'discord' && params.method.startsWith('roles.')
            ? 'high'
            : 'medium',
      };
  }
}

function buildApprovalPayload(params: {
  toolContext: ToolExecutionContext;
  effectIndex: number;
  effectLabel: string;
  executionId: string;
  taskId: string;
  requestHash: string;
  reviewSnapshot?: CodeModeEffectReviewSnapshot;
}): ApprovalInterruptPayload {
  const guildId = params.toolContext.guildId?.trim();
  const userId = params.toolContext.userId?.trim();
  const channelId = params.toolContext.channelId?.trim();
  if (!guildId || !userId || !channelId) {
    throw new Error('Code Mode effect approval requires guild, user, and channel context.');
  }

  return {
    kind: 'code_mode_effect',
    guildId,
    sourceChannelId: channelId,
    reviewChannelId: channelId,
    sourceMessageId: params.toolContext.currentTurn?.messageId ?? null,
    requestedBy: userId,
    dedupeKey: `code_mode_effect:${params.executionId}:${params.effectIndex}:${params.requestHash}`,
    executionPayloadJson: {
      executionId: params.executionId,
      taskId: params.taskId,
      effectIndex: params.effectIndex,
      effectLabel: params.effectLabel,
      requestHash: params.requestHash,
    } satisfies CodeModeApprovalExecutionPayload,
    reviewSnapshotJson: params.reviewSnapshot ?? {
      kind: 'code_mode_effect',
      effectLabel: params.effectLabel,
      effectIndex: params.effectIndex,
      executionId: params.executionId,
    },
    interruptMetadataJson: {
      effectIndex: params.effectIndex,
      effectLabel: params.effectLabel,
      executionId: params.executionId,
    },
  };
}

function isWriteHttpMethod(method: string | undefined): boolean {
  const normalized = (method ?? 'GET').trim().toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS';
}

export async function resolveHostnameForCodeMode(hostname: string) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

async function performHttpFetch(
  params: HostBridgeSessionParams,
  request: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
  },
): Promise<{ result: unknown; mutability: 'read' | 'write'; label: string }> {
  const url = new URL(request.url);
  if (!/^https?:$/i.test(url.protocol)) {
    throw new Error('Code Mode http.fetch only supports HTTP(S) URLs.');
  }
  if (isPrivateOrLocalHostname(url.hostname)) {
    throw new Error('Code Mode http.fetch cannot reach local or private network hosts.');
  }
  const resolvedAddresses = await resolveHostnameForCodeMode(url.hostname);
  if (!Array.isArray(resolvedAddresses) || resolvedAddresses.length === 0) {
    throw new Error(`Code Mode http.fetch could not resolve "${url.hostname}".`);
  }
  for (const resolved of resolvedAddresses) {
    if (isPrivateOrLocalHostname(resolved.address)) {
      throw new Error('Code Mode http.fetch cannot reach hosts that resolve to local or private network addresses.');
    }
  }

  const method = (request.method ?? 'GET').trim().toUpperCase();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: request.headers,
      body: request.bodyText,
      signal: params.toolContext.signal,
      redirect: 'manual',
    });
  } catch (error) {
    throw new Error(describeFetchFailure(error, url), { cause: error });
  }
  const bodyText = await response.text();
  return {
    mutability: isWriteHttpMethod(method) ? 'write' : 'read',
    label: `http.fetch ${method} ${url.hostname}${url.pathname}`,
    result: {
      url: url.toString(),
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      bodyText,
    },
  };
}

function describeFetchFailure(error: unknown, url: URL): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    const code =
      typeof (current as Error & { code?: unknown }).code === 'string'
        ? (current as Error & { code: string }).code
        : null;
    parts.push(code ? `${current.message} (${code})` : current.message);
    current = (current as Error & { cause?: unknown }).cause;
  }
  const detail = parts.filter(Boolean).join(' -> ') || String(error);
  return `Code Mode http.fetch failed for ${url.toString()}: ${detail}`;
}

function parseWorkspaceArgs(args: Record<string, unknown>) {
  return z.record(z.string(), z.unknown()).parse(args);
}

export async function createHostBridgeSession(
  params: HostBridgeSessionParams,
): Promise<HostBridgeSession> {
  const bridgeContract = params.bridgeContract ?? FIXED_BRIDGE_CONTRACT;
  const effectLog = await loadCodeModeEffectLog(params.workspace, params.executionId);
  const bridgeCalls: CodeModeBridgeCallLogEntry[] = [];
  const restoredArtifacts = new Map<number, ReturnType<typeof deserializeArtifacts>>();
  let nextIndex = 0;

  const saveLog = async () => {
    await saveCodeModeEffectLog(params.workspace, params.executionId, effectLog);
  };

  const replayArtifacts = (index: number, entry: CodeModeEffectRecord) => {
    if (!entry.artifacts || restoredArtifacts.has(index)) {
      return;
    }
    restoredArtifacts.set(index, deserializeArtifacts(entry.artifacts));
  };

  const executeOperation = async (operation: CodeModeOperation): Promise<unknown> => {
    const index = nextIndex;
    nextIndex += 1;
    const requestHash = stableHash(operation);
    const existing = effectLog[index];
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error(`Code Mode effect #${index} changed between retries; aborting non-deterministic replay.`);
      }
      replayArtifacts(index, existing);
      bridgeCalls.push({
        index,
        operationKind: existing.operationKind,
        label: existing.label,
        mutability: existing.mutability,
        status: existing.status === 'executed' ? 'replayed' : existing.status,
        replayed: true,
      });
      if (existing.status === 'executed') {
        return existing.result;
      }
      if (existing.status === 'denied') {
        throw new Error(existing.errorText ?? 'Code Mode effect was denied.');
      }
      const approvalGrantMatchesCurrentEffect =
        params.approvalGrant?.effectIndex === index &&
        params.approvalGrant.requestHash === existing.requestHash;
      if (existing.status === 'approval_required' && approvalGrantMatchesCurrentEffect) {
        // Continue to re-execute the approved effect.
      } else if (existing.status === 'approval_required' && params.approvalGrant?.effectIndex === index) {
        throw new Error(`Code Mode approval replay for effect #${index} no longer matches the original request hash.`);
      } else if (existing.status === 'approval_required') {
        const existingReviewSnapshot =
          existing.approval?.kind === 'code_mode_effect'
            ? buildCodeModeEffectReviewSnapshot({
                effectLabel: existing.label,
                effectIndex: index,
                executionId: params.executionId,
              })
            : undefined;
        throw new ApprovalRequiredSignal(
          buildApprovalPayload({
            toolContext: params.toolContext,
            effectIndex: index,
            effectLabel: existing.label,
            executionId: params.executionId,
            taskId: params.workspace.taskId,
            requestHash,
            reviewSnapshot: existingReviewSnapshot,
          }),
        );
      }
      if (existing.status === 'failed') {
        throw new Error(existing.errorText ?? 'Code Mode effect failed previously.');
      }
    }

    let operationKind: CodeModeBridgeCallLogEntry['operationKind'];
    let label: string;
    let mutability: 'read' | 'write';
    let approvalMode: 'none' | 'required' = 'none';
    let executor: () => Promise<unknown>;
    let reviewSnapshot: CodeModeEffectReviewSnapshot | undefined;

    if (operation.kind === 'bridge') {
      if (operation.namespace === 'admin' && operation.method === 'runtime.getCapabilities') {
        operationKind = 'admin';
        label = 'admin.runtime.getCapabilities';
        mutability = 'read';
        executor = async () => {
          const methods = listBridgeMethodSummariesForAuthority(params.toolContext.invokerAuthority);
          const namespaces = Array.from(new Set(methods.map((method) => method.namespace)));
          return {
            kind: 'capabilities',
            namespaces,
            methods,
          };
        };
      } else {
        const method = bridgeContract[operation.namespace]?.[operation.method];
        if (!method) {
          throw new Error(`Bridge method "${operation.namespace}.${operation.method}" is not available.`);
        }
        assertBridgeAccess(params.toolContext, method.access);
        const parsedArgs = method.input.parse(operation.args);
        operationKind = method.namespace;
        label = `${method.namespace}.${method.method}`;
        mutability = method.mutability;
        approvalMode = method.approvalMode ?? 'none';
        reviewSnapshot = buildCodeModeEffectReviewSnapshot({
          effectLabel: label,
          effectIndex: index,
          executionId: params.executionId,
          ...describeBridgeEffect({
            namespace: method.namespace,
            method: method.method,
            args: parsedArgs,
            definitionSummary: method.summary,
          }),
        });
        executor = async () => method.execute(parsedArgs, { toolContext: params.toolContext });
      }
    } else if (operation.kind === 'http') {
      operationKind = 'http';
      const prepared = await performHttpFetch(params, operation.request);
      label = prepared.label;
      mutability = prepared.mutability;
      executor = async () => prepared.result;
    } else {
      operationKind = 'workspace';
      label = `workspace.${operation.action}`;
      mutability = operation.action === 'read' || operation.action === 'list' || operation.action === 'search'
        ? 'read'
        : 'write';
      const parsedArgs = parseWorkspaceArgs(operation.args);
      executor = async () => {
        switch (operation.action) {
          case 'read':
            return params.workspaceHandlers.read(parsedArgs);
          case 'write':
            return params.workspaceHandlers.write(parsedArgs);
          case 'append':
            return params.workspaceHandlers.append(parsedArgs);
          case 'list':
            return params.workspaceHandlers.list(parsedArgs);
          case 'search':
            return params.workspaceHandlers.search(parsedArgs);
          case 'delete':
            return params.workspaceHandlers.delete(parsedArgs);
          default:
            throw new Error(`Unknown workspace action "${operation.action}".`);
        }
      };
    }

    if (mutability === 'write' && approvalMode === 'required' && !params.approvalGrant) {
      const approval = buildApprovalPayload({
        toolContext: params.toolContext,
        effectIndex: index,
        effectLabel: label,
        executionId: params.executionId,
        taskId: params.workspace.taskId,
        requestHash,
        reviewSnapshot,
      });
      const reviewChannelId = await fetchReviewChannelId(params.toolContext);
      const approvalPayload = {
        ...approval,
        reviewChannelId: reviewChannelId ?? approval.reviewChannelId,
      };
      effectLog[index] = {
        index,
        operationKind,
        requestHash,
        mutability,
        status: 'approval_required',
        label,
        approval: {
          requestId: null,
          requestHash,
          kind: approvalPayload.kind,
          reviewChannelId: approvalPayload.reviewChannelId,
        },
        createdAtIso: new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      };
      await saveLog();
      bridgeCalls.push({
        index,
        operationKind,
        label,
        mutability,
        status: 'approval_required',
        replayed: false,
      });
      throw new ApprovalRequiredSignal(approvalPayload);
    }

    try {
      const result = await executor();
      effectLog[index] = {
        index,
        operationKind,
        requestHash,
        mutability,
        status: 'executed',
        label,
        result,
        artifacts: [],
        createdAtIso: existing?.createdAtIso ?? new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      };
      await saveLog();
      bridgeCalls.push({
        index,
        operationKind,
        label,
        mutability,
        status: 'executed',
        replayed: false,
      });
      return result;
    } catch (error) {
      if (error instanceof ApprovalRequiredSignal) {
        throw error;
      }
      effectLog[index] = {
        index,
        operationKind,
        requestHash,
        mutability,
        status: 'failed',
        label,
        errorText: error instanceof Error ? error.message : String(error),
        createdAtIso: existing?.createdAtIso ?? new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      };
      await saveLog();
      bridgeCalls.push({
        index,
        operationKind,
        label,
        mutability,
        status: 'failed',
        replayed: false,
      });
      throw error;
    }
  };

  return {
    bridgeCalls,
    artifacts: Array.from(restoredArtifacts.values()).flat(),
    listMethods: () => listBridgeMethodSummariesForAuthority(params.toolContext.invokerAuthority),
    call: async (namespace, method, args) =>
      executeOperation({
        kind: 'bridge',
        namespace,
        method,
        args,
      }),
    httpFetch: async (request) => executeOperation({ kind: 'http', request }),
    workspaceCall: async (action, args) => executeOperation({ kind: 'workspace', action, args }),
  };
}

async function fetchReviewChannelId(toolContext: ToolExecutionContext): Promise<string | null> {
  if (!toolContext.guildId) {
    return null;
  }
  const configured = await getGuildApprovalReviewChannelId(toolContext.guildId).catch(() => null);
  return configured ?? toolContext.channelId ?? null;
}

import crypto from 'crypto';
import * as dns from 'node:dns/promises';
import { globalToolRegistry, type ToolExecutionContext, type ToolRegistry } from '../agent-runtime/toolRegistry';
import { executeToolWithTimeout } from '../agent-runtime/toolCallExecution';
import { ApprovalRequiredSignal, type ApprovalInterruptPayload } from '../agent-runtime/toolControlSignals';
import { getGuildApprovalReviewChannelId } from '../settings/guildSettingsRepo';
import { isPrivateOrLocalHostname } from '../../platform/config/envSchema';
import type {
  CodeModeApprovalExecutionPayload,
  CodeModeApprovalGrant,
  CodeModeBridgeCallLogEntry,
  CodeModeEffectRecord,
} from './types';
import {
  deserializeArtifacts,
  loadCodeModeEffectLog,
  saveCodeModeEffectLog,
  type CodeModeTaskWorkspace,
  serializeArtifacts,
} from './workspace';

type CodeModeOperation =
  | { kind: 'tool'; toolName: string; args: unknown }
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
  listTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  tool(name: string, args: unknown): Promise<unknown>;
  httpFetch(params: { url: string; method?: string; headers?: Record<string, string>; bodyText?: string }): Promise<unknown>;
  workspaceCall(action: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface HostBridgeSessionParams {
  executionId: string;
  workspace: CodeModeTaskWorkspace;
  toolContext: ToolExecutionContext;
  accessibleToolNames: string[];
  timeoutMs: number;
  approvalGrant?: CodeModeApprovalGrant | null;
  registry?: ToolRegistry;
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
  const json = JSON.stringify(value);
  return crypto.createHash('sha256').update(json).digest('hex');
}

function buildApprovalPayload(params: {
  toolContext: ToolExecutionContext;
  effectIndex: number;
  effectLabel: string;
  executionId: string;
  taskId: string;
  requestHash: string;
  underlyingPayload?: ApprovalInterruptPayload | null;
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
    sourceChannelId: params.underlyingPayload?.sourceChannelId ?? channelId,
    reviewChannelId:
      params.underlyingPayload?.reviewChannelId ??
      params.toolContext.channelId,
    sourceMessageId: params.underlyingPayload?.sourceMessageId ?? params.toolContext.currentTurn?.messageId ?? null,
    requestedBy: params.underlyingPayload?.requestedBy ?? userId,
    dedupeKey: `code_mode_effect:${params.executionId}:${params.effectIndex}:${params.requestHash}`,
    executionPayloadJson: {
      executionId: params.executionId,
      taskId: params.taskId,
      effectIndex: params.effectIndex,
      effectLabel: params.effectLabel,
      requestHash: params.requestHash,
    } satisfies CodeModeApprovalExecutionPayload,
    reviewSnapshotJson: {
      kind: 'code_mode_effect',
      effectLabel: params.effectLabel,
      effectIndex: params.effectIndex,
      executionId: params.executionId,
      underlyingKind: params.underlyingPayload?.kind ?? null,
      underlyingReview: params.underlyingPayload?.reviewSnapshotJson ?? null,
    },
    interruptMetadataJson: {
      effectIndex: params.effectIndex,
      effectLabel: params.effectLabel,
      executionId: params.executionId,
      underlyingKind: params.underlyingPayload?.kind ?? null,
    },
  };
}

function isWriteHttpMethod(method: string | undefined): boolean {
  const normalized = (method ?? 'GET').trim().toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS';
}

async function fetchReviewChannelId(toolContext: ToolExecutionContext): Promise<string | null> {
  if (!toolContext.guildId) {
    return null;
  }
  const configured = await getGuildApprovalReviewChannelId(toolContext.guildId).catch(() => null);
  return configured ?? toolContext.channelId ?? null;
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
  const response = await fetch(url, {
    method,
    headers: request.headers,
    body: request.bodyText,
    signal: params.toolContext.signal,
    redirect: 'manual',
  });
  const bodyText = await response.text();
  return {
    mutability: isWriteHttpMethod(method) ? 'write' : 'read',
    label: `http.${method} ${url.hostname}${url.pathname}`,
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

export async function createHostBridgeSession(
  params: HostBridgeSessionParams,
): Promise<HostBridgeSession> {
  const registry = params.registry ?? globalToolRegistry;
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
        // Fall through and execute the approved effect below.
      } else if (existing.status === 'approval_required' && params.approvalGrant?.effectIndex === index) {
        throw new Error(`Code Mode approval replay for effect #${index} no longer matches the original request hash.`);
      } else if (existing.status === 'approval_required') {
        throw new ApprovalRequiredSignal(
          buildApprovalPayload({
            toolContext: params.toolContext,
            effectIndex: index,
            effectLabel: existing.label,
            executionId: params.executionId,
            taskId: params.workspace.taskId,
            requestHash,
            underlyingPayload: existing.approval?.kind
              ? ({
                  kind: existing.approval.kind,
                  guildId: params.toolContext.guildId ?? '',
                  sourceChannelId: params.toolContext.channelId,
                  reviewChannelId: existing.approval.reviewChannelId ?? params.toolContext.channelId,
                  requestedBy: params.toolContext.userId,
                  dedupeKey: `replay:${params.executionId}:${index}`,
                  executionPayloadJson: {},
                  reviewSnapshotJson: {},
                } as ApprovalInterruptPayload)
              : null,
          }),
        );
      }
    }

    let mutability: 'read' | 'write' = 'read';
    let label: string;
    let result: unknown;
    let artifacts = [] as ReturnType<typeof deserializeArtifacts>;

    if (operation.kind === 'tool') {
      if (!params.accessibleToolNames.includes(operation.toolName)) {
        throw new Error(`Tool "${operation.toolName}" is not available to this Code Mode turn.`);
      }
      const resolved = await registry.resolveActionPolicy(
        { name: operation.toolName, args: operation.args },
        params.toolContext,
      );
      if (!resolved) {
        throw new Error(`Unable to resolve action policy for tool "${operation.toolName}".`);
      }
      mutability = resolved.policy.mutability;
      label = `tool.${operation.toolName}`;
      if (
        mutability === 'write' &&
        resolved.policy.approvalMode === 'required' &&
        params.approvalGrant?.effectIndex !== index
      ) {
        const underlyingPayload =
          typeof resolved.policy.prepareApproval === 'function'
            ? await resolved.policy.prepareApproval(resolved.args, params.toolContext)
            : {
                kind: 'code_mode_effect_write',
                guildId: params.toolContext.guildId ?? '',
                sourceChannelId: params.toolContext.channelId,
                reviewChannelId: (await fetchReviewChannelId(params.toolContext)) ?? params.toolContext.channelId,
                sourceMessageId: params.toolContext.currentTurn?.messageId ?? null,
                requestedBy: params.toolContext.userId,
                dedupeKey: `tool:${operation.toolName}:${index}:${requestHash}`,
                executionPayloadJson: { toolName: operation.toolName, args: operation.args },
                reviewSnapshotJson: { toolName: operation.toolName, args: operation.args },
              };
        const payload = buildApprovalPayload({
          toolContext: params.toolContext,
          effectIndex: index,
          effectLabel: label,
          executionId: params.executionId,
          taskId: params.workspace.taskId,
          requestHash,
          underlyingPayload,
        });
        const now = new Date().toISOString();
        effectLog[index] = {
          index,
          operationKind: 'tool',
          requestHash,
          mutability,
          status: 'approval_required',
          label,
          approval: {
            requestHash: requestHash,
            kind: payload.kind,
            reviewChannelId: payload.reviewChannelId,
          },
          createdAtIso: now,
          updatedAtIso: now,
        };
        await saveLog();
        bridgeCalls.push({
          index,
          operationKind: 'tool',
          label,
          mutability,
          status: 'approval_required',
          replayed: false,
        });
        throw new ApprovalRequiredSignal(payload);
      }
      const toolResult = await executeToolWithTimeout(
        registry,
        { name: operation.toolName, args: operation.args },
        params.toolContext,
        params.timeoutMs,
      );
      if (!toolResult.success) {
        throw new Error(toolResult.error ?? `Tool "${operation.toolName}" failed.`);
      }
      result = toolResult.structuredContent;
      artifacts = toolResult.artifacts ?? [];
    } else if (operation.kind === 'http') {
      const httpOutcome = await performHttpFetch(params, operation.request);
      mutability = httpOutcome.mutability;
      label = httpOutcome.label;
      if (mutability === 'write' && params.approvalGrant?.effectIndex !== index) {
        const reviewChannelId = (await fetchReviewChannelId(params.toolContext)) ?? params.toolContext.channelId;
        const payload = buildApprovalPayload({
          toolContext: params.toolContext,
          effectIndex: index,
          effectLabel: label,
          executionId: params.executionId,
          taskId: params.workspace.taskId,
          requestHash,
          underlyingPayload: {
            kind: 'code_mode_http_write',
            guildId: params.toolContext.guildId ?? '',
            sourceChannelId: params.toolContext.channelId,
            reviewChannelId,
            sourceMessageId: params.toolContext.currentTurn?.messageId ?? null,
            requestedBy: params.toolContext.userId,
            dedupeKey: `http:${index}:${requestHash}`,
            executionPayloadJson: operation.request,
            reviewSnapshotJson: operation.request,
          },
        });
        const now = new Date().toISOString();
        effectLog[index] = {
          index,
          operationKind: 'http',
          requestHash,
          mutability,
          status: 'approval_required',
          label,
          approval: {
            requestHash: requestHash,
            kind: payload.kind,
            reviewChannelId: payload.reviewChannelId,
          },
          createdAtIso: now,
          updatedAtIso: now,
        };
        await saveLog();
        bridgeCalls.push({
          index,
          operationKind: 'http',
          label,
          mutability,
          status: 'approval_required',
          replayed: false,
        });
        throw new ApprovalRequiredSignal(payload);
      }
      result = httpOutcome.result;
    } else {
      label = `workspace.${operation.action}`;
      if (operation.action === 'read') {
        result = await params.workspaceHandlers.read(operation.args);
      } else if (operation.action === 'write') {
        mutability = 'write';
        result = await params.workspaceHandlers.write(operation.args);
      } else if (operation.action === 'append') {
        mutability = 'write';
        result = await params.workspaceHandlers.append(operation.args);
      } else if (operation.action === 'list') {
        result = await params.workspaceHandlers.list(operation.args);
      } else if (operation.action === 'search') {
        result = await params.workspaceHandlers.search(operation.args);
      } else if (operation.action === 'delete') {
        mutability = 'write';
        result = await params.workspaceHandlers.delete(operation.args);
      } else {
        throw new Error(`Unsupported workspace action "${operation.action}".`);
      }
    }

    const now = new Date().toISOString();
    effectLog[index] = {
      index,
      operationKind: operation.kind,
      requestHash,
      mutability,
      status: 'executed',
      label,
      result,
      artifacts: serializeArtifacts(artifacts),
      createdAtIso: existing?.createdAtIso ?? now,
      updatedAtIso: now,
    };
    await saveLog();
    replayArtifacts(index, effectLog[index]!);
    bridgeCalls.push({
      index,
      operationKind: operation.kind,
      label,
      mutability,
      status: 'executed',
      replayed: false,
    });
    return result;
  };

  return {
    bridgeCalls,
    artifacts: Array.from(restoredArtifacts.values()).flat(),
    listTools() {
      return params.accessibleToolNames.flatMap((toolName) => {
        const tool = registry.get(toolName);
        if (!tool) return [];
        return [{
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }];
      });
    },
    tool(name: string, args: unknown) {
      return executeOperation({ kind: 'tool', toolName: name, args });
    },
    httpFetch(request) {
      return executeOperation({ kind: 'http', request });
    },
    workspaceCall(action, args) {
      return executeOperation({ kind: 'workspace', action, args });
    },
  };
}

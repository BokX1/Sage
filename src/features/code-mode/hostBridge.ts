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
} from './types';
import {
  deserializeArtifacts,
  loadCodeModeEffectLog,
  saveCodeModeEffectLog,
  type CodeModeTaskWorkspace,
} from './workspace';
import type { BridgeMethodSummary, BridgeNamespace } from './bridge/types';
import {
  FIXED_BRIDGE_CONTRACT,
  listBridgeMethodSummaries,
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

function buildApprovalPayload(params: {
  toolContext: ToolExecutionContext;
  effectIndex: number;
  effectLabel: string;
  executionId: string;
  taskId: string;
  requestHash: string;
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
    reviewSnapshotJson: {
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
        throw new ApprovalRequiredSignal(
          buildApprovalPayload({
            toolContext: params.toolContext,
            effectIndex: index,
            effectLabel: existing.label,
            executionId: params.executionId,
            taskId: params.workspace.taskId,
            requestHash,
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
        const parsedArgs = method.input.parse(operation.args);
        operationKind = method.namespace;
        label = `${method.namespace}.${method.method}`;
        mutability = method.mutability;
        approvalMode = method.approvalMode ?? 'none';
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
    listMethods: () => listBridgeMethodSummaries(),
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

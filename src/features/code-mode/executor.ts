import { fork } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolExecutionContext } from '../agent-runtime/runtimeToolContract';
import type {
  CodeModeApprovalExecutionPayload,
  CodeModeApprovalGrant,
  CodeModeExecutionRequest,
  CodeModeExecutionResult,
} from './types';
import { createHostBridgeSession } from './hostBridge';
import { ApprovalRequiredSignal } from '../agent-runtime/toolControlSignals';
import {
  getOrCreateCodeModeTaskWorkspace,
  loadCodeModeEffectLog,
  loadCodeModeExecutionSnapshot,
  saveCodeModeExecutionSnapshot,
  workspaceAppendText,
  workspaceDeletePath,
  workspaceList,
  workspaceReadText,
  workspaceSearch,
  workspaceWriteText,
} from './workspace';
import type { FixedBridgeContract } from './bridge/contract';

const DEFAULT_CODE_TIMEOUT_MS = 90_000;

type CodeModeChildRequestMessage =
  | {
      type: 'bridge.call';
      id: number;
      namespace:
        | 'discord'
        | 'history'
        | 'context'
        | 'artifacts'
        | 'approvals'
        | 'admin'
        | 'moderation'
        | 'schedule';
      method: string;
      args: unknown;
    }
  | {
      type: 'http.fetch';
      id: number;
      params: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        bodyText?: string;
      };
    }
  | { type: 'workspace'; id: number; action: string; args: Record<string, unknown> };

type CodeModeChildResponseMessage =
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string }
  | { type: 'final'; ok: true; result: unknown; stdout: string[]; stderr: string[] }
  | { type: 'final'; ok: false; error: string; stdout: string[]; stderr: string[] };

type CodeModeParentStartMessage = {
  type: 'start';
  code: string;
  timeoutMs: number;
};

function normalizeTaskId(ctx: ToolExecutionContext): string {
  return ctx.graphThreadId?.trim() || ctx.traceId;
}

function buildExecutionId(ctx: ToolExecutionContext, language: string): string {
  return `${normalizeTaskId(ctx)}:${language}:${randomUUID()}`;
}

function buildWorkspaceHandlers(workspace: Awaited<ReturnType<typeof getOrCreateCodeModeTaskWorkspace>>) {
  return {
    read: async (args: Record<string, unknown>) => {
      const relativePath = String(args.path ?? '');
      return {
        path: relativePath,
        content: await workspaceReadText(workspace, relativePath),
      };
    },
    write: async (args: Record<string, unknown>) => {
      const relativePath = String(args.path ?? '');
      const content = String(args.content ?? '');
      return {
        path: relativePath,
        ...(await workspaceWriteText(workspace, relativePath, content)),
      };
    },
    append: async (args: Record<string, unknown>) => {
      const relativePath = String(args.path ?? '');
      const content = String(args.content ?? '');
      return {
        path: relativePath,
        ...(await workspaceAppendText(workspace, relativePath, content)),
      };
    },
    list: async (args: Record<string, unknown>) => workspaceList(workspace, String(args.path ?? '.')),
    search: async (args: Record<string, unknown>) =>
      workspaceSearch(workspace, String(args.query ?? ''), String(args.path ?? '.')),
    delete: async (args: Record<string, unknown>) => workspaceDeletePath(workspace, String(args.path ?? '')),
  };
}

function shouldUseSourceChildRunner() {
  return __filename.endsWith('.ts');
}

function getChildRunnerPath() {
  return path.join(__dirname, shouldUseSourceChildRunner() ? 'jsRunnerChild.ts' : 'jsRunnerChild.js');
}

function getChildExecArgv(runnerPath: string): string[] {
  if (shouldUseSourceChildRunner()) {
    return ['--import', 'tsx'];
  }
  return ['--permission', `--allow-fs-read=${runnerPath}`, '--disable-proto=delete'];
}

function getChildEnv() {
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec', 'TEMP', 'TMP']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      safeEnv[key] = value;
    }
  }
  return safeEnv;
}

async function executeJavascript(params: {
  request: CodeModeExecutionRequest;
  session: Awaited<ReturnType<typeof createHostBridgeSession>>;
}): Promise<{ result: unknown; stdout: string[]; stderr: string[] }> {
  const runnerPath = getChildRunnerPath();
  const child = fork(runnerPath, [], {
    cwd: process.cwd(),
    env: getChildEnv(),
    execArgv: getChildExecArgv(runnerPath),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
  });

  return await new Promise<{ result: unknown; stdout: string[]; stderr: string[] }>((resolve, reject) => {
    let settled = false;
    const finalize = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(killTimer);
      child.removeAllListeners();
      callback();
    };

    const killTimer = setTimeout(() => {
      child.kill();
      finalize(() => reject(new Error('JavaScript Code Mode execution timed out.')));
    }, params.request.timeoutMs + 1_000);
    killTimer.unref?.();

    child.on('message', async (message: unknown) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      const typedMessage = message as CodeModeChildRequestMessage | CodeModeChildResponseMessage;
      try {
        if (typedMessage.type === 'bridge.call') {
          const result = await params.session.call(typedMessage.namespace, typedMessage.method, typedMessage.args);
          child.send({ type: 'response', id: typedMessage.id, ok: true, result } satisfies CodeModeChildResponseMessage);
          return;
        }
        if (typedMessage.type === 'http.fetch') {
          const result = await params.session.httpFetch(typedMessage.params);
          child.send({ type: 'response', id: typedMessage.id, ok: true, result } satisfies CodeModeChildResponseMessage);
          return;
        }
        if (typedMessage.type === 'workspace') {
          const result = await params.session.workspaceCall(typedMessage.action, typedMessage.args);
          child.send({ type: 'response', id: typedMessage.id, ok: true, result } satisfies CodeModeChildResponseMessage);
          return;
        }
        if (typedMessage.type === 'final') {
          child.kill();
          if (typedMessage.ok) {
            finalize(() => resolve({
              result: typedMessage.result,
              stdout: typedMessage.stdout,
              stderr: typedMessage.stderr,
            }));
          } else {
            finalize(() => reject(new Error(typedMessage.error)));
          }
        }
      } catch (error) {
        if (error instanceof ApprovalRequiredSignal) {
          child.kill();
          finalize(() => reject(error));
          return;
        }
        if ('id' in typedMessage && typeof typedMessage.id === 'number') {
          child.send({
            type: 'response',
            id: typedMessage.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies CodeModeChildResponseMessage);
          return;
        }
        child.kill();
        finalize(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });

    child.once('error', (error) => finalize(() => reject(error)));
    child.once('exit', (code, signal) => {
      if (!settled) {
        finalize(() =>
          reject(new Error(`Code Mode child process exited before completing execution (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)),
        );
      }
    });

    child.send({
      type: 'start',
      code: params.request.code,
      timeoutMs: params.request.timeoutMs,
    } satisfies CodeModeParentStartMessage);
  });
}

function collectBridgeArtifacts(
  session: Awaited<ReturnType<typeof createHostBridgeSession>>,
) {
  return session.artifacts;
}

export async function executeCodeMode(params: {
  language: 'javascript';
  code: string;
  toolContext: ToolExecutionContext;
  timeoutMs?: number;
  bridgeContract?: FixedBridgeContract;
  approvalGrant?: CodeModeApprovalGrant | null;
  executionId?: string;
}): Promise<CodeModeExecutionResult> {
  const taskId = normalizeTaskId(params.toolContext);
  const executionId = params.executionId ?? buildExecutionId(params.toolContext, params.language);
  const workspace = await getOrCreateCodeModeTaskWorkspace(taskId);

  const request: CodeModeExecutionRequest = {
    executionId,
    taskId,
    language: params.language,
    code: params.code,
    toolContext: params.toolContext,
    timeoutMs: params.timeoutMs ?? DEFAULT_CODE_TIMEOUT_MS,
    approvalGrant: params.approvalGrant,
  };

  await saveCodeModeExecutionSnapshot(workspace, {
    executionId,
    taskId,
    language: request.language,
    code: request.code,
    timeoutMs: request.timeoutMs,
    toolContext: request.toolContext,
    createdAtIso: new Date().toISOString(),
    updatedAtIso: new Date().toISOString(),
  });

  const session = await createHostBridgeSession({
    executionId,
    workspace,
    toolContext: request.toolContext,
    timeoutMs: request.timeoutMs,
    approvalGrant: request.approvalGrant,
    bridgeContract: params.bridgeContract,
    workspaceHandlers: buildWorkspaceHandlers(workspace),
  });

  const runner = await executeJavascript({ request, session });

  return {
    language: request.language,
    executionId,
    taskId,
    result: runner.result,
    stdout: runner.stdout,
    stderr: runner.stderr,
    bridgeCalls: session.bridgeCalls,
    artifacts: collectBridgeArtifacts(session),
    workspaceSummary: {
      taskId,
      relativeRoot: path.relative(process.cwd(), workspace.sandboxDir).replace(/\\/g, '/'),
    },
  };
}

export async function resumeApprovedCodeModeExecution(params: {
  payload: CodeModeApprovalExecutionPayload;
  approvedBy: string;
  bridgeContract?: FixedBridgeContract;
}): Promise<CodeModeExecutionResult> {
  const workspace = await getOrCreateCodeModeTaskWorkspace(params.payload.taskId);
  const snapshot = await loadCodeModeExecutionSnapshot(workspace, params.payload.executionId);
  if (!snapshot) {
    throw new Error(`Code Mode execution snapshot "${params.payload.executionId}" was not found.`);
  }
  const requestHash =
    params.payload.requestHash ??
    (await loadCodeModeEffectLog(workspace, params.payload.executionId))[params.payload.effectIndex]?.requestHash;
  if (!requestHash) {
    throw new Error(
      `Code Mode approval replay for effect #${params.payload.effectIndex} is missing the original request hash.`,
    );
  }

  return executeCodeMode({
    language: snapshot.language,
    code: snapshot.code,
    timeoutMs: snapshot.timeoutMs,
    executionId: snapshot.executionId,
    toolContext: {
      ...snapshot.toolContext,
      approvalResume: {
        requestId: params.payload.executionId,
        decision: 'approved',
        reviewerId: params.approvedBy,
      },
    },
    approvalGrant: {
      requestId: params.payload.executionId,
      effectIndex: params.payload.effectIndex,
      requestHash,
      reviewerId: params.approvedBy,
    },
    bridgeContract: params.bridgeContract,
  });
}

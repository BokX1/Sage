import vm from 'node:vm';
import type { BridgeNamespace } from './bridge/types';

type ParentToChildMessage = {
  type: 'start';
  code: string;
  timeoutMs: number;
};

type ChildToParentMessage =
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
  | { type: 'workspace'; id: number; action: string; args: Record<string, unknown> }
  | { type: 'final'; ok: true; result: unknown; stdout: string[]; stderr: string[] }
  | { type: 'final'; ok: false; error: string; stdout: string[]; stderr: string[] };

type ParentResponseMessage =
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string };

type ParentCallMessage =
  | Extract<ChildToParentMessage, { type: 'bridge.call' }>
  | Extract<ChildToParentMessage, { type: 'http.fetch' }>
  | Extract<ChildToParentMessage, { type: 'workspace' }>;

let nextRequestId = 1;

function sendMessage(message: ChildToParentMessage) {
  if (typeof process.send !== 'function') {
    throw new Error('Code Mode child bridge is unavailable.');
  }
  process.send(message);
}

async function callParent(
  message: ParentCallMessage,
) {
  const id = nextRequestId++;
  return await new Promise<unknown>((resolve, reject) => {
    const onMessage = (incoming: unknown) => {
      const typed = incoming as ParentResponseMessage;
      if (!typed || typed.type !== 'response' || typed.id !== id) {
        return;
      }
      process.off('message', onMessage);
      if (typed.ok) {
        resolve(typed.result);
      } else {
        reject(new Error(typed.error));
      }
    };

    process.on('message', onMessage);
    sendMessage({ ...message, id } as ChildToParentMessage);
  });
}

function createBridgeNamespace(namespace: BridgeNamespace, methods: string[]) {
  return Object.freeze(
    Object.fromEntries(
      methods.map((method) => [
        method.split('.').slice(-1)[0]!,
        (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace, method, args }),
      ]),
    ),
  );
}

function createDiscordBridge() {
  return Object.freeze({
    channels: createBridgeNamespace('discord', ['channels.get', 'channels.list']),
    messages: createBridgeNamespace('discord', ['messages.send', 'messages.reply']),
    reactions: createBridgeNamespace('discord', ['reactions.add']),
    members: createBridgeNamespace('discord', ['members.get']),
    roles: createBridgeNamespace('discord', ['roles.add', 'roles.remove']),
  });
}

function createNestedBridge() {
  return Object.freeze({
    summary: createBridgeNamespace('context', ['summary.get']),
    profile: createBridgeNamespace('context', ['profile.get']),
  });
}

function createArtifactsBridge() {
  return Object.freeze({
    list: (args?: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'artifacts', method: 'list', args }),
    get: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'artifacts', method: 'get', args }),
    create: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'artifacts', method: 'create', args }),
    update: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'artifacts', method: 'update', args }),
    publish: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'artifacts', method: 'publish', args }),
  });
}

function createApprovalsBridge() {
  return Object.freeze({
    get: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'approvals', method: 'get', args }),
    list: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'approvals', method: 'list', args }),
  });
}

function createAdminBridge() {
  return Object.freeze({
    instructions: createBridgeNamespace('admin', ['instructions.get', 'instructions.update']),
    runtime: createBridgeNamespace('admin', ['runtime.getCapabilities']),
  });
}

function createModerationBridge() {
  return Object.freeze({
    cases: createBridgeNamespace('moderation', ['cases.list', 'cases.get', 'cases.acknowledge', 'cases.resolve']),
    notes: createBridgeNamespace('moderation', ['notes.create']),
  });
}

function createScheduleBridge() {
  return Object.freeze({
    jobs: createBridgeNamespace('schedule', ['jobs.list', 'jobs.create', 'jobs.cancel', 'jobs.run', 'jobs.runs']),
  });
}

function createHistoryBridge() {
  return Object.freeze({
    get: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'history', method: 'get', args }),
    recent: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'history', method: 'recent', args }),
    search: (args: unknown) => callParent({ type: 'bridge.call', id: 0, namespace: 'history', method: 'search', args }),
  });
}

function createHttpBridge() {
  return Object.freeze({
    fetch: (params: { url: string; method?: string; headers?: Record<string, string>; bodyText?: string }) =>
      callParent({ type: 'http.fetch', id: 0, params }),
  });
}

function createWorkspaceBridge() {
  return Object.freeze({
    read: (path: string) => callParent({ type: 'workspace', id: 0, action: 'read', args: { path } }),
    write: (params: { path: string; content: string }) =>
      callParent({ type: 'workspace', id: 0, action: 'write', args: params }),
    append: (params: { path: string; content: string }) =>
      callParent({ type: 'workspace', id: 0, action: 'append', args: params }),
    list: (path = '.') => callParent({ type: 'workspace', id: 0, action: 'list', args: { path } }),
    search: (params: { query: string; path?: string }) =>
      callParent({ type: 'workspace', id: 0, action: 'search', args: { path: params.path ?? '.', query: params.query } }),
    delete: (path: string) => callParent({ type: 'workspace', id: 0, action: 'delete', args: { path } }),
  });
}

async function runCode(code: string, timeoutMs: number) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sandbox = {
    discord: createDiscordBridge(),
    history: createHistoryBridge(),
    context: createNestedBridge(),
    artifacts: createArtifactsBridge(),
    approvals: createApprovalsBridge(),
    admin: createAdminBridge(),
    moderation: createModerationBridge(),
    schedule: createScheduleBridge(),
    http: createHttpBridge(),
    workspace: createWorkspaceBridge(),
    console: {
      log: (...values: unknown[]) => stdout.push(values.map((value) => String(value)).join(' ')),
      error: (...values: unknown[]) => stderr.push(values.map((value) => String(value)).join(' ')),
    },
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
  };

  const context = vm.createContext(sandbox, {
    name: 'sage-code-mode-js-child',
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });
  const script = new vm.Script(
    `
      (async () => {
        ${code}
      })()
    `,
    {
      filename: 'sage-code-mode.js',
    },
  );
  const execution = script.runInContext(context, { timeout: timeoutMs });
  const result = await Promise.race([
    Promise.resolve(execution),
    new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('JavaScript Code Mode execution timed out.')), timeoutMs);
      timeout.unref?.();
    }),
  ]);

  return { result, stdout, stderr };
}

process.once('message', async (message: unknown) => {
  const startMessage = message as ParentToChildMessage;
  if (!startMessage || startMessage.type !== 'start') {
    sendMessage({
      type: 'final',
      ok: false,
      error: 'Code Mode child did not receive a valid start message.',
      stdout: [],
      stderr: [],
    });
    return;
  }

  try {
    const result = await runCode(startMessage.code, startMessage.timeoutMs);
    sendMessage({ type: 'final', ok: true, result: result.result, stdout: result.stdout, stderr: result.stderr });
  } catch (error) {
    sendMessage({
      type: 'final',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stdout: [],
      stderr: [],
    });
  }
});

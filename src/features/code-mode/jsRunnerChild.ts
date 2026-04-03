import vm from 'node:vm';
import type { BridgeMethodSummary, BridgeNamespace, InjectedBridgeNamespace } from './bridge/types';

type ParentToChildMessage = {
  type: 'start';
  code: string;
  timeoutMs: number;
  methods: BridgeMethodSummary[];
};

type ChildToParentMessage =
  | {
      type: 'bridge.call';
      id: number;
      namespace: BridgeNamespace;
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

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    freezeDeep(nested);
  }
  return Object.freeze(value);
}

function createMethodInvoker(summary: BridgeMethodSummary) {
  if (summary.namespace === 'http' && summary.method === 'fetch') {
    return (params: { url: string; method?: string; headers?: Record<string, string>; bodyText?: string }) =>
      callParent({ type: 'http.fetch', id: 0, params });
  }
  if (summary.namespace === 'workspace') {
    return (args?: unknown) => {
      switch (summary.method) {
        case 'read':
        case 'delete':
          return callParent({
            type: 'workspace',
            id: 0,
            action: summary.method,
            args: { path: String(args ?? '') },
          });
        case 'list':
          return callParent({
            type: 'workspace',
            id: 0,
            action: summary.method,
            args: args === undefined ? {} : { path: String(args) },
          });
        default:
          return callParent({
            type: 'workspace',
            id: 0,
            action: summary.method,
            args: (args ?? {}) as Record<string, unknown>,
          });
      }
    };
  }
  return (args?: unknown) =>
    callParent({
      type: 'bridge.call',
      id: 0,
      namespace: summary.namespace as BridgeNamespace,
      method: summary.method,
      args: args ?? {},
    });
}

function buildBridgeGlobals(methods: BridgeMethodSummary[]) {
  const globals: Partial<Record<InjectedBridgeNamespace, Record<string, unknown>>> = {};
  for (const summary of methods) {
    const namespaceRoot = (globals[summary.namespace] ??= {});
    const segments = summary.method.split('.');
    const leaf = segments.pop();
    if (!leaf) {
      continue;
    }
    let cursor: Record<string, unknown> = namespaceRoot;
    for (const segment of segments) {
      const next = cursor[segment];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[leaf] = createMethodInvoker(summary);
  }
  return freezeDeep(globals);
}

async function runCode(code: string, timeoutMs: number, methods: BridgeMethodSummary[]) {
  const bridgeGlobals = buildBridgeGlobals(methods);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sandbox = {
    ...bridgeGlobals,
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
    const result = await runCode(startMessage.code, startMessage.timeoutMs, startMessage.methods);
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

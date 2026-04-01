import vm from 'node:vm';

type ParentToChildMessage = {
  type: 'start';
  code: string;
  timeoutMs: number;
};

type ChildToParentMessage =
  | { type: 'tool'; id: number; name: string; args: unknown }
  | { type: 'tools.list'; id: number }
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

type ParentResponseMessage = { type: 'response'; id: number; ok: true; result: unknown } | { type: 'response'; id: number; ok: false; error: string };

let nextRequestId = 1;

function sendMessage(message: ChildToParentMessage) {
  if (typeof process.send !== 'function') {
    throw new Error('Code Mode child bridge is unavailable.');
  }
  process.send(message);
}

async function callParent(message: Exclude<ChildToParentMessage, { type: 'final'; ok: true; result: unknown; stdout: string[]; stderr: string[] } | { type: 'final'; ok: false; error: string; stdout: string[]; stderr: string[] }>) {
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

function createSageBridge() {
  return {
    tool: (name: string, args: unknown) => callParent({ type: 'tool', name, args, id: 0 }),
    tools: {
      list: () => callParent({ type: 'tools.list', id: 0 }),
    },
    http: {
      fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; bodyText?: string }) =>
        callParent({
          type: 'http.fetch',
          id: 0,
          params: {
            url,
            method: options?.method,
            headers: options?.headers,
            bodyText: options?.bodyText,
          },
        }),
    },
    workspace: {
      read: (filePath: string) => callParent({ type: 'workspace', id: 0, action: 'read', args: { path: filePath } }),
      write: (filePath: string, content: string) =>
        callParent({ type: 'workspace', id: 0, action: 'write', args: { path: filePath, content } }),
      append: (filePath: string, content: string) =>
        callParent({ type: 'workspace', id: 0, action: 'append', args: { path: filePath, content } }),
      list: (filePath = '.') => callParent({ type: 'workspace', id: 0, action: 'list', args: { path: filePath } }),
      search: (query: string, filePath = '.') =>
        callParent({ type: 'workspace', id: 0, action: 'search', args: { query, path: filePath } }),
      delete: (filePath: string) => callParent({ type: 'workspace', id: 0, action: 'delete', args: { path: filePath } }),
    },
  };
}

async function runCode(code: string, timeoutMs: number) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sandbox = {
    sage: createSageBridge(),
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
    sendMessage({ type: 'final', ok: false, error: 'Code Mode child did not receive a valid start message.', stdout: [], stderr: [] });
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

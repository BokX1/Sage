import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as dns from 'node:dns/promises';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as hostBridge from '../../../../src/features/code-mode/hostBridge';
import { getOrCreateCodeModeTaskWorkspace } from '../../../../src/features/code-mode/workspace';
import type { ToolExecutionContext } from '../../../../src/features/agent-runtime/runtimeToolContract';

function makeToolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    traceId: 'trace-bridge',
    graphThreadId: 'thread-bridge',
    userId: 'user-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    currentTurn: {
      invokerUserId: 'user-1',
      invokerDisplayName: 'User One',
      messageId: 'message-1',
      guildId: 'guild-1',
      originChannelId: 'channel-1',
      responseChannelId: 'channel-1',
      invokedBy: 'mention',
      mentionedUserIds: [],
      isDirectReply: false,
      replyTargetMessageId: null,
      replyTargetAuthorId: null,
      botUserId: 'sage-bot',
    },
    activeToolNames: [],
    ...overrides,
  };
}

async function cleanupWorkspace(taskId = 'thread-bridge') {
  const workspace = await getOrCreateCodeModeTaskWorkspace(taskId);
  await fs.rm(workspace.rootDir, { recursive: true, force: true });
}

async function createSession() {
  const workspace = await getOrCreateCodeModeTaskWorkspace('thread-bridge');
  return hostBridge.createHostBridgeSession({
    executionId: 'execution-1',
    workspace,
    toolContext: makeToolContext(),
    timeoutMs: 5_000,
    workspaceHandlers: {
      read: async () => ({}),
      write: async () => ({}),
      append: async () => ({}),
      list: async () => ([]),
      search: async () => ([]),
      delete: async () => ({}),
    },
  });
}

async function createSessionWithContext(overrides: Partial<ToolExecutionContext> = {}) {
  const workspace = await getOrCreateCodeModeTaskWorkspace('thread-bridge');
  return hostBridge.createHostBridgeSession({
    executionId: 'execution-1',
    workspace,
    toolContext: makeToolContext(overrides),
    timeoutMs: 5_000,
    workspaceHandlers: {
      read: async () => ({}),
      write: async () => ({}),
      append: async () => ({}),
      list: async () => ([]),
      search: async () => ([]),
      delete: async () => ({}),
    },
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupWorkspace();
});

describe('Code Mode host bridge http.fetch', () => {
  it('blocks hostnames that resolve to private or local addresses', async () => {
    const session = await createSession();
    vi.mocked(dns.lookup).mockImplementation(async () => [{ address: '127.0.0.1', family: 4 }] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(session.httpFetch({ url: 'https://example.com/internal' })).rejects.toThrow(
      'resolve to local or private network addresses',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables automatic redirects so every hop is revalidated by the bridge', async () => {
    const session = await createSession();
    vi.mocked(dns.lookup).mockImplementation(async () => [{ address: '93.184.216.34', family: 4 }] as never);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('', {
        status: 302,
        headers: {
          location: 'http://127.0.0.1/private',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await session.httpFetch({ url: 'https://example.com/redirect-me' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 302,
        headers: expect.objectContaining({
          location: 'http://127.0.0.1/private',
        }),
      }),
    );
  });
});

describe('Code Mode host bridge admin.runtime.getCapabilities', () => {
  it('filters reported methods down to the current actor authority', async () => {
    const session = await createSessionWithContext({ invokerAuthority: 'member' });

    const result = await session.call('admin', 'runtime.getCapabilities', {});

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'capabilities',
        namespaces: expect.arrayContaining(['discord', 'history', 'http', 'workspace']),
        methods: expect.arrayContaining([
          expect.objectContaining({
            key: 'discord.channels.get',
            access: 'public',
            summary: expect.any(String),
            requiredArgs: ['channelId'],
            optionalArgs: [],
          }),
          expect.objectContaining({
            key: 'history.search',
            access: 'public',
            requiredArgs: ['query'],
            optionalArgs: expect.arrayContaining(['channelId', 'limit']),
          }),
          expect.objectContaining({
            key: 'http.fetch',
            access: 'public',
            requiredArgs: ['url'],
          }),
          expect.objectContaining({
            key: 'workspace.write',
            approvalMode: 'required',
            requiredArgs: ['path', 'content'],
          }),
        ]),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        namespaces: expect.not.arrayContaining(['approvals']),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        methods: expect.not.arrayContaining([
          expect.objectContaining({ key: 'discord.members.get' }),
          expect.objectContaining({ key: 'discord.roles.add' }),
          expect.objectContaining({ key: 'moderation.cases.resolve' }),
        ]),
      }),
    );
  });

  it('includes admin and moderator methods when the current actor has authority', async () => {
    const session = await createSessionWithContext({ invokerAuthority: 'admin' });

    const result = await session.call('admin', 'runtime.getCapabilities', {});

    expect(result).toEqual(
      expect.objectContaining({
        namespaces: expect.arrayContaining(['admin', 'approvals', 'moderation']),
        methods: expect.arrayContaining([
          expect.objectContaining({ key: 'discord.members.get', access: 'admin' }),
          expect.objectContaining({ key: 'discord.threads.create', access: 'admin' }),
          expect.objectContaining({ key: 'discord.roles.add', access: 'admin' }),
          expect.objectContaining({ key: 'moderation.cases.resolve', access: 'moderator' }),
          expect.objectContaining({ key: 'schedule.jobs.pause', access: 'admin' }),
        ]),
      }),
    );
  });

  it('surfaces underlying network error details for http.fetch failures', async () => {
    const session = await createSession();
    vi.mocked(dns.lookup).mockImplementation(async () => [{ address: '93.184.216.34', family: 4 }] as never);
    const rootCause = Object.assign(new Error('unable to get local issuer certificate'), {
      code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    });
    const fetchError = new Error('fetch failed', { cause: rootCause });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(fetchError));

    await expect(session.httpFetch({ url: 'https://example.com/' })).rejects.toThrow(
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as dns from 'node:dns/promises';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import * as hostBridge from '../../../../src/features/code-mode/hostBridge';
import { getOrCreateCodeModeTaskWorkspace } from '../../../../src/features/code-mode/workspace';
import type { ToolExecutionContext } from '../../../../src/features/agent-runtime/toolRegistry';

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
    accessibleToolNames: [],
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

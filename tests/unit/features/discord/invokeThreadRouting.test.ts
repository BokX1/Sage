import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';

const mocks = vi.hoisted(() => ({
  clientFetch: vi.fn(),
  findLatestTaskRunBySourceMessageId: vi.fn(),
  getGuildChannelInvokePolicy: vi.fn(),
}));

vi.mock('@/platform/discord/client', () => ({
  client: {
    channels: {
      fetch: mocks.clientFetch,
    },
  },
}));

vi.mock('@/features/agent-runtime/agentTaskRunRepo', () => ({
  findLatestTaskRunBySourceMessageId: mocks.findLatestTaskRunBySourceMessageId,
}));

vi.mock('@/features/settings/guildChannelInvokePolicyRepo', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/settings/guildChannelInvokePolicyRepo')
  >();
  return {
    ...actual,
    getGuildChannelInvokePolicy: mocks.getGuildChannelInvokePolicy,
  };
});

import { resolveInvokeResponseSurface } from '@/features/discord/invokeThreadRouting';

describe('invokeThreadRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientFetch.mockResolvedValue(null);
    mocks.findLatestTaskRunBySourceMessageId.mockResolvedValue(null);
    mocks.getGuildChannelInvokePolicy.mockResolvedValue(null);
  });

  it('only reuses persisted task threads for running or waiting-user-input tasks', async () => {
    const channel = {
      id: 'channel-parent',
      type: ChannelType.GuildText,
      sendTyping: vi.fn(),
      send: vi.fn(),
    };
    const message = {
      id: 'message-1',
      guildId: 'guild-1',
      channelId: 'channel-parent',
      channel,
      author: { id: 'user-1' },
      reference: { messageId: 'parent-source-message' },
      thread: null,
      hasThread: false,
      startThread: vi.fn(),
    } as const;

    await resolveInvokeResponseSurface({
      message: message as never,
      invokeText: 'sage continue this',
    });

    expect(mocks.findLatestTaskRunBySourceMessageId).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['running', 'waiting_user_input'],
      }),
    );
  });
});

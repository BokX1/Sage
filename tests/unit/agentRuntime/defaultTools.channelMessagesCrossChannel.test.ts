import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearchChannelMessages, mockLookupChannelMessage } = vi.hoisted(() => ({
  mockSearchChannelMessages: vi.fn(),
  mockLookupChannelMessage: vi.fn(),
}));

vi.mock('../../../src/core/agentRuntime/toolIntegrations', () => ({
  searchChannelMessages: mockSearchChannelMessages,
  lookupChannelMessage: mockLookupChannelMessage,
}));

import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../src/core/agentRuntime/defaultTools';

describe('default tools cross-channel message history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchChannelMessages.mockResolvedValue({ ok: true });
    mockLookupChannelMessage.mockResolvedValue({ ok: true });
  });

  it('passes channelId through for discord_search_channel_messages', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_search_channel_messages',
        args: { think: 'search other channel', channelId: 'channel-2', query: 'hello world' },
      },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        invokedBy: 'mention',
      },
    );

    expect(result.success).toBe(true);
    expect(mockSearchChannelMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-2',
        requesterUserId: 'user-1',
        query: 'hello world',
      }),
    );
  });

  it('blocks cross-channel discord_search_channel_messages in autopilot turns', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_search_channel_messages',
        args: { think: 'autopilot should block', channelId: 'channel-2', query: 'hello world' },
      },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        invokedBy: 'autopilot',
      },
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('execution');
    expect(result.error).toContain('autopilot');
    expect(mockSearchChannelMessages).not.toHaveBeenCalled();
  });

  it('passes channelId through for discord_get_channel_message', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_get_channel_message',
        args: { think: 'lookup other channel message', channelId: 'channel-2', messageId: 'msg-123' },
      },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        invokedBy: 'mention',
      },
    );

    expect(result.success).toBe(true);
    expect(mockLookupChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-2',
        requesterUserId: 'user-1',
        messageId: 'msg-123',
      }),
    );
  });

  it('blocks cross-channel discord_get_channel_message in autopilot turns', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_get_channel_message',
        args: { think: 'autopilot should block', channelId: 'channel-2', messageId: 'msg-123' },
      },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        invokedBy: 'autopilot',
      },
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('execution');
    expect(result.error).toContain('autopilot');
    expect(mockLookupChannelMessage).not.toHaveBeenCalled();
  });
});


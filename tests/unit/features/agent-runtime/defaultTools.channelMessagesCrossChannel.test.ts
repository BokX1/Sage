import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearchChannelMessages, mockLookupChannelMessage } = vi.hoisted(() => ({
  mockSearchChannelMessages: vi.fn(),
  mockLookupChannelMessage: vi.fn(),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  searchChannelMessages: mockSearchChannelMessages,
  lookupChannelMessage: mockLookupChannelMessage,
}));

import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

describe('default tools cross-channel message history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchChannelMessages.mockResolvedValue({ ok: true });
    mockLookupChannelMessage.mockResolvedValue({ ok: true });
  });

  it('passes channelId through for messages.search_history', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord',
        args: {
          think: 'search other channel',
          action: 'messages.search_history',
          channelId: 'channel-2',
          query: 'hello world',
        },
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

  it('blocks cross-channel messages.search_history in autopilot turns', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord',
        args: {
          think: 'autopilot should block',
          action: 'messages.search_history',
          channelId: 'channel-2',
          query: 'hello world',
        },
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

  it('passes channelId through for messages.get_context', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord',
        args: {
          think: 'lookup other channel message',
          action: 'messages.get_context',
          channelId: 'channel-2',
          messageId: 'msg-123',
        },
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

  it('blocks cross-channel messages.get_context in autopilot turns', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord',
        args: {
          think: 'autopilot should block',
          action: 'messages.get_context',
          channelId: 'channel-2',
          messageId: 'msg-123',
        },
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

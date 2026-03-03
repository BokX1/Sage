import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChannelMessage } from '@/core/awareness/awareness-types';

const mockConfig = vi.hoisted(() => ({
  RAW_MESSAGE_TTL_DAYS: 1,
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: 2,
}));

vi.mock('@/config', () => ({
  config: mockConfig,
}));

import {
  appendMessage,
  clearChannel,
  getRecentMessages,
} from '@/core/awareness/channelRingBuffer';

const baseMessage = {
  guildId: 'guild-1',
  channelId: 'channel-1',
  authorId: 'author-1',
  authorDisplayName: 'Author',
  authorIsBot: false,
  content: 'hello',
  replyToMessageId: undefined,
  mentionsUserIds: [],
  mentionsBot: false,
};

let messageCounter = 0;

function buildMessage(overrides: Partial<ChannelMessage>): ChannelMessage {
  messageCounter += 1;
  return {
    messageId: `msg-${messageCounter}`,
    timestamp: new Date(),
    ...baseMessage,
    ...overrides,
  };
}

describe('channelRingBuffer', () => {
  beforeEach(() => {
    clearChannel({ guildId: 'guild-1', channelId: 'channel-1' });
    mockConfig.RAW_MESSAGE_TTL_DAYS = 1;
    mockConfig.RING_BUFFER_MAX_MESSAGES_PER_CHANNEL = 2;
    messageCounter = 0;
  });

  it('prunes messages older than TTL', () => {
    appendMessage(
      buildMessage({
        messageId: 'old',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      }),
    );
    appendMessage(buildMessage({ messageId: 'new' }));

    const recent = getRecentMessages({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 10,
    });

    expect(recent).toHaveLength(1);
    expect(recent[0].messageId).toBe('new');
  });

  it('caps messages by max size per channel', () => {
    appendMessage(buildMessage({ messageId: 'one' }));
    appendMessage(buildMessage({ messageId: 'two' }));
    appendMessage(buildMessage({ messageId: 'three' }));

    const recent = getRecentMessages({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 10,
    });

    expect(recent).toHaveLength(2);
    expect(recent.map((msg) => msg.messageId)).toEqual(['two', 'three']);
  });

  it('treats negative max-size config as zero instead of looping indefinitely', () => {
    mockConfig.RING_BUFFER_MAX_MESSAGES_PER_CHANNEL = -1;

    appendMessage(buildMessage({ messageId: 'one' }));
    appendMessage(buildMessage({ messageId: 'two' }));

    const recent = getRecentMessages({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 10,
    });

    expect(recent).toEqual([]);
  });

  it('returns empty results for non-positive limits', () => {
    appendMessage(buildMessage({ messageId: 'one' }));

    const recent = getRecentMessages({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: 0,
    });

    expect(recent).toEqual([]);
  });
});

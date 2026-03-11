import { describe, expect, it } from 'vitest';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

import {
  describeContinuityPolicy,
  extractTextFromMessageContent,
  selectFocusedContinuityMessages,
} from '@/features/agent-runtime/continuityContext';

function makeCurrentTurn(overrides: Partial<CurrentTurnContext> = {}): CurrentTurnContext {
  return {
    invokerUserId: 'user-1',
    invokerDisplayName: 'User One',
    messageId: 'msg-current',
    guildId: 'guild-1',
    channelId: 'channel-1',
    invokedBy: 'mention',
    mentionedUserIds: [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: 'sage-bot',
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'msg-default',
    guildId: 'guild-1',
    channelId: 'channel-1',
    authorId: 'user-1',
    authorDisplayName: 'User One',
    authorIsBot: false,
    timestamp: new Date('2026-03-11T00:00:00.000Z'),
    content: 'default content',
    replyToMessageId: undefined,
    mentionsUserIds: [],
    mentionsBot: false,
    ...overrides,
  };
}

describe('continuityContext', () => {
  it('describes continuity precedence by invocation kind', () => {
    expect(describeContinuityPolicy('reply')).toBe(
      'reply_target > same_speaker_recent > explicit_named_subject > ambient_room',
    );
    expect(describeContinuityPolicy('mention')).toBe(
      'current_user_input > same_speaker_recent > explicit_named_subject > ambient_room',
    );
    expect(describeContinuityPolicy('component')).toBe(
      'component_payload > current_invoker_context > explicit_named_subject > ambient_room',
    );
  });

  it('extracts only text parts from multimodal reply target content', () => {
    const extracted = extractTextFromMessageContent([
      { type: 'text', text: 'First line' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      { type: 'text', text: 'Second line' },
    ]);

    expect(extracted).toBe('First line\nSecond line');
  });

  it('selects same-speaker context without merging unrelated busy-room chatter', () => {
    const messages = [
      makeMessage({
        messageId: 'msg-u1-1',
        content: 'first request from the invoker',
      }),
      makeMessage({
        messageId: 'msg-u2-1',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'parallel conversation from another user',
      }),
      makeMessage({
        messageId: 'msg-u1-2',
        content: 'follow-up from the invoker',
      }),
      makeMessage({
        messageId: 'msg-u3-1',
        authorId: 'user-3',
        authorDisplayName: 'User Three',
        content: 'completely separate topic',
      }),
    ];

    const selected = selectFocusedContinuityMessages({
      messages,
      currentTurn: makeCurrentTurn(),
    });

    expect(selected.map((message) => message.messageId)).toEqual(['msg-u1-1', 'msg-u1-2']);
  });

  it('adds local reply-chain neighbors while excluding sibling replies to the shared parent', () => {
    const messages = [
      makeMessage({
        messageId: 'msg-parent',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'original request',
      }),
      makeMessage({
        messageId: 'msg-reply-target',
        authorId: 'sage-bot',
        authorDisplayName: 'Sage',
        authorIsBot: true,
        content: 'approval accepted',
        replyToMessageId: 'msg-parent',
      }),
      makeMessage({
        messageId: 'msg-sibling',
        authorId: 'user-3',
        authorDisplayName: 'User Three',
        content: 'I am replying to the original parent too',
        replyToMessageId: 'msg-parent',
      }),
      makeMessage({
        messageId: 'msg-neighbor-older',
        content: 'sounds good, let us try it',
        replyToMessageId: 'msg-reply-target',
      }),
      makeMessage({
        messageId: 'msg-neighbor-newer',
        authorId: 'user-4',
        authorDisplayName: 'User Four',
        content: 'latest direct reply to the reply target',
        replyToMessageId: 'msg-reply-target',
      }),
      makeMessage({
        messageId: 'msg-unrelated',
        authorId: 'user-3',
        authorDisplayName: 'User Three',
        content: 'heiryn memory question',
      }),
    ];

    const selected = selectFocusedContinuityMessages({
      messages,
      currentTurn: makeCurrentTurn({
        invokedBy: 'reply',
        isDirectReply: true,
        replyTargetMessageId: 'msg-reply-target',
        replyTargetAuthorId: 'sage-bot',
      }),
      replyTarget: {
        messageId: 'msg-reply-target',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'sage-bot',
        authorDisplayName: 'Sage',
        authorIsBot: true,
        replyToMessageId: 'msg-parent',
        mentionedUserIds: [],
        content: 'approval accepted',
      },
      excludedMessageIds: ['msg-reply-target'],
    });

    expect(selected.map((message) => message.messageId)).toEqual([
      'msg-parent',
      'msg-neighbor-older',
      'msg-neighbor-newer',
    ]);
    expect(selected.map((message) => message.messageId)).not.toContain('msg-reply-target');
    expect(selected.map((message) => message.messageId)).not.toContain('msg-sibling');
    expect(selected.map((message) => message.messageId)).not.toContain('msg-unrelated');
  });

  it('prefers the newest direct reply neighbors when the local chain exceeds the cap', () => {
    const messages = [
      makeMessage({
        messageId: 'msg-parent',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'original request',
      }),
      makeMessage({
        messageId: 'msg-reply-target',
        authorId: 'sage-bot',
        authorDisplayName: 'Sage',
        authorIsBot: true,
        content: 'approval accepted',
        replyToMessageId: 'msg-parent',
      }),
      makeMessage({
        messageId: 'msg-child-1',
        content: 'oldest child',
        replyToMessageId: 'msg-reply-target',
      }),
      makeMessage({
        messageId: 'msg-child-2',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'second child',
        replyToMessageId: 'msg-reply-target',
      }),
      makeMessage({
        messageId: 'msg-child-3',
        authorId: 'user-3',
        authorDisplayName: 'User Three',
        content: 'third child',
        replyToMessageId: 'msg-reply-target',
      }),
      makeMessage({
        messageId: 'msg-child-4',
        authorId: 'user-4',
        authorDisplayName: 'User Four',
        content: 'fourth child',
        replyToMessageId: 'msg-reply-target',
      }),
      makeMessage({
        messageId: 'msg-child-5',
        authorId: 'user-5',
        authorDisplayName: 'User Five',
        content: 'newest child',
        replyToMessageId: 'msg-reply-target',
      }),
    ];

    const selected = selectFocusedContinuityMessages({
      messages,
      currentTurn: makeCurrentTurn({
        invokedBy: 'reply',
        isDirectReply: true,
        replyTargetMessageId: 'msg-reply-target',
        replyTargetAuthorId: 'sage-bot',
      }),
      replyTarget: {
        messageId: 'msg-reply-target',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'sage-bot',
        authorDisplayName: 'Sage',
        authorIsBot: true,
        replyToMessageId: 'msg-parent',
        mentionedUserIds: [],
        content: 'approval accepted',
      },
      excludedMessageIds: ['msg-reply-target'],
      maxSameSpeakerMessages: 0,
      maxReplyNeighborMessages: 4,
    });

    expect(selected.map((message) => message.messageId)).toEqual([
      'msg-parent',
      'msg-child-2',
      'msg-child-3',
      'msg-child-4',
      'msg-child-5',
    ]);
    expect(selected.map((message) => message.messageId)).not.toContain('msg-child-1');
  });
});

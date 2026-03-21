import { describe, expect, it, vi } from 'vitest';

import { reconcileResponseSessionChunks } from '@/features/discord/responseSessionChunkDelivery';

function createEditableMessage(id: string) {
  let childCounter = 0;
  const message = {
    id,
    content: '',
    edit: vi.fn().mockImplementation(async (payload: { content?: string }) => {
      if (typeof payload?.content === 'string') {
        message.content = payload.content;
      }
      return message;
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockImplementation(async (payload: { content?: string }) => {
      childCounter += 1;
      const child = createEditableMessage(`${id}-child-${childCounter}`);
      if (typeof payload?.content === 'string') {
        child.content = payload.content;
      }
      return child;
    }),
  };
  return message;
}

describe('responseSessionChunkDelivery', () => {
  it('keeps overflow chunks anchored to each response session during concurrent long replies', async () => {
    const sharedChannel = {
      send: vi.fn(),
      messages: {
        fetch: vi.fn(),
      },
    };
    const anchorA = createEditableMessage('primary-a');
    const anchorB = createEditableMessage('primary-b');
    const longText = `${'A'.repeat(2_000)}${'B'.repeat(2_000)}${'C'.repeat(200)}`;

    const [resultA, resultB] = await Promise.all([
      reconcileResponseSessionChunks({
        channel: sharedChannel,
        nextText: longText,
        state: {
          primaryMessage: null,
          replyAnchor: anchorA,
          overflowMessageIds: [],
          overflowMessages: [],
        },
        allowedMentions: { repliedUser: false },
      }),
      reconcileResponseSessionChunks({
        channel: sharedChannel,
        nextText: longText,
        state: {
          primaryMessage: null,
          replyAnchor: anchorB,
          overflowMessageIds: [],
          overflowMessages: [],
        },
        allowedMentions: { repliedUser: false },
      }),
    ]);

    const overflowA = await anchorA.reply.mock.results[0]?.value;
    const overflowB = await anchorB.reply.mock.results[0]?.value;

    expect(sharedChannel.send).not.toHaveBeenCalled();
    expect(anchorA.reply).toHaveBeenCalledTimes(1);
    expect(anchorB.reply).toHaveBeenCalledTimes(1);
    expect(overflowA.reply).toHaveBeenCalledTimes(1);
    expect(overflowB.reply).toHaveBeenCalledTimes(1);
    expect(resultA.overflowMessageIds).toEqual([
      'primary-a-child-1-child-1',
      'primary-a-child-1-child-1-child-1',
    ]);
    expect(resultB.overflowMessageIds).toEqual([
      'primary-b-child-1-child-1',
      'primary-b-child-1-child-1-child-1',
    ]);
  });
});

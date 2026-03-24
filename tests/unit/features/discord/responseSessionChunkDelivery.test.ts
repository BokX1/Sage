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

function createComponentsV2EditError() {
  return {
    code: 50035,
    message:
      "Invalid Form Body\ncontent[MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2]: The 'content' field cannot be used when using MessageFlags.IS_COMPONENTS_V2",
    rawError: {
      errors: {
        content: {
          _errors: [
            {
              code: 'MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2',
              message:
                "The 'content' field cannot be used when using MessageFlags.IS_COMPONENTS_V2",
            },
          ],
        },
      },
    },
  };
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

  it('replaces a non-editable components-v2 primary message with a fresh reply instead of retrying edits forever', async () => {
    const channel = {
      send: vi.fn(),
      messages: {
        fetch: vi.fn(),
      },
    };
    const primary = createEditableMessage('components-v2-primary');
    const staleOverflow = createEditableMessage('stale-overflow');
    primary.edit.mockRejectedValueOnce(createComponentsV2EditError());

    const reconciled = await reconcileResponseSessionChunks({
      channel,
      nextText: 'Recovered text reply',
      state: {
        primaryMessage: primary,
        replyAnchor: null,
        overflowMessageIds: [staleOverflow.id],
        overflowMessages: [staleOverflow],
      },
      allowedMentions: { repliedUser: false },
    });

    expect(primary.edit).toHaveBeenCalledTimes(1);
    expect(primary.reply).toHaveBeenCalledTimes(1);
    expect(channel.send).not.toHaveBeenCalled();
    expect(staleOverflow.delete).toHaveBeenCalledTimes(1);
    expect(reconciled.primaryMessage.id).toBe('components-v2-primary-child-1');
    expect(reconciled.primaryText).toBe('Recovered text reply');
    expect(reconciled.overflowMessageIds).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { buildTranscriptBlock } from '@/features/awareness/transcriptBuilder';

describe('transcriptBuilder', () => {
  it('uses the Discord @me token for DM jump-link references', () => {
    const block = buildTranscriptBlock(
      [
        {
          messageId: 'msg-1',
          guildId: null,
          channelId: 'dm-channel-1',
          authorId: 'user-1',
          authorDisplayName: 'User One',
          authorIsBot: false,
          timestamp: new Date('2026-03-07T00:00:00.000Z'),
          content: 'hello from a dm',
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
      ],
      2_000,
    );

    expect(block).toContain('channels/{guildId-or-@me}/{channelId}/{messageId}');
    expect(block).toContain('guild:@me ch:dm-channel-1 msg:msg-1');
  });
});

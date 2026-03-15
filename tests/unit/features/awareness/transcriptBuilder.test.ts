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
    );

    expect(block).toContain('Ambient room transcript');
    expect(block).toContain('channels/{guildId-or-@me}/{channelId}/{messageId}');
    expect(block).toContain('speaker:human guild:@me ch:dm-channel-1 msg:msg-1');
  });

  it('renders speaker class, reply linkage, and mentions for transcript lines', () => {
    const block = buildTranscriptBlock(
      [
        {
          messageId: 'msg-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          authorId: 'user-1',
          authorDisplayName: 'Invoker',
          authorIsBot: false,
          timestamp: new Date('2026-03-07T00:00:00.000Z'),
          content: 'first line',
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-2',
          guildId: 'guild-1',
          channelId: 'channel-1',
          authorId: 'sage-bot',
          authorDisplayName: 'Sage',
          authorIsBot: true,
          timestamp: new Date('2026-03-07T00:00:01.000Z'),
          content: 'second   line',
          replyToMessageId: 'msg-1',
          mentionsUserIds: ['user-2', 'user-3'],
          mentionsBot: false,
        },
        {
          messageId: 'msg-3',
          guildId: 'guild-1',
          channelId: 'channel-1',
          authorId: 'helper-bot',
          authorDisplayName: 'HelperBot',
          authorIsBot: true,
          timestamp: new Date('2026-03-07T00:00:02.000Z'),
          content: 'third line',
          replyToMessageId: 'msg-2',
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-4',
          guildId: 'guild-1',
          channelId: 'channel-1',
          authorId: 'user-2',
          authorDisplayName: 'Other',
          authorIsBot: false,
          timestamp: new Date('2026-03-07T00:00:03.000Z'),
          content: 'fourth line',
          replyToMessageId: 'msg-3',
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-5',
          guildId: 'guild-1',
          channelId: 'channel-1',
          authorId: 'SYSTEM',
          authorDisplayName: 'System',
          authorIsBot: true,
          timestamp: new Date('2026-03-07T00:00:04.000Z'),
          content: 'system line',
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
      ],
      {
        focusUserId: 'user-1',
        sageUserId: 'sage-bot',
      },
    );

    expect(block).toContain('speaker:self guild:guild-1 ch:channel-1 msg:msg-1 reply_to:none mentions:none');
    expect(block).toContain('speaker:sage guild:guild-1 ch:channel-1 msg:msg-2 reply_to:msg-1 mentions:user-2,user-3');
    expect(block).toContain('speaker:external_bot guild:guild-1 ch:channel-1 msg:msg-3 reply_to:msg-2 mentions:none');
    expect(block).toContain('speaker:human guild:guild-1 ch:channel-1 msg:msg-4 reply_to:msg-3 mentions:none');
    expect(block).toContain('speaker:system guild:guild-1 ch:channel-1 msg:msg-5 reply_to:none mentions:none');
    expect(block).toContain('second line');
  });

  it('excludes specified messages from the rendered transcript', () => {
    const block = buildTranscriptBlock(
      [
        {
          messageId: 'msg-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          authorId: 'user-1',
          authorDisplayName: 'User One',
          authorIsBot: false,
          timestamp: new Date('2026-03-07T00:00:00.000Z'),
          content: 'should be removed',
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-2',
          guildId: 'guild-1',
          channelId: 'channel-1',
          authorId: 'user-2',
          authorDisplayName: 'User Two',
          authorIsBot: false,
          timestamp: new Date('2026-03-07T00:00:01.000Z'),
          content: 'should stay',
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
      ],
      {
        excludedMessageIds: ['msg-1'],
      },
    );

    expect(block).not.toContain('should be removed');
    expect(block).toContain('should stay');
  });
});

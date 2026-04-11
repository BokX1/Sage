import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockIsLoggingEnabled = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: mockIsLoggingEnabled,
}));

vi.mock('@/features/summary/channelSummaryScheduler', () => ({
  getChannelSummaryScheduler: vi.fn(() => null),
}));

import { ingestEvent } from '../../../../src/features/ingest/ingestEvent';
import {
  setSocialGraphPublisherForTests,
  type SocialGraphPublisher,
  type SocialInteractionEvent,
} from '../../../../src/platform/social-graph/kafkaProducer';

describe('ingestEvent - social graph publish', () => {
  const published: SocialInteractionEvent[] = [];

  beforeEach(() => {
    published.length = 0;
    mockIsLoggingEnabled.mockReturnValue(true);

    const publisher: SocialGraphPublisher = {
      publishInteraction: vi.fn(async (event: SocialInteractionEvent) => {
        published.push(event);
      }),
      publishVoiceSession: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
    };

    setSocialGraphPublisherForTests(publisher);
  });

  afterEach(() => {
    setSocialGraphPublisherForTests(null);
  });

  it('publishes MENTION and REPLY interactions (best-effort)', async () => {
    const at = new Date('2024-01-01T00:00:00.000Z');

    await ingestEvent({
      type: 'message',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'msg-1',
      authorId: 'user-a',
      authorDisplayName: 'User A',
      content: 'hello',
      timestamp: at,
      mentionsUserIds: ['user-b', 'user-c', 'user-a'],
      replyToAuthorId: 'user-d',
    });

    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'MENTION',
          guildId: 'guild-1',
          sourceUserId: 'user-a',
          targetUserId: 'user-b',
          channelId: 'channel-1',
          timestamp: at.toISOString(),
        }),
        expect.objectContaining({
          type: 'MENTION',
          guildId: 'guild-1',
          sourceUserId: 'user-a',
          targetUserId: 'user-c',
          channelId: 'channel-1',
          timestamp: at.toISOString(),
        }),
        expect.objectContaining({
          type: 'REPLY',
          guildId: 'guild-1',
          sourceUserId: 'user-a',
          targetUserId: 'user-d',
          channelId: 'channel-1',
          timestamp: at.toISOString(),
        }),
      ]),
    );

    // Self-mentions are ignored
    expect(
      published.some(
        (event) => event.type === 'MENTION' && event.targetUserId === 'user-a',
      ),
    ).toBe(false);
  });

  it('does not publish when logging is disabled', async () => {
    mockIsLoggingEnabled.mockReturnValue(false);

    await ingestEvent({
      type: 'message',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'msg-2',
      authorId: 'user-a',
      authorDisplayName: 'User A',
      content: 'hello',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      mentionsUserIds: ['user-b'],
      replyToAuthorId: 'user-c',
    });

    expect(published).toHaveLength(0);
  });

  it('skips publishing when publishSocialGraph is disabled', async () => {
    await ingestEvent(
      {
        type: 'message',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'msg-3',
        authorId: 'user-a',
        authorDisplayName: 'User A',
        content: 'hello',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        mentionsUserIds: ['user-b'],
        replyToAuthorId: 'user-c',
      },
      { publishSocialGraph: false },
    );

    expect(published).toHaveLength(0);
  });
});

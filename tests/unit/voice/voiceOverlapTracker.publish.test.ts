/**
 * @module tests/unit/voice/voiceOverlapTracker.publish.test
 * @description Defines the voice overlap tracker.publish.test module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetGuildPresence = vi.hoisted(() => vi.fn());

vi.mock('@/core/voice/voicePresenceIndex', () => ({
  getGuildPresence: mockGetGuildPresence,
}));

import { computeVoiceOverlapForUser } from '@/core/voice/voiceOverlapTracker';
import {
  setSocialGraphPublisherForTests,
  type SocialGraphPublisher,
  type VoiceSessionEvent,
} from '@/social-graph/kafkaProducer';

describe('voiceOverlapTracker - social graph publish', () => {
  const published: VoiceSessionEvent[] = [];

  beforeEach(() => {
    published.length = 0;
    mockGetGuildPresence.mockReset();

    const publisher: SocialGraphPublisher = {
      publishInteraction: vi.fn(async () => undefined),
      publishVoiceSession: vi.fn(async (event: VoiceSessionEvent) => {
        published.push(event);
      }),
      shutdown: vi.fn(async () => undefined),
    };

    setSocialGraphPublisherForTests(publisher);
  });

  afterEach(() => {
    setSocialGraphPublisherForTests(null);
  });

  it('publishes VOICE_SESSION overlap events (best-effort)', async () => {
    const joinedAt = new Date('2024-01-01T00:05:00.000Z');
    const leftAt = new Date('2024-01-01T00:10:00.000Z');

    mockGetGuildPresence.mockReturnValue([
      {
        channelId: 'vc-1',
        members: [
          { userId: 'user-b', joinedAt: new Date('2024-01-01T00:06:00.000Z') },
          { userId: 'user-a', joinedAt: new Date('2024-01-01T00:05:00.000Z') },
        ],
      },
    ]);

    await computeVoiceOverlapForUser({
      guildId: 'guild-1',
      userId: 'user-a',
      channelId: 'vc-1',
      joinedAt,
      leftAt,
    });

    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guildId: 'guild-1',
          userA: 'user-a',
          userB: 'user-b',
          durationMs: 240_000,
          timestamp: leftAt.toISOString(),
        }),
      ]),
    );
  });
});

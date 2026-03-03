/**
 * @module tests/integration/bot/handlers/messageReactionAdd.publish.test
 * @description Defines the message reaction add.publish.test module.
 */
import type { MessageReaction, PartialUser, User } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsLoggingEnabled = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: mockIsLoggingEnabled,
}));

import { handleMessageReactionAdd } from '@/bot/handlers/messageReactionAdd';
import {
  setSocialGraphPublisherForTests,
  type SocialGraphPublisher,
  type SocialInteractionEvent,
} from '@/social-graph/kafkaProducer';

describe('messageReactionAdd - social graph publish', () => {
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

  it('publishes REACT interaction payloads (best-effort)', async () => {
    const user = { id: 'reactor', bot: false, partial: false } as unknown as User;
    const reaction = {
      partial: false,
      emoji: { name: '👍', toString: () => '👍' },
      message: {
        partial: false,
        guildId: 'guild-1',
        channelId: 'channel-1',
        author: { id: 'target', bot: false },
      },
    } as unknown as MessageReaction;

    await handleMessageReactionAdd(reaction, user);

    expect(published).toHaveLength(1);
    expect(published[0]).toEqual(
      expect.objectContaining({
        type: 'REACT',
        guildId: 'guild-1',
        sourceUserId: 'reactor',
        targetUserId: 'target',
        channelId: 'channel-1',
      }),
    );
    expect(typeof published[0]?.timestamp).toBe('string');
  });

  it('skips when logging is disabled', async () => {
    mockIsLoggingEnabled.mockReturnValue(false);

    const user = { id: 'reactor', bot: false, partial: false } as unknown as User;
    const reaction = {
      partial: false,
      emoji: { name: '👍', toString: () => '👍' },
      message: {
        partial: false,
        guildId: 'guild-1',
        channelId: 'channel-1',
        author: { id: 'target', bot: false },
      },
    } as unknown as MessageReaction;

    await handleMessageReactionAdd(reaction, user);

    expect(published).toHaveLength(0);
  });

  it('skips bot reactions when the user object is partial', async () => {
    const fetch = vi.fn(async () => ({ id: 'partial-bot', bot: true, partial: false }));
    const user = {
      id: 'partial-bot',
      partial: true,
      fetch,
    } as unknown as PartialUser;

    const reaction = {
      partial: false,
      emoji: { name: '👍', toString: () => '👍' },
      message: {
        partial: false,
        guildId: 'guild-1',
        channelId: 'channel-1',
        author: { id: 'target', bot: false },
      },
    } as unknown as MessageReaction;

    await handleMessageReactionAdd(reaction, user);

    expect(published).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

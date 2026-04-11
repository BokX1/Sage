import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  VOICE_LIVE_CONTEXT_LOOKBACK_SEC: Number.NaN,
  VOICE_LIVE_CONTEXT_MAX_UTTERANCES: Number.NaN,
}));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

import {
  appendVoiceUtterance,
  clearVoiceConversationSession,
  formatLiveVoiceContext,
  startVoiceConversationSession,
} from '@/features/voice/voiceConversationSessionStore';

describe('voiceConversationSessionStore', () => {
  beforeEach(() => {
    clearVoiceConversationSession('guild-1');
    mockConfig.VOICE_LIVE_CONTEXT_LOOKBACK_SEC = Number.NaN;
    mockConfig.VOICE_LIVE_CONTEXT_MAX_UTTERANCES = Number.NaN;
  });

  it('formats live context when config numeric values are non-finite', () => {
    const now = new Date('2026-03-03T17:30:00.000Z');
    startVoiceConversationSession({
      guildId: 'guild-1',
      voiceChannelId: 'voice-1',
      initiatedByUserId: 'user-1',
      startedAt: now,
    });

    appendVoiceUtterance({
      guildId: 'guild-1',
      at: now,
      userId: 'user-1',
      displayName: 'Speaker',
      text: 'hello from voice',
    });

    const context = formatLiveVoiceContext({
      guildId: 'guild-1',
      voiceChannelId: 'voice-1',
      now,
    });

    expect(context).toContain('hello from voice');
    expect(context).toContain('last ~0s');
    expect(context).not.toContain('NaN');
  });

  it('falls back to a safe utterance limit when config is non-finite', () => {
    const now = new Date('2026-03-03T17:30:00.000Z');
    startVoiceConversationSession({
      guildId: 'guild-1',
      voiceChannelId: 'voice-1',
      initiatedByUserId: 'user-1',
      startedAt: now,
    });

    for (let index = 0; index < 6; index += 1) {
      appendVoiceUtterance({
        guildId: 'guild-1',
        at: now,
        userId: `user-${index}`,
        displayName: `Speaker ${index}`,
        text: `line-${index}`,
      });
    }

    const context = formatLiveVoiceContext({
      guildId: 'guild-1',
      voiceChannelId: 'voice-1',
      now,
    });

    const lines = (context ?? '').split('\n');
    expect(lines).toHaveLength(7); // header + 6 utterances
    expect(context).toContain('line-0');
    expect(context).toContain('line-5');
  });

  it('includes all retained utterances when the configured utterance limit is high', () => {
    mockConfig.VOICE_LIVE_CONTEXT_MAX_UTTERANCES = 10;

    const now = new Date('2026-03-03T17:30:00.000Z');
    startVoiceConversationSession({
      guildId: 'guild-1',
      voiceChannelId: 'voice-1',
      initiatedByUserId: 'user-1',
      startedAt: now,
    });

    for (let index = 0; index < 6; index += 1) {
      appendVoiceUtterance({
        guildId: 'guild-1',
        at: now,
        userId: `user-${index}`,
        displayName: `Speaker ${index}`,
        text: `line-${index}`,
      });
    }

    const context = formatLiveVoiceContext({
      guildId: 'guild-1',
      voiceChannelId: 'voice-1',
      now,
    });

    expect(context).toContain('line-0');
    expect(context).toContain('line-5');
  });
});

import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '../../../src/core/agentRuntime/contextBuilder';

describe('contextBuilder with relationship hints', () => {
  it('should include relationship_hints block when provided', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: null,
      userText: 'Hello',
      relationshipHints: 'Relationship hints: user_a <-> user_b',
    });

    const relationshipBlock = messages.find((m) => m.content.includes('Relationship hints'));
    expect(relationshipBlock).toBeDefined();
    expect(relationshipBlock?.role).toBe('system');
  });

  it('should omit relationship_hints block when null', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: null,
      userText: 'Hello',
      relationshipHints: null,
    });

    const relationshipBlock = messages.find((m) => m.content.includes('Relationship hints'));
    expect(relationshipBlock).toBeUndefined();
  });

  it('should order blocks correctly with relationship_hints', () => {
    const messages = buildContextMessages({
      userProfileSummary: 'User summary',
      channelProfileSummary: 'Channel profile',
      channelRollingSummary: 'Rolling summary',
      relationshipHints: 'Relationship hints',
      recentTranscript: 'Transcript',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = messages[0].content;

    const relIdx = systemContent.indexOf('Relationship hints');
    const profileIdx = systemContent.indexOf('Channel profile');
    const transcriptIdx = systemContent.indexOf('Transcript');

    expect(relIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(transcriptIdx).toBeGreaterThan(-1);

    // Logical order check: profile -> relationship -> transcript
    expect(relIdx).toBeGreaterThan(profileIdx);
    expect(transcriptIdx).toBeGreaterThan(relIdx);
  });
});

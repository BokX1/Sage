import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '../../../src/core/agentRuntime/contextBuilder';

describe('contextBuilder with provider context packets', () => {
  it('should include context packets when provided', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: null,
      userText: 'Hello',
      contextPackets: 'Context packet: Memory summary',
    });

    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Context packet: Memory summary');
  });

  it('should omit context packets when null', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: null,
      userText: 'Hello',
      contextPackets: null,
    });

    expect(messages[0].content).not.toContain('Context packet:');
  });

  it('should order blocks correctly with context packets', () => {
    const messages = buildContextMessages({
      userProfileSummary: 'User summary',
      channelProfileSummary: 'Channel profile',
      channelRollingSummary: 'Rolling summary',
      contextPackets: 'Context packet',
      recentTranscript: 'Transcript',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = messages[0].content;

    const contextIdx = systemContent.indexOf('Context packet');
    const profileIdx = systemContent.indexOf('Channel profile');
    const transcriptIdx = systemContent.indexOf('Transcript');

    expect(contextIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(transcriptIdx).toBeGreaterThan(-1);

    // Logical order check: profile -> context packets -> transcript
    expect(contextIdx).toBeGreaterThan(profileIdx);
    expect(transcriptIdx).toBeGreaterThan(contextIdx);
  });
});

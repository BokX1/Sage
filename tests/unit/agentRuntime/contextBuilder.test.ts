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

  it('places runtime instruction directly after base system content', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      runtimeInstruction: '## Runtime Capabilities\n- Active route: chat.',
      channelProfileSummary: 'Channel profile',
      contextPackets: 'Context packet',
      recentTranscript: 'Transcript',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = String(messages[0].content);
    const userContextIdx = systemContent.indexOf('## User Context');
    const runtimeIdx = systemContent.indexOf('## Runtime Capabilities');
    const profileIdx = systemContent.indexOf('Channel profile');

    expect(userContextIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(userContextIdx);
    expect(profileIdx).toBeGreaterThan(runtimeIdx);
  });

  it('keeps reply context before the latest user message', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: 'Earlier bot reply',
      replyReferenceContent: 'User is replying to that earlier answer',
      userText: 'Here is my latest follow-up',
    });

    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('assistant');
    expect(String(messages[1].content)).toContain('Earlier bot reply');
    expect(messages[messages.length - 1].role).toBe('user');
    expect(String(messages[messages.length - 1].content)).toContain('Here is my latest follow-up');
  });
});

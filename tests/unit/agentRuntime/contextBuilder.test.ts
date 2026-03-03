import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '@/core/agentRuntime/contextBuilder';

function getSystemContent(messages: ReturnType<typeof buildContextMessages>): string {
  const content = messages[0]?.content;
  if (typeof content !== 'string') {
    throw new Error('Expected system message content to be a string');
  }
  return content;
}

describe('contextBuilder with provider context packets', () => {
  it('should include context packets when provided', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: null,
      userText: 'Hello',
      contextPackets: 'Context packet: Memory summary',
    });

    expect(messages[0].role).toBe('system');
    expect(getSystemContent(messages)).toContain('Context packet: Memory summary');
  });

  it('should omit context packets when null', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: null,
      userText: 'Hello',
      contextPackets: null,
    });

    expect(getSystemContent(messages)).not.toContain('Context packet:');
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

    const systemContent = getSystemContent(messages);

    const contextIdx = systemContent.indexOf('Context packet');
    const profileIdx = systemContent.indexOf('Channel profile');
    const transcriptIdx = systemContent.indexOf('Transcript');

    expect(contextIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(transcriptIdx).toBeGreaterThan(-1);

    expect(contextIdx).toBeGreaterThan(profileIdx);
    expect(transcriptIdx).toBeGreaterThan(contextIdx);
  });

  it('places runtime instruction directly after base system content', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      runtimeInstruction: '<runtime_instruction>\n- Active route: chat.\n</runtime_instruction>',
      channelProfileSummary: 'Channel profile',
      contextPackets: 'Context packet',
      recentTranscript: 'Transcript',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = getSystemContent(messages);
    const userContextIdx = systemContent.indexOf('<user_context>');
    const runtimeIdx = systemContent.indexOf('<runtime_instruction>');
    const profileIdx = systemContent.indexOf('Channel profile');

    expect(userContextIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(userContextIdx);
    expect(profileIdx).toBeGreaterThan(runtimeIdx);
  });

  it('injects guild memory after runtime instruction', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      runtimeInstruction: '<runtime_instruction>\n- Runtime rule.\n</runtime_instruction>',
      guildMemory: 'Server mode: QA bot',
      channelProfileSummary: 'Channel profile',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = getSystemContent(messages);
    const runtimeIdx = systemContent.indexOf('<runtime_instruction>');
    const guildMemoryIdx = systemContent.indexOf('<guild_memory>');
    const profileIdx = systemContent.indexOf('Channel profile');

    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(guildMemoryIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(guildMemoryIdx).toBeGreaterThan(runtimeIdx);
    expect(profileIdx).toBeGreaterThan(guildMemoryIdx);
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

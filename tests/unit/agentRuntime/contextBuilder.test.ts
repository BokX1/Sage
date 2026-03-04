import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '@/core/agentRuntime/contextBuilder';

function getSystemContent(messages: ReturnType<typeof buildContextMessages>): string {
  const content = messages[0]?.content;
  if (typeof content !== 'string') {
    throw new Error('Expected system message content to be a string');
  }
  return content;
}

describe('contextBuilder core message assembly', () => {
  it('should produce a system message with user context', () => {
    const messages = buildContextMessages({
      userProfileSummary: 'Active developer, prefers concise code',
      replyToBotText: null,
      userText: 'Hello',
    });

    expect(messages[0].role).toBe('system');
    expect(getSystemContent(messages)).toContain('Active developer');
  });

  it('should show placeholder when no user profile', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: null,
      userText: 'Hello',
    });

    expect(getSystemContent(messages)).toContain('No specific user data available yet');
  });

  it('should order blocks correctly with transcript and guild memory', () => {
    const messages = buildContextMessages({
      userProfileSummary: 'User summary',
      guildMemory: 'Server mode: QA bot',
      recentTranscript: 'Transcript',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = getSystemContent(messages);

    const guildMemoryIdx = systemContent.indexOf('Server mode: QA bot');
    const transcriptIdx = systemContent.indexOf('Transcript');

    expect(guildMemoryIdx).toBeGreaterThan(-1);
    expect(transcriptIdx).toBeGreaterThan(-1);

    // transcript comes after guild memory (lower priority)
    expect(transcriptIdx).toBeGreaterThan(guildMemoryIdx);
  });

  it('places runtime instruction directly after base system content', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      runtimeInstruction: '<runtime_instruction>\n- Active route: chat.\n</runtime_instruction>',
      guildMemory: 'Server mode: QA bot',
      recentTranscript: 'Transcript',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = getSystemContent(messages);
    const userContextIdx = systemContent.indexOf('<user_context>');
    const runtimeIdx = systemContent.indexOf('<runtime_instruction>');
    const guildMemoryIdx = systemContent.indexOf('Server mode: QA bot');

    expect(userContextIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(guildMemoryIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(userContextIdx);
    expect(guildMemoryIdx).toBeGreaterThan(runtimeIdx);
  });

  it('injects guild memory after runtime instruction', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      runtimeInstruction: '<runtime_instruction>\n- Runtime rule.\n</runtime_instruction>',
      guildMemory: 'Server mode: QA bot',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = getSystemContent(messages);
    const runtimeIdx = systemContent.indexOf('<runtime_instruction>');
    const guildMemoryIdx = systemContent.indexOf('<guild_memory>');

    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(guildMemoryIdx).toBeGreaterThan(-1);
    expect(guildMemoryIdx).toBeGreaterThan(runtimeIdx);
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

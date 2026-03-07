import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '../../../../src/features/agent-runtime/contextBuilder';

function getSystemContent(messages: ReturnType<typeof buildContextMessages>): string {
  const content = messages[0]?.content;
  if (typeof content !== 'string') {
    throw new Error('Expected system message content to be a string');
  }
  return content;
}

describe('contextBuilder core message assembly', () => {
  it('should produce a system message with user profile', () => {
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

    expect(getSystemContent(messages)).toContain('No specific user profile available yet');
  });

  it('should order blocks correctly with transcript and server instructions', () => {
    const messages = buildContextMessages({
      userProfileSummary: 'User summary',
      serverInstructions: 'Act like a tavernkeeper in this guild.',
      recentTranscript: 'Transcript',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = getSystemContent(messages);

    const serverInstructionsIdx = systemContent.indexOf('Act like a tavernkeeper in this guild.');
    const transcriptIdx = systemContent.indexOf('Transcript');

    expect(serverInstructionsIdx).toBeGreaterThan(-1);
    expect(transcriptIdx).toBeGreaterThan(-1);

    // transcript comes after server instructions (lower priority)
    expect(transcriptIdx).toBeGreaterThan(serverInstructionsIdx);
  });

  it('places runtime instruction directly after base system content', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      runtimeInstruction: '<runtime_instruction>\n- Active route: chat.\n</runtime_instruction>',
      serverInstructions: 'Act like a tavernkeeper in this guild.',
      recentTranscript: 'Transcript',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = getSystemContent(messages);
    const userProfileIdx = systemContent.indexOf('<user_profile>');
    const runtimeIdx = systemContent.indexOf('<runtime_instruction>');
    const serverInstructionsIdx = systemContent.indexOf('Act like a tavernkeeper in this guild.');

    expect(userProfileIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(serverInstructionsIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(userProfileIdx);
    expect(serverInstructionsIdx).toBeGreaterThan(runtimeIdx);
  });

  it('injects server instructions after runtime instruction', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      runtimeInstruction: '<runtime_instruction>\n- Runtime rule.\n</runtime_instruction>',
      serverInstructions: 'Act like a tavernkeeper in this guild.',
      replyToBotText: null,
      userText: 'Hello',
    });

    const systemContent = getSystemContent(messages);
    const runtimeIdx = systemContent.indexOf('<runtime_instruction>');
    const serverInstructionsIdx = systemContent.indexOf('Act like a tavernkeeper in this guild.');

    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(serverInstructionsIdx).toBeGreaterThan(-1);
    expect(serverInstructionsIdx).toBeGreaterThan(runtimeIdx);
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
    expect(String(messages[1].content)).toContain('<assistant_context>');
    expect(String(messages[1].content)).toContain('Earlier bot reply');
    expect(messages[2].role).toBe('user');
    expect(String(messages[2].content)).toContain('<reply_reference>');
    expect(String(messages[2].content)).toContain('User is replying to that earlier answer');
    expect(messages[messages.length - 1].role).toBe('user');
    expect(String(messages[messages.length - 1].content)).toContain('<user_input>');
    expect(String(messages[messages.length - 1].content)).toContain('Here is my latest follow-up');
  });

  it('wraps multimodal user content in user_input tags', () => {
    const messages = buildContextMessages({
      userProfileSummary: null,
      replyToBotText: null,
      userText: 'fallback text',
      userContent: [
        { type: 'text', text: 'Please analyze this image' },
        { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
      ],
    });

    const latestMessage = messages[messages.length - 1];
    expect(latestMessage.role).toBe('user');
    expect(Array.isArray(latestMessage.content)).toBe(true);
    if (typeof latestMessage.content === 'string') return;
    expect(latestMessage.content[0]).toEqual({ type: 'text', text: '<user_input>\n' });
    expect(latestMessage.content[latestMessage.content.length - 1]).toEqual({ type: 'text', text: '\n</user_input>' });
  });
});

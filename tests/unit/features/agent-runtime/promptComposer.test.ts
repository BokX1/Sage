import { describe, expect, it } from 'vitest';
import {
  composeSystemPrompt,
  getCorePromptContent,
} from '../../../../src/features/agent-runtime/promptComposer';

describe('promptComposer', () => {
  it('keeps a compact base prompt while preserving core tags', () => {
    const prompt = getCorePromptContent();

    expect(prompt).toContain('<system_persona>');
    expect(prompt).toContain('<response_policy>');
    expect(prompt).toContain('<hard_rules>');
    expect(prompt).toContain('<user_context>');
    expect(prompt).not.toContain('<reasoning_protocol>');
    expect(prompt.length).toBeLessThan(4200);
  });

  it('uses the guild-native strategist-host identity without DM framing', () => {
    const prompt = getCorePromptContent();

    expect(prompt).toContain('You are Sage — the strategist-host for a live Discord server.');
    expect(prompt).toContain('You watch the room, remember the room, and help move the room forward.');
    expect(prompt).toContain('Do not reason as if DM-only fallbacks or private-assistant behavior are available.');
    expect(prompt).not.toContain('guildId-or-@me');
  });

  it('adds voice instructions that explicitly override default formatting rules', () => {
    const prompt = composeSystemPrompt({
      userProfileSummary: null,
      voiceMode: true,
    });

    expect(prompt).toContain('<voice_mode>');
    expect(prompt).toContain('This overrides the default Discord formatting guidance above.');
    expect(prompt).toContain('Avoid markdown, code fences, tables, and long URLs.');
  });

  it('does not repeat the old numeric confidence ladder', () => {
    const prompt = getCorePromptContent();

    expect(prompt).toContain('Verify unstable or uncertain facts with tools before stating them as true.');
    expect(prompt).not.toContain('>90% confident');
    expect(prompt).not.toContain('50-90% confident');
    expect(prompt).not.toContain('<50% confident');
  });

  it('explains that runtime can split long replies automatically', () => {
    const prompt = getCorePromptContent();

    expect(prompt).toContain('Runtime may split longer replies automatically before sending.');
  });
});

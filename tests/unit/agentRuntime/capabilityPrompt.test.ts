import { describe, expect, it } from 'vitest';
import { buildCapabilityPromptSection } from '../../../src/core/agentRuntime/capabilityPrompt';

describe('capabilityPrompt', () => {
  it('renders route, providers, tools, and behavior guidance', () => {
    const prompt = buildCapabilityPromptSection({
      routeKind: 'chat',
      searchMode: null,
      allowTools: true,
      contextProviders: ['Memory', 'SocialGraph'],
      tools: [
        { name: 'get_weather', description: 'Retrieve current weather for a location.' },
        { name: 'search_web', description: 'Query web results for fresh facts.' },
      ],
      verificationTools: ['verify_search_again', 'verify_chat_again'],
    });

    expect(prompt).toContain('## Runtime Capabilities');
    expect(prompt).toContain('Active route: chat.');
    expect(prompt).toContain('Context providers available this turn: Memory, SocialGraph.');
    expect(prompt).toContain('- get_weather: Retrieve current weather for a location.');
    expect(prompt).toContain('Verification tools: verify_search_again, verify_chat_again.');
    expect(prompt).toContain('Never claim or imply capabilities');
  });

  it('annotates search mode and handles empty tool lists', () => {
    const prompt = buildCapabilityPromptSection({
      routeKind: 'search',
      searchMode: 'complex',
      allowTools: false,
      contextProviders: ['Memory'],
      tools: [],
      verificationTools: ['verify_search_again'],
    });

    expect(prompt).toContain('Active route: search (complex mode).');
    expect(prompt).toContain('Tool calling: disabled.');
    expect(prompt).toContain('### Callable Tools');
    expect(prompt).toContain('- none');
  });
});

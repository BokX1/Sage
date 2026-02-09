import { describe, expect, it } from 'vitest';
import {
  buildAgenticStateBlock,
  buildCapabilityPromptSection,
} from '../../../src/core/agentRuntime/capabilityPrompt';

describe('capabilityPrompt', () => {
  it('renders route, providers, tools, and behavior guidance', () => {
    const prompt = buildCapabilityPromptSection({
      routeKind: 'chat',
      searchMode: null,
      allowTools: true,
      routerReasoning: 'User asked a general server question that needs social context.',
      contextProviders: ['Memory', 'SocialGraph'],
      tools: [
        { name: 'get_weather', description: 'Retrieve current weather for a location.' },
        { name: 'search_web', description: 'Query web results for fresh facts.' },
      ],
    });

    expect(prompt).toContain('## Runtime Capabilities');
    expect(prompt).toContain('## Agent Capability Matrix');
    expect(prompt).toContain('- coding: Implement and debug code');
    expect(prompt).toContain('Active route: chat.');
    expect(prompt).toContain('Active route capability focus: Handle conversational support');
    expect(prompt).toContain('Router rationale: User asked a general server question');
    expect(prompt).toContain('Context providers available this turn: Memory, SocialGraph.');
    expect(prompt).toContain('- get_weather: Retrieve current weather for a location.');
    expect(prompt).toContain('Verification and factual revision are handled by the critic loop');
    expect(prompt).toContain('## Agentic Loop Contract');
    expect(prompt).toContain('Never claim or imply capabilities');
  });

  it('annotates search mode and handles empty tool lists', () => {
    const prompt = buildCapabilityPromptSection({
      routeKind: 'search',
      searchMode: 'complex',
      allowTools: false,
      contextProviders: ['Memory'],
      tools: [],
    });

    expect(prompt).toContain('Active route: search (complex mode).');
    expect(prompt).toContain('Tool calling: disabled.');
    expect(prompt).toContain('### Callable Tools');
    expect(prompt).toContain('- none');
  });

  it('builds machine-readable agentic state JSON for this turn', () => {
    const stateBlock = buildAgenticStateBlock({
      routeKind: 'search',
      searchMode: 'complex',
      allowTools: false,
      routerReasoning: 'Fresh external facts required.',
      contextProviders: ['Memory'],
      tools: [],
    });

    expect(stateBlock).toContain('## Agentic State (JSON)');
    expect(stateBlock).toContain('"route": "search"');
    expect(stateBlock).toContain('"search_mode": "complex"');
    expect(stateBlock).toContain('"tool_calling_enabled": false');
    expect(stateBlock).toContain('"verification_owner": "critic"');
  });
});

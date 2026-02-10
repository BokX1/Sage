import { describe, expect, it } from 'vitest';
import {
  buildAgenticStateBlock,
  buildCapabilityPromptSection,
} from '../../../src/core/agentRuntime/capabilityPrompt';

describe('capabilityPrompt', () => {
  it('renders route, providers, and behavior guidance', () => {
    const prompt = buildCapabilityPromptSection({
      routeKind: 'chat',
      searchMode: null,
      routerReasoning: 'User asked a general server question that needs social context.',
      contextProviders: ['Memory', 'SocialGraph'],
      activeTools: ['web_search', 'web_scrape'],
    });

    expect(prompt).toContain('## Runtime Capabilities');
    expect(prompt).toContain('## Agent Capability Matrix');
    expect(prompt).toContain('- coding: Implement and debug code');
    expect(prompt).toContain('Active route (selected by router for this turn): chat.');
    expect(prompt).toContain('Router can choose these routes per turn: chat, coding, search, creative.');
    expect(prompt).toContain('Active route capability focus: Handle conversational support');
    expect(prompt).toContain('Router rationale: User asked a general server question');
    expect(prompt).toContain('Context providers available this turn: Memory, SocialGraph.');
    expect(prompt).toContain('Runtime tools available this turn: web_search, web_scrape.');
    expect(prompt).toContain('critic does not execute tools directly');
    expect(prompt).toContain('## Agentic Loop Contract');
    expect(prompt).toContain('tool assistance (if needed)');
    expect(prompt).toContain('Never claim or imply capabilities');
  });

  it('annotates search mode and route choices', () => {
    const prompt = buildCapabilityPromptSection({
      routeKind: 'search',
      searchMode: 'complex',
      contextProviders: ['Memory'],
      activeTools: ['web_search'],
    });

    expect(prompt).toContain('Active route (selected by router for this turn): search (complex mode).');
    expect(prompt).toContain('Router can choose these routes per turn: chat, coding, search, creative.');
  });

  it('builds machine-readable agentic state JSON for this turn', () => {
    const stateBlock = buildAgenticStateBlock({
      routeKind: 'search',
      searchMode: 'complex',
      routerReasoning: 'Fresh external facts required.',
      contextProviders: ['Memory'],
      activeTools: ['web_search', 'web_scrape'],
    });

    expect(stateBlock).toContain('## Agentic State (JSON)');
    expect(stateBlock).toContain('"route_selected_by": "router"');
    expect(stateBlock).toContain('"current_route": "search"');
    expect(stateBlock).toContain('"available_routes": [');
    expect(stateBlock).toContain('"search_mode": "complex"');
    expect(stateBlock).toContain('"tool_execution_owner": "runtime_assistant"');
    expect(stateBlock).toContain('"tools_available": [');
    expect(stateBlock).toContain('"tool_assistance_if_needed"');
    expect(stateBlock).toContain('"verification_owner": "critic"');
  });
});

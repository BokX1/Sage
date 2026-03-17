import { describe, expect, it } from 'vitest';
import { planToolExposure } from '../../../../src/features/agent-runtime/toolExposurePlanner';

function makeTool(
  name: string,
  capabilityTags: string[],
  access: 'public' | 'admin' = 'public',
) {
  return {
    name,
    runtime: {
      access,
      capabilityTags,
      class: capabilityTags.includes('image') ? ('artifact' as const) : ('query' as const),
    },
    metadata: {
      access,
    },
  };
}

describe('toolExposurePlanner', () => {
  it('narrows large eligible tool surfaces for obvious web-research turns', () => {
    const toolMap = new Map<string, ReturnType<typeof makeTool>>(
      [
        ['web_search', makeTool('web_search', ['web', 'search'])],
        ['web_research', makeTool('web_research', ['web', 'research'])],
        ['github_search_code', makeTool('github_search_code', ['github', 'developer'])],
        ['discord_messages_search_history', makeTool('discord_messages_search_history', ['discord', 'messages'])],
        ['discord_server_list_channels', makeTool('discord_server_list_channels', ['discord', 'server'])],
        ['discord_admin_submit_moderation', makeTool('discord_admin_submit_moderation', ['admin', 'moderation'], 'admin')],
        ['workflow_npm_github_code_search', makeTool('workflow_npm_github_code_search', ['workflow', 'developer', 'github', 'npm'])],
        ['image_generate', makeTool('image_generate', ['generation', 'image'])],
        ['system_time', makeTool('system_time', ['system', 'time'])],
        ['system_tool_stats', makeTool('system_tool_stats', ['system', 'tooling'])],
      ] as const,
    );

    const plan = planToolExposure({
      allToolNames: Array.from(toolMap.keys()),
      resolveTool: (toolName) => toolMap.get(toolName),
      phase: 'turn',
      invokedBy: 'mention',
      isAdmin: false,
      canModerate: false,
      userText: 'Please research the latest OpenAI docs on the web.',
      promptMode: 'standard',
      hasReplyTarget: false,
      inGuild: true,
      isVoiceActive: false,
    });

    expect(plan.strategy).toBe('intent_subset');
    expect(plan.activeToolNames).toEqual(
      expect.arrayContaining(['web_search', 'web_research', 'system_time']),
    );
    expect(plan.activeToolNames).not.toContain('github_search_code');
    expect(plan.activeToolNames).not.toContain('discord_messages_search_history');
  });

  it('keeps the full eligible surface during background resumes', () => {
    const toolMap = new Map<string, ReturnType<typeof makeTool>>(
      [
        ['web_search', makeTool('web_search', ['web', 'search'])],
        ['github_search_code', makeTool('github_search_code', ['github', 'developer'])],
        ['discord_messages_search_history', makeTool('discord_messages_search_history', ['discord', 'messages'])],
        ['system_time', makeTool('system_time', ['system', 'time'])],
      ] as const,
    );

    const plan = planToolExposure({
      allToolNames: Array.from(toolMap.keys()),
      resolveTool: (toolName) => toolMap.get(toolName),
      phase: 'background_resume',
      invokedBy: 'component',
      isAdmin: false,
      canModerate: false,
      userText: 'continue',
      promptMode: 'standard',
      hasReplyTarget: false,
      inGuild: true,
      isVoiceActive: false,
    });

    expect(plan.strategy).toBe('resume_all_eligible');
    expect(plan.activeToolNames).toEqual(Array.from(toolMap.keys()));
  });
});

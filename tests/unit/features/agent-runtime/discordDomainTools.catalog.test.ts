import { describe, expect, it } from 'vitest';

import {
  discordArtifactTools,
  discordContextTools,
  discordGovernanceTools,
  discordHistoryTools,
  discordModerationTools,
  discordScheduleTools,
  discordSpacesTools,
} from '../../../../src/features/agent-runtime/discordDomainTools';
import type { ToolDefinition } from '../../../../src/features/agent-runtime/toolRegistry';

describe('discord granular tool catalogs', () => {
  const toolCases = [
    { prefix: 'discord_context_', tools: discordContextTools },
    { prefix: 'discord_history_', tools: discordHistoryTools },
    { prefix: 'discord_artifact_', tools: discordArtifactTools },
    { prefix: 'discord_moderation_', tools: discordModerationTools },
    { prefix: 'discord_schedule_', tools: discordScheduleTools },
    { prefix: 'discord_spaces_', tools: discordSpacesTools },
    { prefix: 'discord_governance_', tools: discordGovernanceTools },
  ] as const;

  it.each(toolCases)('keeps every tool name aligned to the $prefix family', ({ prefix, tools }) => {
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.name.startsWith(prefix)).toBe(true);
    }
  });

  it.each(toolCases)('uses provider-safe object schemas and runtime metadata for $prefix', ({ tools }) => {
    for (const tool of tools) {
      const registered = tool as ToolDefinition;
      expect(registered.inputSchema.type).toBe('object');
      expect(registered.inputSchema.oneOf).toBeUndefined();
      expect(registered.inputSchema.anyOf).toBeUndefined();
      expect(registered.inputSchema.allOf).toBeUndefined();
      expect(['public', 'moderator', 'admin', 'owner']).toContain(registered.runtime.access);
      expect(registered.runtime.class).toMatch(/query|mutation|artifact|runtime/);
      expect(registered.runtime.capabilityTags).toEqual(expect.arrayContaining(['discord']));
      expect(registered.description.length).toBeGreaterThan(10);
      expect(registered.prompt?.summary?.length ?? 0).toBeGreaterThan(5);
    }
  });

  it('keeps read-only Discord context tools on the query path', () => {
    for (const tool of discordContextTools) {
      const registered = tool as ToolDefinition;
      expect(registered.runtime.class).toBe('query');
      expect(registered.runtime.readOnly).toBe(true);
    }
  });

  it('keeps moderator workflows on moderator-or-above access tiers', () => {
    for (const tool of discordModerationTools) {
      const registered = tool as ToolDefinition;
      expect(['moderator', 'admin']).toContain(registered.runtime.access);
      expect(registered.smoke?.args?.action).toBeUndefined();
    }
  });

  it('keeps scheduler configuration on admin access', () => {
    for (const tool of discordScheduleTools) {
      const registered = tool as ToolDefinition;
      expect(registered.runtime.access).toBe('admin');
    }
  });

  it('keeps artifact mutation tools on admin access while leaving artifact reads public', () => {
    const adminArtifactWrites = new Set([
      'discord_artifact_stage_attachment',
      'discord_artifact_create_text',
      'discord_artifact_replace',
      'discord_artifact_publish',
    ]);

    for (const tool of discordArtifactTools) {
      const registered = tool as ToolDefinition;
      if (adminArtifactWrites.has(registered.name)) {
        expect(registered.runtime.access).toBe('admin');
      } else {
        expect(registered.runtime.access).toBe('public');
      }
    }
  });

  it('keeps structural thread operations on admin access', () => {
    const adminThreadWrites = new Set([
      'discord_spaces_create_thread',
      'discord_spaces_update_thread',
      'discord_spaces_join_thread',
      'discord_spaces_leave_thread',
      'discord_spaces_add_thread_member',
      'discord_spaces_remove_thread_member',
    ]);

    for (const tool of discordSpacesTools) {
      const registered = tool as ToolDefinition;
      if (adminThreadWrites.has(registered.name)) {
        expect(registered.runtime.access).toBe('admin');
      }
    }
  });

  it('keeps root governance operations owner-only', () => {
    const ownerToolNames = new Set([
      'discord_governance_clear_server_api_key',
      'discord_governance_send_key_setup_card',
    ]);

    for (const tool of discordGovernanceTools) {
      const registered = tool as ToolDefinition;
      if (ownerToolNames.has(registered.name)) {
        expect(registered.runtime.access).toBe('owner');
      }
    }
  });
});

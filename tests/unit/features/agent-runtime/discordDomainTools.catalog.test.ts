import { describe, expect, it } from 'vitest';

import {
  discordAdminTools,
  discordContextTools,
  discordFileTools,
  discordMessageTools,
  discordServerTools,
  discordVoiceTools,
} from '../../../../src/features/agent-runtime/discordDomainTools';
import {
  DISCORD_ADMIN_ACTION_CATALOG,
  DISCORD_CONTEXT_ACTION_CATALOG,
  DISCORD_FILES_ACTION_CATALOG,
  DISCORD_MESSAGES_ACTION_CATALOG,
  DISCORD_SERVER_ACTION_CATALOG,
  DISCORD_VOICE_ACTION_CATALOG,
} from '../../../../src/features/agent-runtime/discordToolCatalog';
import type { ToolDefinition } from '../../../../src/features/agent-runtime/toolRegistry';

function getActionName(tool: ToolDefinition): string {
  const properties = tool.inputSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error(`Tool ${tool.name} is missing JSON schema properties.`);
  }
  expect((properties as Record<string, unknown>).action).toBeUndefined();
  return tool.name.replace(/^discord_(?:context|messages|files|server|admin|voice)_/, '');
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

describe('discord granular tool catalogs', () => {
  const toolCases = [
    {
      name: 'discord_context',
      tools: discordContextTools,
      catalog: DISCORD_CONTEXT_ACTION_CATALOG,
    },
    {
      name: 'discord_messages',
      tools: discordMessageTools,
      catalog: DISCORD_MESSAGES_ACTION_CATALOG,
    },
    {
      name: 'discord_files',
      tools: discordFileTools,
      catalog: DISCORD_FILES_ACTION_CATALOG,
    },
    {
      name: 'discord_server',
      tools: discordServerTools,
      catalog: DISCORD_SERVER_ACTION_CATALOG,
    },
    {
      name: 'discord_admin',
      tools: discordAdminTools,
      catalog: DISCORD_ADMIN_ACTION_CATALOG,
    },
    {
      name: 'discord_voice',
      tools: discordVoiceTools,
      catalog: DISCORD_VOICE_ACTION_CATALOG,
    },
  ] as const;

  it.each(toolCases)('covers every catalog action with one granular tool for $name', ({ tools, catalog }) => {
    const toolActions = tools.map((tool) => getActionName(tool as ToolDefinition));
    const catalogActions = [
      ...catalog.read_only,
      ...catalog.writes,
      ...catalog.admin_only,
    ];

    expect(sortedUnique(toolActions)).toEqual(sortedUnique(catalogActions));
  });

  it.each(toolCases)('uses provider-safe object schemas and runtime metadata for $name', ({ tools }) => {
    for (const tool of tools) {
      const registered = tool as ToolDefinition;
      expect(registered.inputSchema.type).toBe('object');
      expect(registered.inputSchema.oneOf).toBeUndefined();
      expect(registered.inputSchema.anyOf).toBeUndefined();
      expect(registered.inputSchema.allOf).toBeUndefined();
      expect(['public', 'admin']).toContain(registered.runtime.access);
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

  it('marks admin Discord tools as admin access and keeps smoke args action-free', () => {
    for (const tool of discordAdminTools) {
      const registered = tool as ToolDefinition;
      expect(registered.runtime.access).toBe('admin');
      expect(registered.smoke?.args?.action).toBeUndefined();
    }
  });

  it('keeps admin-only server reads marked as admin access', () => {
    for (const name of [
      'discord_server_list_members',
      'discord_server_get_member',
      'discord_server_get_permission_snapshot',
      'discord_server_list_automod_rules',
    ]) {
      const tool = discordServerTools.find((entry) => entry.name === name) as ToolDefinition | undefined;
      expect(tool?.runtime.access).toBe('admin');
    }
  });
});

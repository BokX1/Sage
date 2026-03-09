import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  discordAdminTool,
  discordContextTool,
  discordFilesTool,
  discordMessagesTool,
  discordServerTool,
} from '@/features/agent-runtime/discordDomainTools';
import {
  DISCORD_ADMIN_ACTION_CATALOG,
  DISCORD_CONTEXT_ACTION_CATALOG,
  DISCORD_FILES_ACTION_CATALOG,
  DISCORD_MESSAGES_ACTION_CATALOG,
  DISCORD_SERVER_ACTION_CATALOG,
} from '@/features/agent-runtime/discordToolCatalog';

function extractTopLevelActionConsts(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Expected JSON schema object');
  }

  const record = schema as Record<string, unknown>;
  const variants =
    (Array.isArray(record.oneOf) ? record.oneOf : null) ??
    (Array.isArray(record.anyOf) ? record.anyOf : null);

  if (!variants) {
    throw new Error('Expected a top-level oneOf/anyOf union for tool schema');
  }

  const actions: string[] = [];
  for (const variant of variants) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) continue;
    const properties = (variant as Record<string, unknown>).properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) continue;
    const actionSchema = (properties as Record<string, unknown>).action;
    if (!actionSchema || typeof actionSchema !== 'object' || Array.isArray(actionSchema)) continue;
    const constValue = (actionSchema as Record<string, unknown>).const;
    if (typeof constValue === 'string' && constValue.trim().length > 0) {
      actions.push(constValue);
    }
  }

  return Array.from(new Set(actions)).sort((a, b) => a.localeCompare(b));
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

describe('discord domain tool catalogs', () => {
  const toolCases = [
    {
      tool: discordContextTool,
      name: 'discord_context',
      catalog: DISCORD_CONTEXT_ACTION_CATALOG,
      readOnlyOnly: true,
    },
    {
      tool: discordMessagesTool,
      name: 'discord_messages',
      catalog: DISCORD_MESSAGES_ACTION_CATALOG,
      readOnlyOnly: false,
    },
    {
      tool: discordFilesTool,
      name: 'discord_files',
      catalog: DISCORD_FILES_ACTION_CATALOG,
      readOnlyOnly: false,
    },
    {
      tool: discordServerTool,
      name: 'discord_server',
      catalog: DISCORD_SERVER_ACTION_CATALOG,
      readOnlyOnly: false,
    },
    {
      tool: discordAdminTool,
      name: 'discord_admin',
      catalog: DISCORD_ADMIN_ACTION_CATALOG,
      readOnlyOnly: false,
    },
  ] as const;

  it.each(toolCases)('schema actions match catalog for $name', ({ tool, catalog }) => {
    const schema = z.toJSONSchema(tool.schema);
    const schemaActions = extractTopLevelActionConsts(schema);
    const catalogActions = Array.from(
      new Set([...catalog.read_only, ...catalog.writes, ...catalog.admin_only]),
    ).sort((a, b) => a.localeCompare(b));

    expect(schemaActions).toEqual(catalogActions);
  });

  it.each(toolCases)('help output is complete for $name', async ({ tool, name, catalog, readOnlyOnly }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool as any).execute(
      { think: 'List actions', action: 'help' },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        tool: name,
        type: 'routed_tool_help',
        purpose: expect.any(String),
        use_when: expect.any(Array),
        action_names: expect.any(Array),
        action_contracts: expect.any(Array),
        read_only_actions: expect.any(Array),
        write_actions: expect.any(Array),
        admin_only_actions: expect.any(Array),
        guardrails: expect.any(Array),
      }),
    );

    const output = result as {
      action_names: string[];
      action_contracts: Array<Record<string, unknown>>;
      read_only_actions: string[];
      write_actions: string[];
      admin_only_actions: string[];
    };

    expect(output.read_only_actions).toEqual([...catalog.read_only]);
    expect(output.write_actions).toEqual([...catalog.writes]);
    expect(output.admin_only_actions).toEqual([...catalog.admin_only]);
    expect(sortedUnique(output.action_names)).toEqual(
      sortedUnique([...catalog.read_only, ...catalog.writes, ...catalog.admin_only]),
    );

    for (const contract of output.action_contracts) {
      expect(contract).toEqual(
        expect.objectContaining({
          action: expect.any(String),
          purpose: expect.any(String),
          use_when: expect.any(Array),
          required_fields: expect.any(Array),
          optional_fields: expect.any(Array),
          defaults: expect.any(Array),
          restrictions: expect.any(Array),
          result_notes: expect.any(Array),
          common_mistakes: expect.any(Array),
        }),
      );
      expect(Array.isArray(contract.examples)).toBe(true);
    }

    const highRiskActions = new Set([
      'search_history',
      'send',
      'send_attachment',
      'api',
    ]);
    for (const action of output.action_contracts) {
      const actionName = action.action;
      if (typeof actionName !== 'string' || !highRiskActions.has(actionName)) continue;
      expect(action.common_mistakes).toEqual(expect.any(Array));
      expect((action.common_mistakes as unknown[]).length).toBeGreaterThan(0);
    }

    if (readOnlyOnly) {
      expect(output.write_actions).toEqual([]);
      expect(output.admin_only_actions).toEqual([]);
    }
  });
});

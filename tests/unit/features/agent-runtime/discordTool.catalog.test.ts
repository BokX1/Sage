import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { discordTool } from '@/features/agent-runtime/discordTool';
import {
  DISCORD_ACTION_CATALOG,
  getAllDiscordActions,
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

  return actions;
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

describe('discordTool action catalog', () => {
  it('catalog matches discord tool schema action literals', () => {
    const schema = z.toJSONSchema(discordTool.schema);
    const schemaActions = sortedUnique(extractTopLevelActionConsts(schema));
    const catalogActions = sortedUnique(getAllDiscordActions());

    expect(schemaActions).toEqual(catalogActions);
  });

  it('help output groups actions and is complete', async () => {
    const result = await discordTool.execute(
      { think: 'List actions', action: 'help' },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        tool: 'discord',
        actions: expect.any(Array),
        read_only_actions: expect.any(Array),
        write_actions: expect.any(Array),
        admin_only_actions: expect.any(Array),
        guardrails: expect.any(Array),
      }),
    );

    const output = result as {
      actions: string[];
      read_only_actions: string[];
      write_actions: string[];
      admin_only_actions: string[];
    };

    expect(output.read_only_actions).toEqual([...DISCORD_ACTION_CATALOG.read_only]);
    expect(output.write_actions).toEqual([...DISCORD_ACTION_CATALOG.writes]);
    expect(output.admin_only_actions).toEqual([...DISCORD_ACTION_CATALOG.admin_only]);

    const union = sortedUnique([
      ...output.read_only_actions,
      ...output.write_actions,
      ...output.admin_only_actions,
    ]);
    expect(union).toEqual(sortedUnique(getAllDiscordActions()));
  });
});


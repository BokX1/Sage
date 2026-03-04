import { describe, expect, it } from 'vitest';

import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../src/core/agentRuntime/defaultTools';
import { getAllDiscordActions } from '../../../src/core/agentRuntime/discordToolCatalog';

type NativeToolRow = { name: string };

async function loadWebsiteNativeTools(): Promise<NativeToolRow[]> {
  const moduleUrl = new URL('../../../website/src/lib/nativeTools.js', import.meta.url).toString();
  const mod = (await import(moduleUrl)) as { nativeTools?: unknown };
  const rows = Array.isArray(mod.nativeTools) ? (mod.nativeTools as NativeToolRow[]) : [];
  return rows;
}

describe('website native tools list', () => {
  it('lists only real runtime tools or discord actions', async () => {
    const nativeTools = await loadWebsiteNativeTools();
    const names = nativeTools.map((row) => row.name);

    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);
    const runtimeTools = new Set(registry.listNames());
    const discordActions = new Set(getAllDiscordActions());

    const unknown = names.filter((name) => !runtimeTools.has(name) && !discordActions.has(name));
    expect(unknown).toEqual([]);
  });

  it('includes the full Discord action catalog', async () => {
    const nativeTools = await loadWebsiteNativeTools();
    const names = new Set(nativeTools.map((row) => row.name));
    const actions = getAllDiscordActions();

    const missing = actions.filter((action) => !names.has(action));
    expect(missing).toEqual([]);
  });

  it('includes all default tools (excluding discord, which is represented by actions)', async () => {
    const nativeTools = await loadWebsiteNativeTools();
    const names = new Set(nativeTools.map((row) => row.name));

    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);
    const toolNames = registry.listNames().filter((name) => name !== 'discord');

    const missing = toolNames.filter((toolName) => !names.has(toolName));
    expect(missing).toEqual([]);
  });
});


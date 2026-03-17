import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

import {
  getTopLevelToolDoc,
  listTopLevelToolDocs,
} from '../../../../src/features/agent-runtime/toolDocs';

describe('tool selection hints', () => {
  it('covers every registered top-level tool with shared metadata', () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const runtimeToolNames = registry.listNames().sort((a, b) => a.localeCompare(b));
    const documentedToolNames = listTopLevelToolDocs()
      .map((doc) => doc.tool)
      .sort((a, b) => a.localeCompare(b));

    expect(documentedToolNames).toEqual(runtimeToolNames);

    for (const toolName of runtimeToolNames) {
      const doc = getTopLevelToolDoc(toolName);
      expect(doc).not.toBeNull();
      expect(doc?.selectionHints.length ?? 0).toBeGreaterThan(0);
      expect(doc?.website.short.length ?? 0).toBeGreaterThan(0);
      expect(doc?.website.desc.length ?? 0).toBeGreaterThan(0);
      expect(doc?.smoke.mode).toBeDefined();
    }
  });

  it('documents granular Discord tool distinctions directly', () => {
    expect(getTopLevelToolDoc('discord_context_get_channel_summary')?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('continuity'),
      ]),
    );
    expect(getTopLevelToolDoc('discord_messages_search_history')?.selectionHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exact message-history evidence'),
      ]),
    );
    expect(getTopLevelToolDoc('discord_admin_submit_moderation')?.avoidWhen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('changing Sage behavior'),
      ]),
    );
  });
});

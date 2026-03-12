import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

import {
  getRoutedToolDoc,
  getTopLevelToolDoc,
  listRoutedToolNames,
  listTopLevelToolDocs,
} from '../../../../src/features/agent-runtime/toolDocs';

describe('routed tool selection hints', () => {
  it('provides non-empty selection hints for every routed tool', () => {
    const toolNames = listRoutedToolNames();

    expect(toolNames.length).toBeGreaterThan(0);

    for (const toolName of toolNames) {
      const doc = getRoutedToolDoc(toolName);
      expect(doc).not.toBeNull();
      expect(doc?.selectionHints?.length ?? 0).toBeGreaterThan(0);
    }
  });

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
      expect(doc?.validationHint?.length ?? 0).toBeGreaterThan(0);
      expect(doc?.smoke.mode).toBeDefined();
    }
  });
});

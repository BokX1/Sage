import { ToolRegistry, globalToolRegistry } from './toolRegistry';

export function buildScopedToolRegistry(toolNames: string[]): ToolRegistry {
  const scopedRegistry = new ToolRegistry();
  if (typeof globalToolRegistry.get !== 'function') {
    return scopedRegistry;
  }
  for (const toolName of toolNames) {
    const tool = globalToolRegistry.get(toolName);
    if (!tool) continue;
    scopedRegistry.register(tool);
  }
  return scopedRegistry;
}

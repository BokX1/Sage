import {
  type ToolSpecV2,
  ToolRegistry,
  globalToolRegistry,
} from './toolRegistry';
import { runtimeExecuteCodeTool } from '../code-mode/tool';

export const STATIC_TOOL_DEFINITIONS = [
  runtimeExecuteCodeTool,
];

function registerIfMissing<TArgs, TStructured>(
  registry: ToolRegistry,
  tool: ToolSpecV2<TArgs, TStructured>,
): void {
  if (!registry.has(tool.name)) {
    registry.register(tool);
  }
}

export async function registerDefaultAgenticTools(
  registry: ToolRegistry = globalToolRegistry,
): Promise<void> {
  for (const tool of STATIC_TOOL_DEFINITIONS) {
    registerIfMissing(registry, tool as ToolSpecV2<unknown, unknown>);
  }
}


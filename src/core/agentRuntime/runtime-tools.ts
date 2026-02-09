import { logger } from '../utils/logger';
import { globalToolRegistry, type ToolDefinition } from './toolRegistry';

const DEFAULT_RUNTIME_TOOLS: ToolDefinition[] = [];

let runtimeToolsRegistered = false;

export function registerRuntimeTools(): string[] {
  if (!runtimeToolsRegistered) {
    for (const tool of DEFAULT_RUNTIME_TOOLS) {
      if (!globalToolRegistry.has(tool.name)) {
        globalToolRegistry.register(tool);
      }
    }
    runtimeToolsRegistered = true;
    logger.info({ tools: globalToolRegistry.listNames() }, 'Runtime tools registered');
  }
  return globalToolRegistry.listNames();
}

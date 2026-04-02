import { runtimeExecuteCodeTool } from '../code-mode/tool';
import type { RegisteredRuntimeToolSpec, ToolExecutionContext } from './runtimeToolContract';

export const RUNTIME_EXECUTE_CODE_TOOL_NAME = 'runtime_execute_code';

export function getRuntimeSurfaceTools(): RegisteredRuntimeToolSpec<unknown>[] {
  return [runtimeExecuteCodeTool as RegisteredRuntimeToolSpec<unknown>];
}

export function listRuntimeSurfaceToolNames(): string[] {
  return [RUNTIME_EXECUTE_CODE_TOOL_NAME];
}

export function getRuntimeSurfaceTool(name: string): RegisteredRuntimeToolSpec<unknown> | undefined {
  return name === RUNTIME_EXECUTE_CODE_TOOL_NAME
    ? (runtimeExecuteCodeTool as RegisteredRuntimeToolSpec<unknown>)
    : undefined;
}

export function isRuntimeSurfaceToolName(name: string): boolean {
  return name === RUNTIME_EXECUTE_CODE_TOOL_NAME;
}

export async function initializeRuntimeSurface(): Promise<void> {
  void runtimeExecuteCodeTool;
}

export function resolveRuntimeSurfaceToolNames(params: {
  authority: ToolExecutionContext['invokerAuthority'];
  invokedBy: NonNullable<ToolExecutionContext['invokedBy']>;
}): string[] {
  void params;
  return [RUNTIME_EXECUTE_CODE_TOOL_NAME];
}

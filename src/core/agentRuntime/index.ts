/**
 * Re-export public agent-runtime surfaces used by handlers and tests.
 *
 * Non-goals:
 * - Hold runtime state.
 * - Execute chat turns directly.
 */
export { runChatTurn, type RunChatTurnParams, type RunChatTurnResult } from './agentRuntime';

export {
  composeSystemPrompt,
  getCorePromptContent,
  type ComposeSystemPromptParams,
} from './promptComposer';
export { buildContextMessages, type BuildContextMessagesParams } from './contextBuilder';
export {
  ToolRegistry,
  globalToolRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolValidationResult,
  type OpenAIToolSpec,
} from './toolRegistry';

export {
  runToolCallLoop,
  type ToolCallLoopConfig,
  type ToolCallLoopParams,
  type ToolCallLoopResult,
} from './toolCallLoop';

export { type ToolCallEnvelope } from './toolCallParser';
export { type ToolResult } from './toolCallExecution';

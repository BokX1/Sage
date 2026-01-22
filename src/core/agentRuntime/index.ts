/**
 * Agent Runtime Module
 *
 * Central orchestration layer for LLM interactions with:
 * - Composable prompt building (promptBlocks, promptComposer)
 * - Context message construction (contextBuilder)
 * - Strict tool validation and execution (toolRegistry, toolCallLoop)
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
  type ToolCallEnvelope,
  type ToolResult,
  type ToolCallLoopConfig,
  type ToolCallLoopParams,
  type ToolCallLoopResult,
} from './toolCallLoop';

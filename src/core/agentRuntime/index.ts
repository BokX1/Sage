/**
 * Agent Runtime Module
 *
 * Central orchestration layer for LLM interactions with:
 * - Composable prompt building (promptBlocks, promptComposer)
 * - Context message construction (contextBuilder)
 * - Strict tool validation and execution (toolRegistry, toolCallLoop)
 *
 * Phase D0: Foundation for future agentic capabilities.
 */

// Main entrypoint
export { runChatTurn, type RunChatTurnParams, type RunChatTurnResult } from './agentRuntime';

// Prompt composition
export { type PromptBlock, renderPromptBlocks } from './promptBlocks';
export {
  composeSystemPrompt,
  getCorePromptContent,
  type ComposeSystemPromptParams,
} from './promptComposer';

// Context building
export { buildContextMessages, type BuildContextMessagesParams } from './contextBuilder';

// Tool system
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

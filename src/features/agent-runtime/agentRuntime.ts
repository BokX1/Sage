import { config as appConfig } from '../../platform/config/env';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { getLLMClient } from '../../platform/llm';
import { LLMChatMessage, LLMMessageContent } from '../../platform/llm/llm-types';
import { getGuildApiKey } from '../settings/guildSettingsRepo';
import { getGuildMemoryText } from '../settings/guildMemoryRepo';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { logger } from '../../platform/logging/logger';
import { normalizeStrictlyPositiveInt } from '../../shared/utils/numbers';
import { upsertTraceStart, updateTraceEnd } from './agent-trace-repo';
import { buildContextMessages } from './contextBuilder';
import { runToolCallLoop } from './toolCallLoop';
import { ToolResult } from './toolCallExecution';
import { enforceGitHubFileGrounding } from './toolGrounding';
import { clearGitHubFileLookupCacheForTrace } from './toolIntegrations';
import { collectPendingAdminActionIds } from './pendingApprovals';

import {
  buildCapabilityPromptSection,
  type BuildCapabilityPromptSectionParams,
} from './capabilityPrompt';
import { resolveRuntimeAutopilotMode } from './autopilotMode';
import {
  ToolRegistry,
  globalToolRegistry,
  type ToolExecutionContext,
} from './toolRegistry';

import { formatLiveVoiceContext } from '../voice/voiceConversationSessionStore';

const SINGLE_ROUTE_KIND = 'single';

/** Default model identifier when CHAT_MODEL is not configured. */
const DEFAULT_CHAT_MODEL = 'kimi';

export interface RunChatTurnParams {
  traceId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  voiceChannelId?: string | null;
  messageId: string;
  userText: string;
  userContent?: LLMMessageContent;
  userProfileSummary: string | null;
  replyToBotText: string | null;
  replyReferenceContent?: LLMMessageContent | null;
  mentionedUserIds?: string[];
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
  isVoiceActive?: boolean;
  isAdmin?: boolean;
}

export interface RunChatTurnResult {
  replyText: string;
  debug?: {
    messages?: LLMChatMessage[];
  };
  files?: Array<{
    attachment: Buffer;
    name: string;
  }>;
  pendingAdminActionIds?: string[];
}

function buildScopedToolRegistry(toolNames: string[]): ToolRegistry {
  const scopedRegistry = new ToolRegistry();
  for (const toolName of toolNames) {
    const tool = globalToolRegistry.get(toolName);
    if (!tool) continue;
    scopedRegistry.register(tool);
  }
  return scopedRegistry;
}

function buildToolProtocolInstruction(toolNames: string[]): string {
  if (toolNames.length === 0) return '';

  const lines = [
    '<tool_protocol>',
    'FORMAT: When calling tools, output ONLY valid JSON (no markdown wrapping):',
    '{"type": "tool_calls", "calls": [{"name": "<tool_name>", "args": {...}}]}',
    '',
    'After gathering sufficient data, either respond in plain text or use the appropriate Discord self-send action when the runtime guidance tells you to deliver the final answer through Discord.',
    'If no tool is needed, answer normally in plain text.',
    '',
    'Behavioral rules (batching, tool selection, guardrails) are in <execution_rules> and <tool_selection_guide>.',
    '</tool_protocol>',
  ];

  return lines.join('\n');
}

function resolveActiveToolNames(params: {
  isAdmin: boolean;
  invokedBy: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
}): string[] {
  const allToolNames = globalToolRegistry.listNames();
  return allToolNames.filter((toolName) => {
    const tool = globalToolRegistry.get(toolName);
    if (!tool) return false;
    const access = tool.metadata?.access ?? 'public';
    if (access === 'public') return true;
    return params.isAdmin && params.invokedBy !== 'autopilot';
  });
}

function cleanDraftText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .split('\0')
    .join('')
    .replace(/\r\n/g, '\n')
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function collectFilesFromToolResults(toolResults: ToolResult[]): Array<{ attachment: Buffer; name: string }> {
  const files: Array<{ attachment: Buffer; name: string }> = [];
  for (const toolResult of toolResults) {
    if (!toolResult.success || !toolResult.attachments || toolResult.attachments.length === 0) {
      continue;
    }
    for (const attachment of toolResult.attachments) {
      files.push({
        attachment: attachment.data,
        name: attachment.filename,
      });
    }
  }
  return files;
}

function buildToolLoopConfig() {
  return {
    maxRounds: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_MAX_ROUNDS as number | undefined,
      6,
    ),
    maxCallsPerRound: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_MAX_CALLS_PER_ROUND as number | undefined,
      5,
    ),
    toolTimeoutMs: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_TIMEOUT_MS as number | undefined,
      45_000,
    ),
    maxToolResultChars: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_RESULT_MAX_CHARS as number | undefined,
      8_000,
    ),
    parallelReadOnlyTools:
      (appConfig.AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED as boolean | undefined) ?? true,
    maxParallelReadOnlyTools: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY as number | undefined,
      4,
    ),
    cacheEnabled: true,
    cacheMaxEntries: 50,
    memoEnabled: (appConfig.AGENTIC_TOOL_MEMO_ENABLED as boolean | undefined) ?? true,
    memoMaxEntries: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_MEMO_MAX_ENTRIES as number | undefined,
      250,
    ),
    memoTtlMs: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_MEMO_TTL_MS as number | undefined,
      15 * 60_000,
    ),
    memoMaxResultJsonChars: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_MEMO_MAX_RESULT_JSON_CHARS as number | undefined,
      200_000,
    ),
    maxLoopDurationMs: normalizeStrictlyPositiveInt(
      appConfig.AGENTIC_TOOL_LOOP_TIMEOUT_MS as number | undefined,
      120_000,
    ),
  };
}

export async function runChatTurn(params: RunChatTurnParams): Promise<RunChatTurnResult> {
  const {
    traceId,
    userId,
    channelId,
    guildId,
    voiceChannelId,
    userText,
    userContent,
    replyToBotText,
    replyReferenceContent,
    invokedBy = 'mention',
    isVoiceActive,
    isAdmin = false,
  } = params;
  const clearToolCaches = () => {
    clearGitHubFileLookupCacheForTrace(traceId);
  };

  const transcriptBlock = guildId && isLoggingEnabled(guildId, channelId)
    ? buildTranscriptBlock(
      getRecentMessages({ guildId, channelId, limit: appConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES }),
      appConfig.CONTEXT_TRANSCRIPT_MAX_CHARS,
    )
    : null;





  const liveVoiceContext =
    guildId && isVoiceActive && voiceChannelId
      ? formatLiveVoiceContext({ guildId, voiceChannelId, now: new Date() })
      : null;

  const guildApiKey = guildId ? await getGuildApiKey(guildId) : undefined;
  const apiKey = (guildApiKey ?? appConfig.LLM_API_KEY)?.trim();
  if (!apiKey) {
    logger.warn(
      { guildId, channelId, userId },
      'No API key configured for chat turn; returning setup guidance response',
    );
    clearToolCaches();
    return {
      replyText: guildId
        ? '⚠️ I need a server API key before I can respond here. Ask an admin to run `/sage key login` and `/sage key set <your_key>`.'
        : '⚠️ I need an API key before I can respond. Configure `LLM_API_KEY` for this bot instance.',
    };
  }

  let serverInstructions: string | null = null;
  if (guildId) {
    try {
      serverInstructions = await getGuildMemoryText(guildId);
    } catch (error) {
      logger.warn({ error, guildId }, 'Failed to load server instructions (non-fatal)');
    }
  }
  const model = (appConfig.CHAT_MODEL || DEFAULT_CHAT_MODEL).trim();
  const toolLoopEnabled = (appConfig.AGENTIC_TOOL_LOOP_ENABLED as boolean | undefined) ?? true;
  const toolLoopConfig = buildToolLoopConfig();
  const toolLoopLimits = {
    maxRounds: toolLoopConfig.maxRounds,
    maxCallsPerRound: toolLoopConfig.maxCallsPerRound,
    parallelReadOnlyTools: toolLoopConfig.parallelReadOnlyTools,
    maxParallelReadOnlyTools: toolLoopConfig.maxParallelReadOnlyTools,
  };
  const autopilotMode = resolveRuntimeAutopilotMode({
    invokedBy,
    configuredMode: appConfig.AUTOPILOT_MODE,
  });

  const activeToolNames = resolveActiveToolNames({ isAdmin, invokedBy });
  const scopedToolRegistry = buildScopedToolRegistry(activeToolNames);
  const toolSpecs =
    toolLoopEnabled && activeToolNames.length > 0
      ? scopedToolRegistry.listOpenAIToolSpecs().map((tool) => ({
        type: tool.type,
        function: {
          ...tool.function,
          parameters: tool.function.parameters as Record<string, unknown>,
        },
      }))
      : undefined;

  const capabilityParams: BuildCapabilityPromptSectionParams = {
    activeTools: activeToolNames,
    model,
    invokedBy,
    invokerIsAdmin: isAdmin,
    inGuild: guildId !== null,
    turnMode: isVoiceActive ? 'voice' : 'text',
    autopilotMode,
    toolLoopLimits,
  };

  const runtimeInstruction = [
    buildCapabilityPromptSection(capabilityParams),
    buildToolProtocolInstruction(activeToolNames),
  ].join('\n\n');

  const runtimeMessages = buildContextMessages({
    userProfileSummary: params.userProfileSummary,
    runtimeInstruction,
    serverInstructions,
    replyToBotText,
    replyReferenceContent,
    userText,
    userContent,
    recentTranscript: transcriptBlock,
    voiceContext: liveVoiceContext,
    invokedBy,
    isVoiceActive,
  });

  if (appConfig.TRACE_ENABLED) {
    try {
      await upsertTraceStart({
        id: traceId,
        guildId,
        channelId,
        userId,
        routeKind: SINGLE_ROUTE_KIND,
        tokenJson: {
          model,
          route: SINGLE_ROUTE_KIND,
          activeToolNames,
        },
        reasoningText: 'Single-agent runtime (router/graph disabled)',
        budgetJson: {
          route: SINGLE_ROUTE_KIND,
          model,
          toolLoopEnabled,
        },
        agentEventsJson: [
          {
            type: 'runtime_start',
            route: SINGLE_ROUTE_KIND,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace start');
    }
  }

  const client = getLLMClient();
  let draftText: string;
  let toolLoopBudgetJson: Record<string, unknown> | undefined;
  let toolResults: ToolResult[] = [];

  try {
    const maxTokens = normalizeStrictlyPositiveInt(
      appConfig.CHAT_MAX_OUTPUT_TOKENS as number | undefined,
      1_800,
    );
    const response = await client.chat({
      messages: runtimeMessages,
      model,
      apiKey,
      temperature: 0.6,
      timeout: appConfig.TIMEOUT_CHAT_MS,
      maxTokens,
      tools: toolSpecs,
      toolChoice: toolSpecs ? 'auto' : undefined,
    });
    draftText = response.content;

    if (toolLoopEnabled && toolSpecs && activeToolNames.length > 0) {
      const loopStartedAt = Date.now();
      const loopResult = await runToolCallLoop({
        client,
        messages: runtimeMessages,
        registry: scopedToolRegistry,
        ctx: {
          traceId,
          userId,
          channelId,
          guildId,
          apiKey,
          invokerIsAdmin: isAdmin,
          invokedBy,
          routeKind: SINGLE_ROUTE_KIND,
          toolExecutionProfile: 'default',
        } satisfies ToolExecutionContext,
        model,
        apiKey,
        temperature: 0.6,
        timeoutMs: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: normalizeStrictlyPositiveInt(
          appConfig.AGENTIC_TOOL_MAX_OUTPUT_TOKENS as number | undefined,
          1_200,
        ),
        initialAssistantResponseText: response.content,
        config: toolLoopConfig,
      });
      draftText = loopResult.replyText;
      toolResults = loopResult.toolResults;
      const successfulToolCount = loopResult.toolResults.filter((result) => result.success).length;
      toolLoopBudgetJson = {
        enabled: true,
        toolsExecuted: loopResult.toolsExecuted,
        roundsCompleted: loopResult.roundsCompleted,
        toolResultCount: loopResult.toolResults.length,
        successfulToolCount,
        deduplicatedCallCount: loopResult.deduplicatedCallCount ?? 0,
        truncatedCallCount: loopResult.truncatedCallCount ?? 0,
        attachmentCount: loopResult.toolResults.reduce(
          (sum, result) => sum + (result.attachments?.length ?? 0),
          0,
        ),
        latencyMs: Date.now() - loopStartedAt,
      };
    }
  } catch (error) {
    logger.error({ error, traceId }, 'Single-agent runtime call failed');
    draftText = "I'm having trouble connecting right now. Please try again later.";
    toolLoopBudgetJson = {
      enabled: toolLoopEnabled,
      failed: true,
      errorText: error instanceof Error ? error.message : String(error),
    };
  }

  let safeFinalText =
    cleanDraftText(draftText) ??
    'I completed part of the request but could not format a final response. Please ask me to try once more.';
  const githubGroundedMode =
    (appConfig.AGENTIC_TOOL_GITHUB_GROUNDED_MODE as boolean | undefined) ?? true;
  if (githubGroundedMode) {
    const groundingResult = enforceGitHubFileGrounding(safeFinalText, toolResults);
    if (groundingResult.modified) {
      logger.warn(
        {
          traceId,
          ungroundedPaths: groundingResult.ungroundedPaths,
          successfulPaths: groundingResult.successfulPaths,
        },
        'Final response replaced due to ungrounded GitHub file path claims',
      );
      safeFinalText = groundingResult.replyText;
    }
  }

  const files = collectFilesFromToolResults(toolResults);
  const pendingAdminActionIds = collectPendingAdminActionIds(toolResults);
  const budgetJson: Record<string, unknown> = {
    route: SINGLE_ROUTE_KIND,
    model,
    toolLoop: toolLoopBudgetJson,
    promptUserText:
      userText.length <= 6_000 ? userText : `${userText.slice(0, 6_000)}...`,
    promptUserTextTruncated: userText.length > 6_000,
    toolCount: activeToolNames.length,
    attachmentCount: files.length,
  };

  if (appConfig.TRACE_ENABLED) {
    try {
      await updateTraceEnd({
        id: traceId,
        toolJson: {
          enabled: toolLoopEnabled,
          routeTools: activeToolNames,
          main: toolLoopBudgetJson,
        },
        qualityJson: {
          model,
          route: SINGLE_ROUTE_KIND,
        },
        budgetJson,
        agentEventsJson: [
          {
            type: 'runtime_end',
            route: SINGLE_ROUTE_KIND,
            timestamp: new Date().toISOString(),
            details: {
              files: files.length,
              toolResults: toolResults.length,
            },
          },
        ],
        replyText: safeFinalText,
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace end');
    }
  }

  if (safeFinalText.trim() === '[SILENCE]') {
    logger.info({ traceId }, 'Agent chose silence');
    clearToolCaches();
    return {
      replyText: '',
      debug: { messages: runtimeMessages },
      pendingAdminActionIds,
    };
  }

  let cleanedText = safeFinalText;
  if (files.length > 0) {
    const jsonActionRegex = /```(?:json)?\s*\{(?:.|\n)*?"action"\s*:(?:.|\n)*?\}\s*```/yi;
    const rawJsonRegex = /\{(?:.|\n)*?"action"\s*:(?:.|\n)*?\}/yi;
    cleanedText = cleanedText.replace(jsonActionRegex, '').replace(rawJsonRegex, '').trim();
    if (/^\s*\{(?:.|\n)*?\}\s*$/.test(cleanedText)) {
      cleanedText = '';
    }
  }

  clearToolCaches();
  return {
    replyText: cleanedText,
    debug: { messages: runtimeMessages },
    files,
    pendingAdminActionIds,
  };
}

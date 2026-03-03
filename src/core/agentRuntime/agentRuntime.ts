import { config as appConfig } from '../../config';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { getLLMClient } from '../llm';
import { LLMChatMessage, LLMMessageContent } from '../llm/llm-types';
import { getGuildApiKey } from '../settings/guildSettingsRepo';
import { getGuildMemoryText } from '../settings/guildMemoryRepo';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { logger } from '../utils/logger';
import { upsertTraceStart, updateTraceEnd } from './agent-trace-repo';
import { buildContextMessages } from './contextBuilder';
import { runToolCallLoop } from './toolCallLoop';
import { ToolResult } from './toolCallExecution';
import { enforceGitHubFileGrounding } from './toolGrounding';
import { clearGitHubFileLookupCacheForTrace } from './toolIntegrations';
import { DISCORD_GUARDRAILS } from './discordToolCatalog';
import {
  buildAgenticStateBlock,
  buildCapabilityPromptSection,
} from './capabilityPrompt';
import {
  ToolRegistry,
  globalToolRegistry,
  type ToolExecutionContext,
} from './toolRegistry';
import { classifyStyle } from './styleClassifier';
import { formatLiveVoiceContext } from '../voice/voiceConversationSessionStore';

const SINGLE_ROUTE_KIND = 'single';

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
  intent?: string | null;
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
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (Number.isFinite(value) && value !== undefined && value > 0) {
    return Math.max(1, Math.floor(value));
  }
  return fallback;
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
  const hasDiscordTool = toolNames.includes('discord');

  const lines = [
    '<tool_protocol>',
    'You may call tools when they materially improve correctness.',
    '',
    'FORMAT: When calling tools, output ONLY valid JSON:',
    '{"type": "tool_calls", "calls": [{"name": "<tool_name>", "args": {...}}]}',
    '',
    'RULES:',
    '- No markdown wrapping around tool_calls JSON.',
    '- Batch multiple read-only tools in one envelope for parallel execution.',
    '- Never invent tool outputs. If a tool fails, acknowledge and proceed.',
    '- When repo path is unknown: github_search_code first, then github_get_file.',
    '- For large files: use github_get_file with startLine/endLine ranges.',
    '- If github_get_file fails: do NOT claim paths as verified.',
    '- After gathering sufficient data: respond in plain text.',
    '- If no tool is needed, answer normally in plain text.',
  ];

  if (hasDiscordTool) {
    lines.push('');
    lines.push('DISCORD ACTIONS GUIDE:');
    lines.push('- Use `discord` tool with action-based payloads (e.g., memory.get_channel, messages.search_history).');
    lines.push('- memory.get_channel → returns summaries, NOT raw transcript.');
    lines.push('- memory.channel_archives → returns archived weekly summaries, NOT raw messages.');
    lines.push('- messages.search_history → primary tool for exact historical message retrieval.');
    lines.push('- messages.get_context → expands context around a known messageId.');
    // Guardrails injected from single-source-of-truth (discordToolCatalog.ts)
    for (const guardrail of DISCORD_GUARDRAILS) {
      lines.push(`- ${guardrail}`);
    }
  }

  lines.push('</tool_protocol>');

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
    maxRounds: toPositiveInt(
      appConfig.AGENTIC_TOOL_MAX_ROUNDS as number | undefined,
      6,
    ),
    maxCallsPerRound: toPositiveInt(
      appConfig.AGENTIC_TOOL_MAX_CALLS_PER_ROUND as number | undefined,
      5,
    ),
    toolTimeoutMs: toPositiveInt(
      appConfig.AGENTIC_TOOL_TIMEOUT_MS as number | undefined,
      45_000,
    ),
    maxToolResultChars: toPositiveInt(
      appConfig.AGENTIC_TOOL_RESULT_MAX_CHARS as number | undefined,
      8_000,
    ),
    parallelReadOnlyTools:
      (appConfig.AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED as boolean | undefined) ?? true,
    maxParallelReadOnlyTools: toPositiveInt(
      appConfig.AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY as number | undefined,
      4,
    ),
    cacheEnabled: true,
    cacheMaxEntries: 50,
    maxLoopDurationMs: toPositiveInt(
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
    intent,
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

  const style = classifyStyle(userText);

  const voiceInstruction = isVoiceActive
    ? `
<voice_mode>
Your response will be spoken aloud in a Discord voice channel.
- Use natural spoken language.
- Avoid markdown, code fences, tables, and long URLs.
- Keep sentences short and easy to say out loud.
</voice_mode>`
    : undefined;

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

  let guildMemory: string | null = null;
  if (guildId) {
    try {
      guildMemory = await getGuildMemoryText(guildId);
    } catch (error) {
      logger.warn({ error, guildId }, 'Failed to load guild memory (non-fatal)');
    }
  }
  const model = (appConfig.CHAT_MODEL || 'kimi').trim();
  const toolLoopEnabled = (appConfig.AGENTIC_TOOL_LOOP_ENABLED as boolean | undefined) ?? true;
  const toolLoopConfig = buildToolLoopConfig();
  const toolLoopLimits = {
    maxRounds: toolLoopConfig.maxRounds,
    maxCallsPerRound: toolLoopConfig.maxCallsPerRound,
    parallelReadOnlyTools: toolLoopConfig.parallelReadOnlyTools,
    maxParallelReadOnlyTools: toolLoopConfig.maxParallelReadOnlyTools,
  };

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

  const capabilityParams = {
    activeTools: activeToolNames,
    model,
    invokedBy,
    invokerIsAdmin: isAdmin,
    inGuild: guildId !== null,
    toolLoopLimits,
  };

  const runtimeInstruction = [
    buildCapabilityPromptSection(capabilityParams),
    buildAgenticStateBlock(capabilityParams),
    buildToolProtocolInstruction(activeToolNames),
  ].join('\n\n');

  const runtimeMessages = buildContextMessages({
    userProfileSummary: null,
    runtimeInstruction,
    guildMemory,
    channelRollingSummary: null,
    channelProfileSummary: null,
    replyToBotText,
    replyReferenceContent,
    userText,
    userContent,
    recentTranscript: transcriptBlock,
    intentHint: intent,
    style,
    voiceContext: liveVoiceContext,
    contextPackets: null,
    invokedBy,
    voiceInstruction,
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
    const maxTokens = toPositiveInt(
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
        maxTokens: toPositiveInt(
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
          style,
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

  if (safeFinalText.trim().includes('[SILENCE]')) {
    logger.info({ traceId }, 'Agent chose silence');
    clearToolCaches();
    return {
      replyText: '',
      debug: { messages: runtimeMessages },
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
  };
}

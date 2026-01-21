import { config as appConfig } from '../../config';
import { formatSummaryAsText } from '../summary/summarizeChannelWindow';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { getLLMClient } from '../llm';
import { LLMChatMessage, LLMMessageContent, ToolDefinition } from '../llm/types';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { logger } from '../utils/logger';
import { buildContextMessages } from './contextBuilder';
import { globalToolRegistry } from './toolRegistry';
import { runToolCallLoop, ToolCallLoopResult } from './toolCallLoop';
import { getChannelSummaryStore } from '../summary/channelSummaryStoreRegistry';
import { howLongInVoiceToday, whoIsInVoice } from '../voice/voiceQueries';
import { formatHowLongToday, formatWhoInVoice } from '../voice/voiceFormat';
import { classifyStyle } from './styleClassifier';
import { decideRoute } from '../orchestration/router';
import { runExperts } from '../orchestration/runExperts';
// import { governOutput } from '../orchestration/governor';
import { upsertTraceStart, updateTraceEnd } from '../trace/agentTraceRepo';
import { ExpertPacket } from '../orchestration/experts/types';

const GOOGLE_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'google_search',
    description:
      'Search the web for real-time information. Use this whenever the user asks for current facts, news, or topics you do not know.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query string.',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * Define inputs for a single chat turn.
 *
 * Details: includes routing hints, profile summaries, and invocation metadata
 * used to build LLM context and traces.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface RunChatTurnParams {
  traceId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  messageId: string;
  userText: string;
  userContent?: LLMMessageContent;
  userProfileSummary: string | null;
  replyToBotText: string | null;
  replyReferenceContent?: LLMMessageContent | null;
  intent?: string | null;
  mentionedUserIds?: string[];
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
}

/**
 * Describe the outcome of a chat turn.
 *
 * Details: includes the reply text and optional debug metadata.
 *
 * Side effects: none.
 * Error behavior: none.
 */
export interface RunChatTurnResult {
  replyText: string;
  debug?: {
    toolsExecuted?: boolean;
    toolLoopResult?: ToolCallLoopResult;
    messages?: LLMChatMessage[];
  };
}

/**
 * Run a single chat turn through the agent runtime.
 *
 * Details: routes the request, gathers expert packets, builds context, and
 * executes LLM calls with optional tool usage.
 *
 * Side effects: performs LLM calls, DB reads/writes for traces, and may execute
 * tools with their own side effects.
 * Error behavior: catches and logs non-fatal errors; returns fallback text when
 * the LLM call fails.
 *
 * @param params - Inputs for the chat turn and routing context.
 * @returns Reply text and optional debug metadata.
 */
export async function runChatTurn(params: RunChatTurnParams): Promise<RunChatTurnResult> {
  const {
    traceId,
    userId,
    channelId,
    guildId,
    userText,
    userContent,
    userProfileSummary,
    replyToBotText,
    replyReferenceContent,
    intent,
    mentionedUserIds,
    invokedBy = 'mention',
  } = params;

  const normalizedText = userText.toLowerCase();
  const isWhoInVoice =
    /\bwho('?s| is)? in voice\b/.test(normalizedText) || /\bwho in voice\b/.test(normalizedText);
  const isHowLongToday =
    /\bhow long\b.*\bvoice today\b/.test(normalizedText) ||
    /\btime in voice today\b/.test(normalizedText);

  if ((isWhoInVoice || isHowLongToday) && guildId) {
    try {
      if (isWhoInVoice) {
        const presence = await whoIsInVoice({ guildId });
        return { replyText: formatWhoInVoice(presence) };
      }

      const targetUserId = mentionedUserIds?.[0] ?? userId;
      const result = await howLongInVoiceToday({ guildId, userId: targetUserId });
      return { replyText: formatHowLongToday({ userId: targetUserId, ms: result.ms }) };
    } catch (error) {
      logger.warn({ error, guildId, userId }, 'Voice fast-path failed, falling back to router');
    }
  }

  const route = decideRoute({
    userText,
    invokedBy,
    hasGuild: !!guildId,
  });

  logger.debug({ traceId, route }, 'Router decision');

  let expertPackets: ExpertPacket[] = [];
  try {
    expertPackets = await runExperts({
      experts: route.experts,
      guildId,
      channelId,
      userId,
      traceId,
      skipMemory: !!userProfileSummary,
    });
  } catch (err) {
    logger.warn({ error: err, traceId }, 'Failed to run experts (non-fatal)');
  }

  const expertPacketsText = expertPackets.map((p) => `[${p.name}] ${p.content}`).join('\n\n');

  if (appConfig.TRACE_ENABLED) {
    try {
      await upsertTraceStart({
        id: traceId,
        guildId,
        channelId,
        userId,
        routeKind: route.kind,
        routerJson: route,
        expertsJson: expertPackets.map((p) => ({ name: p.name, json: p.json })),
        tokenJson: {},
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace start');
    }
  }

  let recentTranscript: string | null = null;
  let rollingSummaryText: string | null = null;
  let profileSummaryText: string | null = null;
  let relationshipHintsText: string | null = null;

  if (guildId && isLoggingEnabled(guildId, channelId)) {
    const recentMessages = getRecentMessages({
      guildId,
      channelId,
      limit: appConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES,
    });

    recentTranscript = buildTranscriptBlock(recentMessages, appConfig.CONTEXT_TRANSCRIPT_MAX_CHARS);

    try {
      const summaryStore = getChannelSummaryStore();
      const [rollingSummary, profileSummary] = await Promise.all([
        summaryStore.getLatestSummary({
          guildId,
          channelId,
          kind: 'rolling',
        }),
        summaryStore.getLatestSummary({
          guildId,
          channelId,
          kind: 'profile',
        }),
      ]);


      if (rollingSummary) {
        rollingSummaryText = `Channel rolling summary (last ${appConfig.SUMMARY_ROLLING_WINDOW_MIN}m):\n${formatSummaryAsText({
          ...rollingSummary,
          topics: rollingSummary.topics ?? [],
          threads: rollingSummary.threads ?? [],
          unresolved: rollingSummary.unresolved ?? [],
          decisions: rollingSummary.decisions ?? [],
          actionItems: rollingSummary.actionItems ?? [],
          glossary: rollingSummary.glossary ?? {},
        })}`;
      }

      if (profileSummary) {
        profileSummaryText = `Channel profile (long-term):\n${formatSummaryAsText({
          ...profileSummary,
          topics: profileSummary.topics ?? [],
          threads: profileSummary.threads ?? [],
          unresolved: profileSummary.unresolved ?? [],
          decisions: profileSummary.decisions ?? [],
          actionItems: profileSummary.actionItems ?? [],
          glossary: profileSummary.glossary ?? {},
        })}`;
      }
    } catch (error) {
      logger.warn({ error, guildId, channelId }, 'Failed to load channel summaries (non-fatal)');
    }

    try {
      const { renderRelationshipHints } =
        await import('../relationships/relationshipHintsRenderer');
      relationshipHintsText = await renderRelationshipHints({
        guildId,
        userId,
        maxEdges: appConfig.RELATIONSHIP_HINTS_MAX_EDGES,
        maxChars: 1200,
      });
    } catch (error) {
      logger.warn({ error, guildId, userId }, 'Failed to load relationship hints (non-fatal)');
    }
  }

  const style = classifyStyle(userText);
  const messages = buildContextMessages({
    userProfileSummary,
    replyToBotText,
    replyReferenceContent,
    userText,
    userContent,
    recentTranscript,
    channelRollingSummary: rollingSummaryText,
    channelProfileSummary: profileSummaryText,
    intentHint: intent ?? null,
    relationshipHints: relationshipHintsText,
    style,
    expertPackets: expertPacketsText || null,
    invokedBy,
  });

  logger.debug(
    { traceId, route, expertCount: expertPackets.length },
    'Agent runtime: built context with experts',
  );

  const client = getLLMClient();

  const nativeTools: ToolDefinition[] = [];
  if (route.allowTools) {
    nativeTools.push(GOOGLE_SEARCH_TOOL);
  }

  let draftText = '';
  let toolsExecuted = false;
  try {
    const response = await client.chat({
      messages,
      tools: nativeTools.length > 0 ? nativeTools : undefined,
      toolChoice: nativeTools.length > 0 ? 'auto' : undefined,
      temperature: route.temperature,
      timeout: appConfig.TIMEOUT_CHAT_MS, // Fail fast for chat
    });

    draftText = response.content;

    if (route.allowTools && globalToolRegistry.listNames().length > 0) {
      const trimmed = draftText.trim();
      const strippedFence = trimmed.startsWith('```')
        ? trimmed.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '')
        : trimmed;

      try {
        const parsed = JSON.parse(strippedFence);
        if (parsed?.type === 'tool_calls' && Array.isArray(parsed?.calls)) {
          logger.debug({ traceId }, 'Tool calls detected, running loop');

          const toolLoopResult = await runToolCallLoop({
            client,
            messages,
            registry: globalToolRegistry,
            ctx: { traceId, userId, channelId },
          });

          draftText = toolLoopResult.replyText;
          toolsExecuted = true;
        }
      } catch (_error) {
        void _error;
      }
    }
  } catch (err) {
    logger.error({ error: err, traceId }, 'LLM call error');
    draftText = "I'm having trouble connecting right now. Please try again later.";
  }

  const finalText = draftText;
  const governorResult = {
    finalText,
    actions: [],
    flagged: false,
  };

  if (appConfig.TRACE_ENABLED) {
    try {
      await updateTraceEnd({
        id: traceId,
        toolJson: toolsExecuted ? { executed: true } : undefined,
        replyText: finalText,
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace end');
    }
  }

  logger.debug({ traceId }, 'Chat turn complete');

  if (governorResult.finalText.trim().includes('[SILENCE]')) {
    logger.info({ traceId }, 'Agent chose silence');
    return {
      replyText: '',
      debug: { messages, toolsExecuted },
    };
  }

  return {
    replyText: governorResult.finalText,
    debug: { messages, toolsExecuted },
  };
}

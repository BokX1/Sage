import { config as appConfig } from '../../config';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { getLLMClient } from '../llm';
import { LLMChatMessage, ToolDefinition } from '../llm/types';
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

/**
 * Google Search tool definition for OpenAI/Pollinations format.
 * Kept here to match existing chatEngine behavior.
 */
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

export interface RunChatTurnParams {
  traceId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  messageId: string;
  userText: string;
  /** User profile summary for personalization */
  userProfileSummary: string | null;
  /** Previous bot message if user is replying to bot */
  replyToBotText: string | null;
  /** Optional intent hint from invocation detection */
  intent?: string | null;
  mentionedUserIds?: string[];
  /** Invocation method for router */
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'command';
}

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
 * This is the main orchestration entrypoint.
 *
 * Flow (D9):
 * 1. Router classifies intent
 * 2. Run expert queries (cheap DB lookups)
 * 3. Persist trace start
 * 4. Build context with expert packets
 * 5. Call LLM (single call by default)
 * 6. Run governor (post-process safety)
 * 7. Persist trace end
 * 8. Return governed reply
 */
export async function runChatTurn(params: RunChatTurnParams): Promise<RunChatTurnResult> {
  const {
    traceId,
    userId,
    channelId,
    guildId,
    userText,
    userProfileSummary,
    replyToBotText,
    intent,
    mentionedUserIds,
    invokedBy = 'mention',
  } = params;

  // Voice fast-path: Answer simple voice queries without routing/LLM
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

  // D9: Step 1 - Router classifies intent
  const route = decideRoute({
    userText,
    invokedBy,
    hasGuild: !!guildId,
  });

  logger.debug({ traceId, route }, 'Router decision');

  // D9: Step 2 - Run experts (cheap DB queries)
  // D9: Step 2 - Run experts (cheap DB queries)
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

  // D9: Step 3 - Persist trace start
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
        rollingSummaryText = `Channel rolling summary (last ${appConfig.SUMMARY_ROLLING_WINDOW_MIN}m): ${rollingSummary.summaryText}`;
      }

      if (profileSummary) {
        profileSummaryText = `Channel profile (long-term): ${profileSummary.summaryText}`;
      }
    } catch (error) {
      logger.warn({ error, guildId, channelId }, 'Failed to load channel summaries (non-fatal)');
    }

    // Compute relationship hints (D7)
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

  // D9: Step 4 - Build context with expert packets
  const style = classifyStyle(userText);
  const messages = buildContextMessages({
    userProfileSummary,
    replyToBotText,
    userText,
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

  // D9: Step 5 - Call LLM with route temperature
  const client = getLLMClient();

  // Build native search tools if route allows (Pollinations format)
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

    // Check if response is a tool_calls envelope for custom tools
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
      } catch {
        // Not JSON, treat as normal response
      }
    }
  } catch (err) {
    logger.error({ error: err, traceId }, 'LLM call error');
    draftText = "I'm having trouble connecting right now. Please try again later.";
  }

  // D9: Step 6 - Removed Governor (User request)
  const finalText = draftText;
  const governorResult = {
    finalText,
    actions: [],
    flagged: false,
  };

  // D9: Step 7 - Persist trace end
  if (appConfig.TRACE_ENABLED) {
    try {
      await updateTraceEnd({
        id: traceId,
        // governorJson removed
        toolJson: toolsExecuted ? { executed: true } : undefined,
        replyText: finalText,
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace end');
    }
  }

  logger.debug({ traceId }, 'Chat turn complete');

  // Check for Silence Protocol
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

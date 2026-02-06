/**
 * Orchestrate a single end-to-end chat turn.
 *
 * Responsibilities:
 * - Route the request, gather context, and call the LLM.
 * - Execute expert fan-out and optional tool-call follow-up.
 * - Return reply text plus optional attachments and diagnostics.
 *
 * Non-goals:
 * - Persist long-term memory directly.
 * - Implement provider-specific request formatting.
 */
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
import { classifyStyle, analyzeUserStyle } from './styleClassifier';
import { decideRoute } from '../orchestration/llmRouter';
import { runExperts } from '../orchestration/runExperts';
import { upsertTraceStart, updateTraceEnd } from '../trace/agentTraceRepo';
import { ExpertPacket } from '../orchestration/experts/types';
import { resolveModelForRequest } from '../llm/modelResolver';
import { getGuildApiKey } from '../settings/guildSettingsRepo';
import { getWelcomeMessage } from '../../bot/handlers/welcomeMessage';

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

/** Execute one chat turn using routing, context, and tool follow-up metadata. */
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
  isVoiceActive?: boolean;
}

/** Return payload for a completed chat turn. */
export interface RunChatTurnResult {
  replyText: string;
  styleHint?: string;
  voice?: string;
  debug?: {
    toolsExecuted?: boolean;
    toolLoopResult?: ToolCallLoopResult;
    messages?: LLMChatMessage[];
  };
  files?: Array<{
    attachment: Buffer;
    name: string;
  }>;
}

function selectVoicePersona(text: string, profile: string | null): string {
  const t = (text + (profile || '')).toLowerCase();

  if (/(david attenborough|narrator|deep voice|male|boy|man|guy)/.test(t)) return 'onyx';
  if (/(girl|female|woman|crush|sister|mom|aunt|gf|girlfriend)/.test(t)) return 'nova';
  if (/(energetic|excited|sparkly|anime)/.test(t)) return 'shimmer';
  if (/(serious|news|anchor)/.test(t)) return 'echo';

  return 'alloy';
}

/**
 * Run the full runtime pipeline for one inbound user message.
 *
 * @param params - Turn metadata, user content, and optional invocation hints.
 * @returns Reply text plus optional files and debug payload.
 *
 * Side effects:
 * - Reads channel memory buffers and summary stores.
 * - Calls routing experts and the configured LLM provider.
 * - Persists trace records when tracing is enabled.
 *
 * Error behavior:
 * - Non-critical fetch and expert failures are logged and execution continues.
 * - LLM call failures return a fallback user-facing message.
 *
 * Invariants:
 * - Input context never exceeds the configured token budget after context building.
 * - BYOP-gated guilds return a welcome prompt when no API key is available.
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
    isVoiceActive,
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

  let conversationHistory: LLMChatMessage[] = [];
  if (guildId && isLoggingEnabled(guildId, channelId)) {
    const recentMsgs = getRecentMessages({ guildId, channelId, limit: 15 });
    conversationHistory = recentMsgs.map((m) => ({
      role: (m.authorId === 'bot' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));
  }

  const guildApiKey = guildId ? await getGuildApiKey(guildId) : undefined;
  const apiKey = guildApiKey ?? appConfig.POLLINATIONS_API_KEY;
  const route = await decideRoute({ userText, invokedBy, hasGuild: !!guildId, conversationHistory, apiKey });

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
      userText,
      userContent,
      replyReferenceContent,
      conversationHistory,
      apiKey,
    });
  } catch (err) {
    logger.warn({ error: err, traceId }, 'Failed to run experts (non-fatal)');
  }

  const files: Array<{ attachment: Buffer; name: string }> = [];
  for (const packet of expertPackets) {
    if (packet.binary) {
      files.push({ attachment: packet.binary.data, name: packet.binary.filename });
    }
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
        reasoningText: route.reasoningText,
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
        summaryStore.getLatestSummary({ guildId, channelId, kind: 'rolling' }),
        summaryStore.getLatestSummary({ guildId, channelId, kind: 'profile' }),
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
      const { renderRelationshipHints } = await import('../relationships/relationshipHintsRenderer');
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

  let voice = 'alloy';
  let voiceInstruction = '';

  if (isVoiceActive) {
    voice = selectVoicePersona(userText, userProfileSummary);
    voiceInstruction = `\n[VOICE MODE ACTIVE]
Your response will be spoken aloud by a TTS model (${voice} voice).
- Write for the ear, not the eye.
- Avoid markdown, links, or visual formatting.
- Adopt the persona implied by the requested voice (e.g. if 'onyx', be deep/narrative; if 'nova', be energetic/feminine).
- You are NARRATING this response.`;
  }

  const style = classifyStyle(userText);
  const userHistory = conversationHistory
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : ''));
  const styleMimicry = analyzeUserStyle([...userHistory, userText]);

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
    voiceInstruction,
  });

  logger.debug(
    { traceId, route, expertCount: expertPackets.length },
    'Agent runtime: built context with experts',
  );

  const client = getLLMClient();

  if (guildId && !apiKey) {
    return {
      replyText: getWelcomeMessage(),
    };
  }

  const nativeTools: ToolDefinition[] = [];
  if (route.allowTools) {
    nativeTools.push(GOOGLE_SEARCH_TOOL);
  }

  let draftText = '';
  let toolsExecuted = false;
  try {
    const resolvedModel = await resolveModelForRequest({
      guildId,
      messages,
      featureFlags: {
        tools: nativeTools.length > 0,
      },
    });

    const response = await client.chat({
      messages,
      model: resolvedModel,
      apiKey,
      tools: nativeTools.length > 0 ? nativeTools : undefined,
      toolChoice: nativeTools.length > 0 ? 'auto' : undefined,
      temperature: route.temperature,
      timeout: appConfig.TIMEOUT_CHAT_MS,
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
            apiKey,
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

  if (finalText.trim().includes('[SILENCE]')) {
    logger.info({ traceId }, 'Agent chose silence');
    return {
      replyText: '',
      debug: { messages, toolsExecuted },
    };
  }

  let cleanedText = finalText;
  if (files.length > 0) {
    const jsonActionRegex = /```(?:json)?\s*\{(?:.|\n)*?"action"\s*:(?:.|\n)*?\}\s*```/yi;
    const rawJsonRegex = /\{(?:.|\n)*?"action"\s*:(?:.|\n)*?\}/yi;

    cleanedText = cleanedText.replace(jsonActionRegex, '').replace(rawJsonRegex, '').trim();

    if (/^\s*\{(?:.|\n)*?\}\s*$/.test(cleanedText)) {
      cleanedText = '';
    }
  }

  return {
    replyText: cleanedText,
    styleHint: styleMimicry,
    voice,
    debug: { messages, toolsExecuted },
    files,
  };
}

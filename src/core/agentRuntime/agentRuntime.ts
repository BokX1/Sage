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
import { getLLMClient, createLLMClient } from '../llm';
import { LLMChatMessage, LLMMessageContent, ToolDefinition } from '../llm/llm-types';
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
// import { governOutput } from '../orchestration/governor';
import { upsertTraceStart, updateTraceEnd } from './agent-trace-repo';
import { ExpertPacket } from '../orchestration/experts/expert-types';
import { resolveModelForRequest } from '../llm/model-resolver';
import { getGuildApiKey } from '../settings/guildSettingsRepo';
import { getWelcomeMessage } from '../../bot/handlers/welcomeMessage';

// GOOGLE_SEARCH_TOOL removed


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
  const apiKey = guildApiKey ?? appConfig.LLM_API_KEY;

  const route = await decideRoute({
    userText,
    invokedBy,
    hasGuild: !!guildId,
    conversationHistory,
    replyReferenceContent: typeof replyReferenceContent === 'string' ? replyReferenceContent : null,
    apiKey,
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


  let draftText = '';
  let toolsExecuted = false;

  // --- SEARCH-AUGMENTED GENERATION (SAG) ---
  if (route.kind === 'search') {
    logger.info({ traceId, userText }, 'Agent Runtime: Executing Search-Augmented Generation');
    try {
      // 1. Search Query
      // Use perplexity-reasoning to get raw facts/reasoning
      const searchClient = createLLMClient('pollinations', { chatModel: 'perplexity-reasoning' });

      // Build context-aware messages for search
      // 1. Reply Context (if any)
      const searchMessages: LLMChatMessage[] = [];
      if (replyReferenceContent) {
        const replyContent = typeof replyReferenceContent === 'string'
          ? replyReferenceContent
          : '[Media/Complex Content]';
        searchMessages.push({
          role: 'system',
          content: `CONTEXT: The user is replying to the following message:\n"${replyContent}"`
        });
      }

      // 2. Conversation History (Last 5 messages)
      if (conversationHistory.length > 0) {
        // Take last 5
        const historySlice = conversationHistory.slice(-5);
        searchMessages.push(...historySlice);
      }

      // 3. Current User Message
      searchMessages.push({ role: 'user', content: userText });

      const searchResponse = await searchClient.chat({
        messages: searchMessages,
        model: 'perplexity-reasoning',
        apiKey: apiKey, // Pass API key if available/needed
        timeout: 120_000, // Increased to 2 minutes for deep reasoning
      });

      const searchResultContent = searchResponse.content;

      // 2. Inject Context for Synthesis
      // Add a high-priority system block with the search results
      // This ensures the main model is "aware" of the external info.
      const searchContextBlock: LLMChatMessage = {
        role: 'system',
        content: `## SEARCH RESULTS (Real-time data from Perplexity)\n\n${searchResultContent}\n\n## SYSTEM INSTRUCTION\nYou have access to the above real-time search data. Use it to answer the user's question naturally, maintaining your persona. Do not mention "Perplexity" explicitly unless asked.`
      };

      // Insert it right after the main system prompt (index 1) or at the end of system blocks
      // For simplicity, we stick it at the end of the message list logic below, 
      // BUT `messages` is already built. We need to inject it into `messages`.

      // Find the last system message to append to, or just insert as a new system message before the user message.
      // `messages` order: [System, System?, ..., User]
      // We insert before the last message (User).
      const lastMsgIndex = messages.length - 1;
      if (lastMsgIndex >= 0) {
        messages.splice(lastMsgIndex, 0, searchContextBlock);
      } else {
        messages.push(searchContextBlock);
      }

    } catch (searchError) {
      logger.error({ error: searchError, traceId }, 'SAG: Search step failed');
      // Fallback: Continue to normal chat, maybe the model knows enough or will halluciante slightly less.
      // Or inject a failure note?
      messages.splice(messages.length - 1, 0, {
        role: 'system',
        content: '## SEARCH STATUS\nSearch attempt failed. Please answer based on internal knowledge only.'
      });
    }
  }

  // --- STANDARD CHAT COMPLETION ---
  try {
    const resolvedModel = await resolveModelForRequest({
      guildId,
      messages,
      route: route.kind, // Pass the route decision (used for logging/metrics logic mainly now)
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

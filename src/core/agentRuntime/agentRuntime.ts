/**
 * Orchestrate a single end-to-end chat turn.
 *
 * Responsibilities:
 * - Route the request to an Agent, gather context via Providers, and call the LLM.
 * - Execute context fan-out and optional tool-call follow-up.
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
import { LLMChatMessage, LLMMessageContent } from '../llm/llm-types';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { logger } from '../utils/logger';
import { buildContextMessages } from './contextBuilder';
import { globalToolRegistry } from './toolRegistry';
import { runToolCallLoop, ToolCallLoopResult } from './toolCallLoop';
import { getChannelSummaryStore } from '../summary/channelSummaryStoreRegistry';

import { classifyStyle, analyzeUserStyle } from './styleClassifier';
import { decideAgent, SearchExecutionMode } from '../orchestration/agentSelector';
import { runContextProviders } from '../context/runContext';
import { replaceAgentRuns, upsertTraceStart, updateTraceEnd } from './agent-trace-repo';
import { ContextPacket, ContextProviderName } from '../context/context-types';
import { resolveModelForRequestDetailed } from '../llm/model-resolver';
import { recordModelOutcome } from '../llm/model-health';
import { getGuildApiKey } from '../settings/guildSettingsRepo';
import { getWelcomeMessage } from '../../bot/handlers/welcomeMessage';
import { buildContextGraph, getStandardProvidersForAgent } from './graphBuilder';
import { executeAgentGraph } from './graphExecutor';
import { renderContextPacketContext } from './blackboard';
import { evaluateDraftWithCritic } from './criticAgent';
import {
  normalizeCriticConfig,
  shouldRefreshSearchFromCritic,
  shouldRequestRevision,
  shouldRunCritic,
} from './qualityPolicy';
import { evaluateToolPolicy, parseToolBlocklistCsv } from './toolPolicy';
import { resolveTenantPolicy } from './tenantPolicy';
import {
  evaluateAgenticCanary,
  getAgenticCanarySnapshot,
  normalizeCanaryConfig,
  parseRouteAllowlistCsv,
  recordAgenticOutcome,
} from './canaryPolicy';
import { runImageGenAction } from '../actions/imageGenAction';
import { parseToolCallEnvelope } from './toolCallParser';
import {
  buildToolIntentReason,
  buildVerificationToolNames,
  deriveVerificationIntent,
  stripToolEnvelopeDraft,
  VerificationIntent,
} from './toolVerification';
import { buildCapabilityPromptSection, RuntimeCapabilityTool } from './capabilityPrompt';


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
    // mentionedUserIds,
    invokedBy = 'mention',
    isVoiceActive,
  } = params;

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

  const tenantPolicy = resolveTenantPolicy({
    guildId,
    policyJson: appConfig.AGENTIC_TENANT_POLICY_JSON,
  });
  const effectiveGraphMaxParallel = tenantPolicy.maxParallel ?? appConfig.AGENTIC_GRAPH_MAX_PARALLEL;
  const effectiveGraphParallelEnabled =
    appConfig.AGENTIC_GRAPH_PARALLEL_ENABLED && effectiveGraphMaxParallel > 1;
  const effectiveToolAllowExternalWrite =
    tenantPolicy.toolAllowExternalWrite ?? appConfig.AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE;
  const effectiveToolAllowHighRisk =
    tenantPolicy.toolAllowHighRisk ?? appConfig.AGENTIC_TOOL_ALLOW_HIGH_RISK;
  const effectiveToolBlockedTools = Array.from(
    new Set([
      ...parseToolBlocklistCsv(appConfig.AGENTIC_TOOL_BLOCKLIST_CSV),
      ...(tenantPolicy.toolBlockedTools ?? []),
    ]),
  );
  const criticConfig = normalizeCriticConfig({
    enabled: tenantPolicy.criticEnabled ?? appConfig.AGENTIC_CRITIC_ENABLED,
    maxLoops: tenantPolicy.criticMaxLoops ?? appConfig.AGENTIC_CRITIC_MAX_LOOPS,
    minScore: tenantPolicy.criticMinScore ?? appConfig.AGENTIC_CRITIC_MIN_SCORE,
  });
  const canaryConfig = normalizeCanaryConfig({
    enabled: appConfig.AGENTIC_CANARY_ENABLED,
    rolloutPercent: appConfig.AGENTIC_CANARY_PERCENT,
    routeAllowlist: parseRouteAllowlistCsv(appConfig.AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV),
    maxFailureRate: appConfig.AGENTIC_CANARY_MAX_FAILURE_RATE,
    minSamples: appConfig.AGENTIC_CANARY_MIN_SAMPLES,
    cooldownMs: appConfig.AGENTIC_CANARY_COOLDOWN_SEC * 1000,
    windowSize: appConfig.AGENTIC_CANARY_WINDOW_SIZE,
  });

  // Extract text from replyReferenceContent for router (it can be string or LLMContentPart[])
  const extractReplyText = (content: LLMMessageContent | null | undefined): string | null => {
    if (!content) return null;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const textParts = content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text);
      return textParts.length > 0 ? textParts.join('\n') : null;
    }
    return null;
  };

  const agentDecision = await decideAgent({
    userText,
    invokedBy,
    hasGuild: !!guildId,
    conversationHistory,
    replyReferenceContent: extractReplyText(replyReferenceContent),
    apiKey,
  });

  logger.debug({ traceId, agentDecision }, 'Agent Selector decision');

  let contextPackets: ContextPacket[] = [];
  let contextPacketsText = '';
  let agentGraphJson: unknown = null;
  let agentEventsJson: unknown = [];
  let budgetJson: Record<string, unknown> = {};
  let agentRunRows: Array<{
    traceId: string;
    nodeId: string;
    agent: string;
    status: string;
    attempts: number;
    startedAt: string;
    finishedAt: string | null;
    latencyMs: number | null;
    errorText: string | null;
    metadataJson?: Record<string, unknown>;
  }> = [];
  const canaryDecision = evaluateAgenticCanary({
    traceId,
    guildId,
    routeKind: agentDecision.kind,
    config: canaryConfig,
  });

  const buildCanaryEvent = () => ({
    type: 'canary_decision',
    reason: canaryDecision.reason,
    allowAgentic: canaryDecision.allowAgentic,
    samplePercent: canaryDecision.samplePercent ?? null,
    timestamp: new Date().toISOString(),
  });

  const runLegacyProviders = async (params: { mode: string; reason: string; eventType: string }) => {
    try {
      contextPackets = await runContextProviders({
        providers: agentDecision.contextProviders ?? getStandardProvidersForAgent(agentDecision.kind),
        guildId,
        channelId,
        userId,
        traceId,
        skipMemory: !!userProfileSummary,
      });
      budgetJson = {
        mode: params.mode,
        providerCount: contextPackets.length,
        canaryDecision,
      };
      agentEventsJson = [
        buildCanaryEvent(),
        {
          type: params.eventType,
          reason: params.reason,
          timestamp: new Date().toISOString(),
        },
      ];
    } catch (fallbackError) {
      logger.warn({ error: fallbackError, traceId }, 'Failed to run context providers (non-fatal)');
      contextPackets = [];
      budgetJson = {
        mode: 'provider_runner_failed',
        canaryDecision,
      };
      agentEventsJson = [
        buildCanaryEvent(),
        {
          type: 'graph_fallback_failed',
          reason: String(fallbackError),
          timestamp: new Date().toISOString(),
        },
      ];
    }
  };

  if (canaryDecision.allowAgentic) {
    try {
      const graph = buildContextGraph({
        agentKind: agentDecision.kind,
        providers: agentDecision.contextProviders,
        skipMemory: !!userProfileSummary,
        enableParallel: effectiveGraphParallelEnabled,
      });
      agentGraphJson = graph;

      const graphExecution = await executeAgentGraph({
        traceId,
        graph,
        guildId,
        channelId,
        userId,
        userText,
        userContent,
        replyReferenceContent,
        conversationHistory,
        apiKey,
        maxParallel: effectiveGraphMaxParallel,
      });
      recordAgenticOutcome({
        success: true,
        config: canaryConfig,
      });

      contextPackets = graphExecution.packets;
      agentEventsJson = [buildCanaryEvent(), ...graphExecution.events];
      agentRunRows = graphExecution.nodeRuns;
      contextPacketsText = renderContextPacketContext(graphExecution.blackboard);
      budgetJson = {
        graphNodes: graph.nodes.length,
        graphEdges: graph.edges.length,
        completedTasks: graphExecution.blackboard.counters.completedTasks,
        failedTasks: graphExecution.blackboard.counters.failedTasks,
        artifactCount: graphExecution.blackboard.artifacts.length,
        estimatedArtifactTokens: graphExecution.blackboard.counters.totalEstimatedTokens,
        graphParallelEnabled: effectiveGraphParallelEnabled,
        graphMaxParallel: effectiveGraphMaxParallel,
        canaryDecision,
      };
    } catch (err) {
      recordAgenticOutcome({
        success: false,
        config: canaryConfig,
      });
      logger.warn({ error: err, traceId }, 'Agent graph execution failed; falling back to legacy providers');
      await runLegacyProviders({
        mode: 'legacy_provider_runner',
        reason: String(err),
        eventType: 'graph_fallback',
      });
    }
  } else {
    await runLegacyProviders({
      mode: 'canary_legacy_runner',
      reason: `Agentic graph skipped: ${canaryDecision.reason}`,
      eventType: 'canary_skipped',
    });
  }

  if (!contextPacketsText) {
    contextPacketsText = contextPackets.map((p) => `[${p.name}] ${p.content}`).join('\n\n');
  }

  const files: Array<{ attachment: Buffer; name: string }> = [];
  for (const packet of contextPackets) {
    if (packet.binary) {
      files.push({ attachment: packet.binary.data, name: packet.binary.filename });
    }
  }
  let creativeTracePacket: { name: string; json?: unknown } | null = null;

  // --- SPECIAL HANDLING: Creative Agent (Image Generation) ---
  if (agentDecision.kind === 'creative' && !(guildId && !apiKey)) {
    try {
      const imageResult = await runImageGenAction({
        userText,
        userContent,
        replyReferenceContent,
        conversationHistory,
        apiKey,
      });

      creativeTracePacket = {
        name: imageResult.name,
        json: imageResult.json,
      };
      const imageActionContext = `[${imageResult.name}] ${imageResult.content}`;
      contextPacketsText = contextPacketsText
        ? `${contextPacketsText}\n\n${imageActionContext}`
        : imageActionContext;

      if (imageResult.binary) {
        files.push({
          attachment: imageResult.binary.data,
          name: imageResult.binary.filename,
        });
      }
    } catch (error) {
      logger.error({ error, traceId }, 'Creative action failed');
    }
  }


  if (appConfig.TRACE_ENABLED) {
    try {
      await upsertTraceStart({
        id: traceId,
        guildId,
        channelId,
        userId,
        routeKind: agentDecision.kind,
        routerJson: agentDecision,
        expertsJson: [
          ...contextPackets.map((p) => ({ name: p.name, json: p.json })),
          ...(creativeTracePacket ? [creativeTracePacket] : []),
        ],
        tokenJson: budgetJson,
        reasoningText: agentDecision.reasoningText,
        agentGraphJson,
        agentEventsJson,
        budgetJson,
      });

      if (agentRunRows.length > 0) {
        await replaceAgentRuns(traceId, agentRunRows);
      }
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace start');
    }
  }

  let recentTranscript: string | null = null;
  let rollingSummaryText: string | null = null;
  let profileSummaryText: string | null = null;

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
  const searchExecutionMode: SearchExecutionMode | null =
    agentDecision.kind === 'search'
      ? agentDecision.searchMode ?? 'complex'
      : null;

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
    style,
    contextPackets: contextPacketsText || null,
    invokedBy,
    voiceInstruction,
  });
  const registeredToolSpecs = globalToolRegistry.listOpenAIToolSpecs();
  const registeredTools: RuntimeCapabilityTool[] = registeredToolSpecs.map((toolSpec) => ({
    name: toolSpec.function.name,
    description: toolSpec.function.description,
  }));
  const toolPolicyForPrompt = {
    allowExternalWrite: !!effectiveToolAllowExternalWrite,
    allowHighRisk: !!effectiveToolAllowHighRisk,
    blockedTools: effectiveToolBlockedTools,
  };
  const usableRegisteredTools: RuntimeCapabilityTool[] = agentDecision.allowTools
    ? registeredTools.filter((tool) => evaluateToolPolicy(tool.name, toolPolicyForPrompt).allow)
    : [];
  const registeredToolNames = usableRegisteredTools.map((tool) => tool.name);
  const activeContextProviders =
    agentDecision.contextProviders ?? getStandardProvidersForAgent(agentDecision.kind);
  const virtualVerificationToolNames = buildVerificationToolNames(agentDecision.kind);
  const advertisedToolNames = Array.from(
    new Set([...registeredToolNames, ...virtualVerificationToolNames]),
  );
  const capabilityInstruction = buildCapabilityPromptSection({
    routeKind: agentDecision.kind,
    searchMode: searchExecutionMode,
    allowTools: agentDecision.allowTools,
    contextProviders: activeContextProviders,
    tools: usableRegisteredTools,
    verificationTools: virtualVerificationToolNames,
  });
  const shouldUseToolProtocol = agentDecision.allowTools && advertisedToolNames.length > 0;
  const toolProtocolInstruction = shouldUseToolProtocol
    ? 'Tool protocol: if verification or tool assistance is needed, output ONLY valid JSON in this exact shape:\n' +
      '{\n' +
      '  "type": "tool_calls",\n' +
      '  "calls": [{ "name": "<tool_name>", "args": { ... } }]\n' +
      '}\n' +
      'If no tool is needed, answer normally.\n' +
      `Available tools: ${advertisedToolNames.join(', ')}.`
    : null;
  const runtimeInstructionBlocks = [capabilityInstruction, toolProtocolInstruction]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');
  let runtimeMessages: LLMChatMessage[] = messages;
  if (
    runtimeInstructionBlocks &&
    messages.length > 0 &&
    messages[0].role === 'system' &&
    typeof messages[0].content === 'string'
  ) {
    runtimeMessages = [
      {
        ...messages[0],
        content: `${messages[0].content}\n\n${runtimeInstructionBlocks}`,
      },
      ...messages.slice(1),
    ];
  } else if (runtimeInstructionBlocks) {
    runtimeMessages = [...messages, { role: 'system' as const, content: runtimeInstructionBlocks }];
  }

  logger.debug(
    { traceId, agentDecision, contextProviderCount: contextPackets.length },
    'Agent runtime: built context with providers',
  );

  const client = getLLMClient();

  if (guildId && !apiKey) {
    return {
      replyText: getWelcomeMessage(),
    };
  }

  let draftText = '';
  let toolsExecuted = false;
  let latestToolLoopResult: ToolCallLoopResult | undefined;
  const modelResolutionEvents: Array<Record<string, unknown>> = [];
  const toolVerificationRedispatches: Array<Record<string, unknown>> = [];
  const runSearchPass = async (params: {
    phase: string;
    iteration?: number;
    revisionInstruction?: string;
    priorDraft?: string;
    allowToolEnvelope?: boolean;
  }): Promise<string> => {
    const contextNotes: string[] = [];
    const boundedSearchTemperature = (() => {
      const base =
        agentDecision.kind === 'search' ? agentDecision.temperature : 0.3;
      return Math.max(0.1, Math.min(1.4, base));
    })();
    const searchTemperature =
      params.allowToolEnvelope === false
        ? Math.max(0.1, boundedSearchTemperature - 0.1)
        : boundedSearchTemperature;

    if (contextPacketsText.trim()) {
      const contextSnapshot = contextPacketsText.trim().slice(0, 3_000);
      contextNotes.push(`Retrieved context:\n${contextSnapshot}`);
    }
    if (conversationHistory.length > 0) {
      const history = conversationHistory
        .slice(-6)
        .map((message) => `${message.role}: ${typeof message.content === 'string' ? message.content : '[media]'}`)
        .join('\n');
      contextNotes.push(`Recent conversation:\n${history}`);
    }
    const usablePriorDraft = stripToolEnvelopeDraft(params.priorDraft);
    if (usablePriorDraft) {
      contextNotes.push(`Previous draft to improve:\n${usablePriorDraft}`);
    }
    if (params.revisionInstruction?.trim()) {
      contextNotes.push(`Critic revision focus:\n${params.revisionInstruction.trim()}`);
    }

    const searchUserPrompt =
      contextNotes.length > 0
        ? `User request:\n${userText}\n\n${contextNotes.join('\n\n')}`
        : userText;

    let selectedModel: string | null = null;
    try {
      const searchModelDetails = await resolveModelForRequestDetailed({
        guildId,
        messages: [{ role: 'user', content: searchUserPrompt }],
        route: 'search',
        allowedModels: tenantPolicy.allowedModels,
        featureFlags: {
          search: true,
          reasoning: true,
        },
      });
      selectedModel = searchModelDetails.model;
      modelResolutionEvents.push({
        phase: params.phase,
        iteration: params.iteration,
        route: searchModelDetails.route,
        selected: searchModelDetails.model,
        candidates: searchModelDetails.candidates,
        decisions: searchModelDetails.decisions,
        allowlistApplied: searchModelDetails.allowlistApplied,
      });

      const searchClient = createLLMClient('pollinations', { chatModel: selectedModel });
      const searchSystemPrompt =
        params.allowToolEnvelope === false
          ? 'You are a search-focused assistant. Answer using the freshest reliable information available. ' +
            'When possible, include concise source cues (site/domain names or URLs). If uncertain, say so directly. ' +
            'Return a direct plain-text answer only. Do not output JSON or tool_calls envelopes.'
          : 'You are a search-focused assistant. Answer using the freshest reliable information available. ' +
            'When possible, include concise source cues (site/domain names or URLs). If uncertain, say so directly. ' +
            'If you need another verification pass before finalizing, output ONLY valid JSON in this exact shape:\n' +
            '{\n' +
            '  "type": "tool_calls",\n' +
            '  "calls": [{ "name": "verify_search_again", "args": { "reason": "<short reason>" } }]\n' +
            '}\n' +
            'If no verification pass is needed, return plain text only.';
      const searchMessages: LLMChatMessage[] = [
        {
          role: 'system',
          content: searchSystemPrompt,
        },
        { role: 'user', content: searchUserPrompt },
      ];

      const startedAt = Date.now();
      const searchResponse = await searchClient.chat({
        messages: searchMessages,
        model: selectedModel,
        apiKey,
        temperature: searchTemperature,
        timeout: 180_000,
      });
      recordModelOutcome({
        model: selectedModel,
        success: true,
        latencyMs: Date.now() - startedAt,
      });
      return searchResponse.content;
    } catch (error) {
      if (selectedModel) {
        recordModelOutcome({
          model: selectedModel,
          success: false,
        });
      }
      throw error;
    }
  };

  const runSearchSummaryPass = async (params: {
    phase: string;
    iteration?: number;
    searchDraft: string;
    summaryReason?: string;
  }): Promise<string> => {
    const buildSearchFindingsBlob = (draft: string): string => {
      const trimmedDraft = draft.trim();
      const strippedDraft = stripToolEnvelopeDraft(trimmedDraft);

      // If we unexpectedly receive a verification envelope here, avoid sending raw JSON as "findings".
      const baseFindings =
        strippedDraft ??
        (parseToolCallEnvelope(trimmedDraft)
          ? 'No plain-text search findings were available. Re-synthesize from the request and preserve uncertainty cues.'
          : trimmedDraft);

      const maxChars = 32_000;
      if (baseFindings.length <= maxChars) {
        return baseFindings;
      }

      // Preserve both the beginning and end because conclusions often appear in the tail.
      const headChars = 20_000;
      const tailChars = 10_000;
      const omitted = Math.max(0, baseFindings.length - headChars - tailChars);
      return (
        `${baseFindings.slice(0, headChars).trimEnd()}\n\n` +
        `[... ${omitted.toLocaleString()} chars omitted ...]\n\n` +
        `${baseFindings.slice(-tailChars).trimStart()}`
      );
    };

    const searchFindingsBlob = buildSearchFindingsBlob(params.searchDraft);
    const summaryModelDetails = await resolveModelForRequestDetailed({
      guildId,
      messages: [
        {
          role: 'user',
          content:
            `Original user request:\n${userText}\n\n` +
            `Search findings:\n${searchFindingsBlob}`,
        },
      ],
      route: 'chat',
      allowedModels: tenantPolicy.allowedModels,
      featureFlags: {
        reasoning: true,
        tools: false,
      },
    });
    const summaryModel = summaryModelDetails.model;
    modelResolutionEvents.push({
      phase: params.phase,
      iteration: params.iteration,
      route: summaryModelDetails.route,
      selected: summaryModelDetails.model,
      candidates: summaryModelDetails.candidates,
      decisions: summaryModelDetails.decisions,
      allowlistApplied: summaryModelDetails.allowlistApplied,
      purpose: 'search_complex_summary',
    });

    const summaryMessages: LLMChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a synthesis assistant. Convert search findings into a clean final response for the user. ' +
          'Do not invent facts. Keep uncertain claims clearly marked as uncertain. ' +
          'Preserve or improve concise source cues (domains or URLs) for external factual claims. ' +
          'Return plain text only.',
      },
      {
        role: 'user',
        content:
          `Original user request:\n${userText}\n\n` +
          `Search findings:\n${searchFindingsBlob}` +
          (params.summaryReason?.trim() ? `\n\nFocus:\n${params.summaryReason.trim()}` : ''),
      },
    ];

    const startedAt = Date.now();
    try {
      const summaryResponse = await client.chat({
        messages: summaryMessages,
        model: summaryModel,
        apiKey,
        temperature: 1.0,
        timeout: appConfig.TIMEOUT_CHAT_MS,
      });
      recordModelOutcome({
        model: summaryModel,
        success: true,
        latencyMs: Date.now() - startedAt,
      });
      return summaryResponse.content;
    } catch (error) {
      recordModelOutcome({
        model: summaryModel,
        success: false,
      });
      throw error;
    }
  };

  const runRouteVerificationPass = async (params: {
    phase: string;
    routeKind: 'chat' | 'coding' | 'search';
    verificationReason: string;
    priorDraft?: string;
  }): Promise<string> => {
    if (params.routeKind === 'search') {
      return runSearchPass({
        phase: params.phase,
        revisionInstruction: params.verificationReason,
        priorDraft: params.priorDraft,
        allowToolEnvelope: false,
      });
    }

    const priorDraft = stripToolEnvelopeDraft(params.priorDraft);
    const verificationMessages: LLMChatMessage[] = [
      ...messages,
      ...(priorDraft
        ? [{ role: 'assistant' as const, content: priorDraft }]
        : []),
      {
        role: 'system',
        content:
          'Independent verification pass. Re-answer from scratch for the same user request. ' +
          `Focus: ${params.verificationReason}\n` +
          'Return a direct plain-text answer only. Do not output JSON or tool_calls envelopes.',
      },
    ];

    const verificationModelDetails = await resolveModelForRequestDetailed({
      guildId,
      messages: verificationMessages,
      route: params.routeKind,
      allowedModels: tenantPolicy.allowedModels,
      featureFlags: {
        reasoning: true,
        tools: false,
      },
    });
    const verificationModel = verificationModelDetails.model;
    modelResolutionEvents.push({
      phase: params.phase,
      route: verificationModelDetails.route,
      selected: verificationModelDetails.model,
      candidates: verificationModelDetails.candidates,
      decisions: verificationModelDetails.decisions,
      allowlistApplied: verificationModelDetails.allowlistApplied,
    });

    const startedAt = Date.now();
    try {
      const verificationTemperature =
        params.routeKind === 'chat' ? agentDecision.temperature : Math.max(0.2, agentDecision.temperature - 0.15);
      const response = await client.chat({
        messages: verificationMessages,
        model: verificationModel,
        apiKey,
        temperature: verificationTemperature,
        timeout: appConfig.TIMEOUT_CHAT_MS,
      });
      recordModelOutcome({
        model: verificationModel,
        success: true,
        latencyMs: Date.now() - startedAt,
      });
      return response.content;
    } catch (error) {
      recordModelOutcome({
        model: verificationModel,
        success: false,
      });
      throw error;
    }
  };

  const runVerificationComparePass = async (params: {
    phase: string;
    routeKind: 'chat' | 'coding' | 'search';
    verificationReason: string;
    draftA: string;
    draftB: string;
  }): Promise<string> => {
    const draftA = stripToolEnvelopeDraft(params.draftA) ?? 'Candidate draft A did not provide a direct answer.';
    const draftB = stripToolEnvelopeDraft(params.draftB) ?? 'Candidate draft B did not provide a direct answer.';
    const comparisonMessages: LLMChatMessage[] = [
      ...messages,
      {
        role: 'system',
        content:
          'Compare the two candidate drafts for factual correctness, completeness, and consistency. ' +
          'Resolve conflicts and return one verified final answer only. ' +
          'Return plain text only, never JSON or tool_calls envelopes.',
      },
      {
        role: 'user',
        content:
          `Verification focus:\n${params.verificationReason}\n\n` +
          `Candidate draft A:\n${draftA}\n\n` +
          `Candidate draft B:\n${draftB}`,
      },
    ];

    const compareModelDetails = await resolveModelForRequestDetailed({
      guildId,
      messages: comparisonMessages,
      route: params.routeKind,
      allowedModels: tenantPolicy.allowedModels,
      featureFlags: {
        reasoning: true,
        tools: false,
      },
    });
    const compareModel = compareModelDetails.model;
    modelResolutionEvents.push({
      phase: params.phase,
      route: compareModelDetails.route,
      selected: compareModelDetails.model,
      candidates: compareModelDetails.candidates,
      decisions: compareModelDetails.decisions,
      allowlistApplied: compareModelDetails.allowlistApplied,
    });

    const startedAt = Date.now();
    try {
      const compareTemperature =
        params.routeKind === 'chat' ? agentDecision.temperature : Math.max(0.15, agentDecision.temperature - 0.2);
      const response = await client.chat({
        messages: comparisonMessages,
        model: compareModel,
        apiKey,
        temperature: compareTemperature,
        timeout: appConfig.TIMEOUT_CHAT_MS,
      });
      recordModelOutcome({
        model: compareModel,
        success: true,
        latencyMs: Date.now() - startedAt,
      });
      return response.content;
    } catch (error) {
      recordModelOutcome({
        model: compareModel,
        success: false,
      });
      throw error;
    }
  };

  const ensurePlainVerificationAnswer = async (params: {
    routeKind: 'chat' | 'coding' | 'search';
    verificationReason: string;
    candidate: string;
    fallbackDraft?: string;
  }): Promise<string> => {
    const candidateDraft = stripToolEnvelopeDraft(params.candidate);
    if (candidateDraft) return candidateDraft;

    const fallbackDraft = stripToolEnvelopeDraft(params.fallbackDraft);
    if (fallbackDraft) return fallbackDraft;

    const forcedRetry = await runRouteVerificationPass({
      phase: 'tool_verify_plaintext_fallback',
      routeKind: params.routeKind,
      verificationReason:
        `${params.verificationReason}\n` +
        'Return a final plain-text answer only. Do not output JSON or tool_calls envelopes.',
    });
    return (
      stripToolEnvelopeDraft(forcedRetry) ??
      "I couldn't complete verification cleanly. Please ask again and I will retry with a fresh pass."
    );
  };

  const runToolTriggeredVerification = async (params: {
    routeKind: 'chat' | 'coding' | 'search';
    toolIntentReason: string;
    verificationIntent: VerificationIntent;
    initialDraft: string;
  }): Promise<string> => {
    const initialDraft = stripToolEnvelopeDraft(params.initialDraft) ?? undefined;
    const runRouteTwoPassVerification = async (phasePrefix: string): Promise<string> => {
      const firstPass = await runRouteVerificationPass({
        phase: `${phasePrefix}_a`,
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        priorDraft: initialDraft,
      });
      const secondPass = await runRouteVerificationPass({
        phase: `${phasePrefix}_b`,
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        priorDraft: firstPass,
      });
      const compared = await runVerificationComparePass({
        phase: `${phasePrefix}_compare`,
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        draftA: firstPass,
        draftB: secondPass,
      });
      return ensurePlainVerificationAnswer({
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        candidate: compared,
        fallbackDraft: secondPass || firstPass || initialDraft,
      });
    };

    if (params.routeKind === 'search') {
      return runRouteTwoPassVerification('tool_verify_search');
    }

    const routePass = params.verificationIntent.wantsRouteCrosscheck
      ? await runRouteVerificationPass({
          phase: 'tool_verify_route_pass',
          routeKind: params.routeKind,
          verificationReason: params.toolIntentReason,
          priorDraft: initialDraft,
        })
      : null;

    const searchPass = params.verificationIntent.wantsSearchRefresh
      ? await runSearchPass({
          phase: 'tool_verify_search_pass',
          revisionInstruction: params.toolIntentReason,
          priorDraft: routePass ?? initialDraft,
          allowToolEnvelope: false,
        })
      : null;

    if (routePass && searchPass) {
      const compared = await runVerificationComparePass({
        phase: 'tool_verify_cross_compare',
        routeKind: params.routeKind,
        verificationReason: `${params.toolIntentReason}\nCross-check with fresh search evidence.`,
        draftA: routePass,
        draftB: searchPass,
      });
      return ensurePlainVerificationAnswer({
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        candidate: compared,
        fallbackDraft: searchPass || routePass || initialDraft,
      });
    }

    if (searchPass) {
      return ensurePlainVerificationAnswer({
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        candidate: searchPass,
        fallbackDraft: routePass || initialDraft,
      });
    }

    if (routePass) {
      const secondRoutePass = await runRouteVerificationPass({
        phase: 'tool_verify_route_pass_b',
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        priorDraft: routePass,
      });
      const compared = await runVerificationComparePass({
        phase: 'tool_verify_route_compare',
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        draftA: routePass,
        draftB: secondRoutePass,
      });
      return ensurePlainVerificationAnswer({
        routeKind: params.routeKind,
        verificationReason: params.toolIntentReason,
        candidate: compared,
        fallbackDraft: secondRoutePass || routePass || initialDraft,
      });
    }

    return runRouteTwoPassVerification('tool_verify_fallback');
  };

  // --- SEARCH AGENT ---
  if (agentDecision.kind === 'search') {
    logger.info({ traceId, userText, searchExecutionMode }, 'Agent Runtime: Executing Search Agent');
    try {
      draftText = await runSearchPass({ phase: 'search_initial' });
      const searchToolEnvelope = parseToolCallEnvelope(draftText);
      if (searchToolEnvelope) {
        const toolIntentReason = buildToolIntentReason(searchToolEnvelope.calls);
        const verificationIntent = deriveVerificationIntent('search', searchToolEnvelope.calls);
        logger.info(
          {
            traceId,
            toolCalls: searchToolEnvelope.calls.map((call) => call.name),
            verificationIntent,
          },
          'Search route requested tool verification; running verification redispatch',
        );
        draftText = await runToolTriggeredVerification({
          routeKind: 'search',
          toolIntentReason,
          verificationIntent,
          initialDraft: draftText,
        });
        toolVerificationRedispatches.push({
          route: 'search',
          toolCalls: searchToolEnvelope.calls.map((call) => call.name),
          verificationIntent,
        });
        if (Array.isArray(agentEventsJson)) {
          agentEventsJson.push({
                type: 'tool_verify_redispatch',
                timestamp: new Date().toISOString(),
                details: {
                  route: 'search',
                  toolCalls: searchToolEnvelope.calls.map((call) => call.name),
                  verificationIntent,
                },
              });
        }
        toolsExecuted = true;
      }

      if (searchExecutionMode === 'complex') {
        try {
          draftText = await runSearchSummaryPass({
            phase: 'search_complex_summary_initial',
            searchDraft: draftText,
            summaryReason: 'Summarize findings into a concise, structured, user-facing answer.',
          });
          if (Array.isArray(agentEventsJson)) {
            agentEventsJson.push({
              type: 'search_complex_summary',
              timestamp: new Date().toISOString(),
            });
          }
        } catch (summaryError) {
          logger.warn(
            { error: summaryError, traceId },
            'Search complex summary failed; returning raw search answer',
          );
        }
      }
    } catch (searchError) {
      logger.error({ error: searchError, traceId }, 'Search Agent failed');
      draftText = "I couldn't complete the search request at this time.";
    }
  } else {

    // --- STANDARD CHAT / CODING AGENT ---
    let lastPrimaryModel: string | null = null;
    try {
      const resolvedModelDetails = await resolveModelForRequestDetailed({
        guildId,
        messages: runtimeMessages,
        route: agentDecision.kind, // Pass agent kind as route
        allowedModels: tenantPolicy.allowedModels,
        featureFlags: {
          tools: shouldUseToolProtocol,
        },
      });
      const resolvedModel = resolvedModelDetails.model;
      lastPrimaryModel = resolvedModel;
      modelResolutionEvents.push({
        phase: 'main',
        route: resolvedModelDetails.route,
        selected: resolvedModelDetails.model,
        candidates: resolvedModelDetails.candidates,
        decisions: resolvedModelDetails.decisions,
        allowlistApplied: resolvedModelDetails.allowlistApplied,
      });

      const mainCallStartedAt = Date.now();
      const response = await client.chat({
        messages: runtimeMessages,
        model: resolvedModel,
        apiKey,
        temperature: agentDecision.temperature,
        timeout: appConfig.TIMEOUT_CHAT_MS,
      });
      recordModelOutcome({
        model: resolvedModel,
        success: true,
        latencyMs: Date.now() - mainCallStartedAt,
      });

      draftText = response.content;

      if (shouldUseToolProtocol) {
        const envelope = parseToolCallEnvelope(draftText);
        if (envelope) {
          const executableCalls = envelope.calls.filter((call) => globalToolRegistry.has(call.name));
          if (executableCalls.length > 0) {
            logger.debug({ traceId }, 'Tool calls detected, running loop');

            const toolLoop = await runToolCallLoop({
              client,
              messages: runtimeMessages,
              registry: globalToolRegistry,
              ctx: { traceId, userId, channelId },
              model: resolvedModel,
              apiKey,
              temperature: agentDecision.temperature,
              initialAssistantResponseText: draftText,
              toolPolicy: {
                allowExternalWrite: !!effectiveToolAllowExternalWrite,
                allowHighRisk: !!effectiveToolAllowHighRisk,
                blockedTools: effectiveToolBlockedTools,
              },
            });

            draftText = toolLoop.replyText;
            latestToolLoopResult = toolLoop;
            toolsExecuted = true;
          } else {
            const toolIntentReason = buildToolIntentReason(envelope.calls);
            const verificationIntent = deriveVerificationIntent(agentDecision.kind, envelope.calls);
            logger.info(
              {
                traceId,
                toolCalls: envelope.calls.map((call) => call.name),
                verificationIntent,
              },
              'Tool verification requested without executable tools; redispatching verification cycle',
            );
            if (agentDecision.kind !== 'chat' && agentDecision.kind !== 'coding') {
              throw new Error(
                `Tool verification redispatch only supported for chat/coding in this branch (got ${agentDecision.kind})`,
              );
            }
            draftText = await runToolTriggeredVerification({
              routeKind: agentDecision.kind,
              toolIntentReason,
              verificationIntent,
              initialDraft: draftText,
            });
            toolVerificationRedispatches.push({
              route: agentDecision.kind,
              toolCalls: envelope.calls.map((call) => call.name),
              verificationIntent,
            });
            if (Array.isArray(agentEventsJson)) {
              agentEventsJson.push({
                type: 'tool_verify_redispatch',
                timestamp: new Date().toISOString(),
                details: {
                  route: agentDecision.kind,
                  toolCalls: envelope.calls.map((call) => call.name),
                  verificationIntent,
                },
              });
            }
            toolsExecuted = true;
          }
        }
      }
    } catch (err) {
      if (lastPrimaryModel) {
        recordModelOutcome({
          model: lastPrimaryModel,
          success: false,
        });
      }
      logger.error({ error: err, traceId }, 'LLM call error');
      draftText = "I'm having trouble connecting right now. Please try again later.";
    }
  }

  const criticAssessments: Array<{
    iteration: number;
    score: number;
    verdict: 'pass' | 'revise';
    model: string;
    issues: string[];
  }> = [];
  const criticRedispatches: Array<Record<string, unknown>> = [];

  const deriveCriticRedispatchProviders = (issues: string[]): ContextProviderName[] => {
    const issueText = issues.join(' ').toLowerCase();
    const providers = new Set<ContextProviderName>();

    if (/(fact|factual|correct|accuracy|halluc|citation|source|verify|evidence)/.test(issueText)) {
      providers.add('Memory');
    }
    if (/(relationship|friend|social|tone|persona|community)/.test(issueText)) {
      providers.add('SocialGraph');
    }
    if (/(voice|speaker|audio|talked|vc)/.test(issueText)) {
      providers.add('VoiceAnalytics');
    }
    if (/(summary|summar|context|missing context|thread)/.test(issueText)) {
      providers.add('Summarizer');
    }

    const allowedProviders = agentDecision.contextProviders ?? getStandardProvidersForAgent(agentDecision.kind);
    return [...providers].filter((provider) => allowedProviders.includes(provider));
  };

  if (
    shouldRunCritic({
      config: criticConfig,
      routeKind: agentDecision.kind,
      draftText,
      isVoiceActive,
      hasFiles: files.length > 0,
    })
  ) {
    for (let iteration = 1; iteration <= criticConfig.maxLoops; iteration += 1) {
      const assessment = await evaluateDraftWithCritic({
        guildId,
        routeKind: agentDecision.kind,
        userText,
        draftText,
        allowedModels: tenantPolicy.allowedModels,
        apiKey,
        timeoutMs: Math.min(240_000, appConfig.TIMEOUT_CHAT_MS),
        conversationHistory,
      });

      if (!assessment) break;

      criticAssessments.push({
        iteration,
        score: assessment.score,
        verdict: assessment.verdict,
        model: assessment.model,
        issues: assessment.issues,
      });

      if (!shouldRequestRevision({ assessment, minScore: criticConfig.minScore })) {
        break;
      }

      const revisionInstruction =
        assessment.rewritePrompt.trim() ||
        (assessment.issues.length > 0
          ? `Fix the following issues: ${assessment.issues.join('; ')}`
          : 'Improve factual precision and completeness while preserving tone.');

      if (
        shouldRefreshSearchFromCritic({
          routeKind: agentDecision.kind,
          issues: assessment.issues,
          rewritePrompt: assessment.rewritePrompt,
        })
      ) {
        try {
          draftText = await runSearchPass({
            phase: 'critic_search_refresh',
            iteration,
            revisionInstruction,
            priorDraft: draftText,
            allowToolEnvelope: false,
          });
          if (searchExecutionMode === 'complex') {
            try {
              draftText = await runSearchSummaryPass({
                phase: 'critic_search_refresh_summary',
                iteration,
                searchDraft: draftText,
                summaryReason: revisionInstruction,
              });
              criticRedispatches.push({
                iteration,
                mode: 'search_refresh_summary',
                issueCount: assessment.issues.length,
              });
              if (Array.isArray(agentEventsJson)) {
                agentEventsJson.push({
                  type: 'critic_search_refresh_summary',
                  timestamp: new Date().toISOString(),
                  details: {
                    iteration,
                    issueCount: assessment.issues.length,
                  },
                });
              }
            } catch (summaryError) {
              logger.warn(
                { error: summaryError, traceId, iteration },
                'Critic search refresh summary failed; keeping refreshed search draft',
              );
            }
          }
          criticRedispatches.push({
            iteration,
            mode: 'search_refresh',
            issueCount: assessment.issues.length,
          });
          if (Array.isArray(agentEventsJson)) {
            agentEventsJson.push({
              type: 'critic_search_refresh',
              timestamp: new Date().toISOString(),
              details: {
                iteration,
                issueCount: assessment.issues.length,
              },
            });
          }
          continue;
        } catch (error) {
          logger.warn(
            { error, traceId, iteration },
            'Critic-triggered search refresh failed; falling back to rewrite pass',
          );
        }
      }

      let redispatchContext = '';
      const redispatchProviders = deriveCriticRedispatchProviders(assessment.issues);
      if (redispatchProviders.length > 0) {
        try {
          const redispatchedPackets = await runContextProviders({
            providers: redispatchProviders,
            guildId,
            channelId,
            userId,
            traceId,
            skipMemory: false,
          });

          if (redispatchedPackets.length > 0) {
            criticRedispatches.push({
              iteration,
              providers: redispatchProviders,
              packetCount: redispatchedPackets.length,
            });
            if (Array.isArray(agentEventsJson)) {
              agentEventsJson.push({
                type: 'critic_redispatch',
                timestamp: new Date().toISOString(),
                details: {
                  iteration,
                  providers: redispatchProviders,
                  packetCount: redispatchedPackets.length,
                },
              });
            }

            redispatchContext = redispatchedPackets
              .map((packet) => `[${packet.name}] ${packet.content}`)
              .join('\n\n');

            for (const packet of redispatchedPackets) {
              if (packet.binary) {
                files.push({ attachment: packet.binary.data, name: packet.binary.filename });
              }
            }
          }
        } catch (error) {
          logger.warn(
            { error, traceId, iteration, redispatchProviders },
            'Critic-targeted provider redispatch failed (non-fatal)',
          );
        }
      }

      const revisionMessages: LLMChatMessage[] = [
        ...runtimeMessages,
        { role: 'assistant', content: draftText },
        {
          role: 'system',
          content:
            `Critic requested revision:\n${revisionInstruction}` +
            (redispatchContext ? `\n\nAdditional provider refresh:\n${redispatchContext}` : ''),
        },
      ];

      try {
        const revisionModelDetails = await resolveModelForRequestDetailed({
          guildId,
          messages: revisionMessages,
          route: agentDecision.kind,
          allowedModels: tenantPolicy.allowedModels,
          featureFlags: {
            reasoning: true,
          },
        });
        const revisionModel = revisionModelDetails.model;
        modelResolutionEvents.push({
          phase: 'critic_revision',
          iteration,
          route: revisionModelDetails.route,
          selected: revisionModelDetails.model,
          candidates: revisionModelDetails.candidates,
          decisions: revisionModelDetails.decisions,
          allowlistApplied: revisionModelDetails.allowlistApplied,
        });

        const revisionStartedAt = Date.now();
        const revisedResponse = await client.chat({
          messages: revisionMessages,
          model: revisionModel,
          apiKey,
          temperature:
            agentDecision.kind === 'chat' ? agentDecision.temperature : Math.max(0.1, agentDecision.temperature - 0.2),
          timeout: appConfig.TIMEOUT_CHAT_MS,
        });
        recordModelOutcome({
          model: revisionModel,
          success: true,
          latencyMs: Date.now() - revisionStartedAt,
        });

        draftText = revisedResponse.content;
      } catch (error) {
        const revisionEvents = modelResolutionEvents.filter(
          (entry) => entry.phase === 'critic_revision',
        );
        const lastRevision = revisionEvents.length > 0 ? revisionEvents[revisionEvents.length - 1] : null;
        if (lastRevision?.selected && typeof lastRevision.selected === 'string') {
          recordModelOutcome({
            model: lastRevision.selected,
            success: false,
          });
        }
        logger.warn({ error, traceId, iteration }, 'Critic revision attempt failed (non-fatal)');
        break;
      }
    }
  }

  const finalText = draftText;
  const strippedFinalText = stripToolEnvelopeDraft(finalText);
  const finalTextWasToolEnvelope = finalText.trim().length > 0 && strippedFinalText === null;
  const safeFinalText = finalTextWasToolEnvelope
    ? "I couldn't complete the final tool response cleanly. Please ask again and I'll retry with a direct answer."
    : finalText;
  if (finalTextWasToolEnvelope) {
    logger.warn({ traceId }, 'Final draft was a tool_calls envelope; applying plain-text fallback');
  }
  const qualityJson =
    criticAssessments.length > 0
      ? {
          critic: criticAssessments,
          revised: criticAssessments.some((assessment) => assessment.verdict === 'revise'),
          criticRedispatches: criticRedispatches.length > 0 ? criticRedispatches : undefined,
        }
      : undefined;
  const canarySnapshot = getAgenticCanarySnapshot();
  const finalBudgetJson: Record<string, unknown> = {
    ...budgetJson,
    ...(searchExecutionMode ? { searchExecutionMode } : {}),
    toolsExecuted,
    toolVerificationRedispatches: toolVerificationRedispatches.length,
    criticIterations: criticAssessments.length,
    criticRedispatches: criticRedispatches.length,
    modelResolution: modelResolutionEvents,
    policy: {
      tenantPolicyApplied:
        tenantPolicy.allowedModels !== undefined ||
        tenantPolicy.maxParallel !== undefined ||
        tenantPolicy.criticEnabled !== undefined ||
        tenantPolicy.criticMaxLoops !== undefined ||
        tenantPolicy.criticMinScore !== undefined ||
        tenantPolicy.toolAllowExternalWrite !== undefined ||
        tenantPolicy.toolAllowHighRisk !== undefined ||
        tenantPolicy.toolBlockedTools !== undefined,
      allowedModels: tenantPolicy.allowedModels,
      graph: {
        parallelEnabled: effectiveGraphParallelEnabled,
        maxParallel: effectiveGraphMaxParallel,
      },
      tools: {
        allowExternalWrite: effectiveToolAllowExternalWrite,
        allowHighRisk: effectiveToolAllowHighRisk,
        blockedTools: effectiveToolBlockedTools,
      },
      critic: criticConfig,
      canary: {
        ...canaryConfig,
        decision: canaryDecision,
        snapshot: canarySnapshot,
      },
    },
  };

  if (appConfig.TRACE_ENABLED) {
    try {
      await updateTraceEnd({
        id: traceId,
        toolJson:
          toolsExecuted || criticAssessments.length > 0 || toolVerificationRedispatches.length > 0
            ? {
                executed: toolsExecuted,
                verificationRedispatches:
                  toolVerificationRedispatches.length > 0 ? toolVerificationRedispatches : undefined,
                critic: criticAssessments.length > 0 ? criticAssessments : undefined,
              }
            : undefined,
        qualityJson,
        budgetJson: finalBudgetJson,
        replyText: safeFinalText,
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace end');
    }
  }

  logger.debug({ traceId }, 'Chat turn complete');

  if (safeFinalText.trim().includes('[SILENCE]')) {
    logger.info({ traceId }, 'Agent chose silence');
    return {
      replyText: '',
      debug: { messages: runtimeMessages, toolsExecuted, toolLoopResult: latestToolLoopResult },
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

  return {
    replyText: cleanedText,
    styleHint: styleMimicry,
    voice,
    debug: { messages: runtimeMessages, toolsExecuted, toolLoopResult: latestToolLoopResult },
    files,
  };
}

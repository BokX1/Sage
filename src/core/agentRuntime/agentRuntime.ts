/**
 * Orchestrate a single end-to-end chat turn.
 *
 * Responsibilities:
 * - Route the request to an Agent, gather context via Providers, and call the LLM.
 * - Execute context fan-out and route-aware verification/critic refinement.
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
import { getChannelSummaryStore } from '../summary/channelSummaryStoreRegistry';

import { classifyStyle, analyzeUserStyle } from './styleClassifier';
import { AgentKind, decideAgent, SearchExecutionMode } from '../orchestration/agentSelector';
import { runContextProviders } from '../context/runContext';
import { replaceAgentRuns, upsertTraceStart, updateTraceEnd } from './agent-trace-repo';
import {
  ContextPacket,
  resolveContextProviderSet,
  withRequiredContextProviders,
} from '../context/context-types';
import { resolveModelForRequestDetailed } from '../llm/model-resolver';
import { getModelHealthRuntimeStatus, recordModelOutcome } from '../llm/model-health';
import { getGuildApiKey } from '../settings/guildSettingsRepo';
import { getWelcomeMessage } from '../../bot/handlers/welcomeMessage';
import { buildContextGraph, getStandardProvidersForAgent } from './graphBuilder';
import { executeAgentGraph } from './graphExecutor';
import { renderContextPacketContext } from './blackboard';
import { evaluateDraftWithCritic } from './criticAgent';
import {
  normalizeCriticConfig,
  shouldForceSearchRefreshFromDraft,
  shouldRefreshSearchFromCritic,
  shouldRequestRevision,
  shouldRunCritic,
} from './qualityPolicy';
import { resolveTenantPolicy } from './tenantPolicy';
import {
  evaluateAgenticCanary,
  getAgenticCanarySnapshot,
  normalizeCanaryConfig,
  parseRouteAllowlistCsv,
  recordAgenticOutcome,
  type AgenticCanaryOutcomeReason,
} from './canaryPolicy';
import { runImageGenAction } from '../actions/imageGenAction';
import {
  buildAgenticStateBlock,
  buildCapabilityPromptSection,
  BuildCapabilityPromptSectionParams,
} from './capabilityPrompt';
import { ToolRegistry, globalToolRegistry, type ToolExecutionContext } from './toolRegistry';
import { runToolCallLoop, type ToolPolicyTraceDecision } from './toolCallLoop';
import { ToolResult } from './toolCallExecution';
import {
  mergeToolPolicyConfig,
  parseToolBlocklistCsv,
  parseToolPolicyJson,
  type ToolPolicyConfig,
} from './toolPolicy';
import {
  containsLikelyToolEnvelopeFragment,
  isIntentionalToolEnvelopeExampleRequest,
  removeLikelyToolEnvelopeFragments,
  stripToolEnvelopeDraft,
} from './toolVerification';
import {
  buildValidationRepairInstruction,
  validateResponseForRoute,
} from './responseValidators';
import { resolveRouteValidationPolicy } from './validationPolicy';
import { normalizeManagerWorkerConfig, planManagerWorker } from './taskPlanner';
import { executeManagerWorkerPlan } from './workerExecutor';
import { aggregateManagerWorkerArtifacts } from './workerAggregator';


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

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (Number.isFinite(value) && value && value > 0) {
    return Math.max(1, Math.floor(value));
  }
  return fallback;
}

function toNonNegativeInt(value: number | undefined, fallback: number): number {
  if (Number.isFinite(value) && value !== undefined && value >= 0) {
    return Math.max(0, Math.floor(value));
  }
  return fallback;
}

function resolveRouteOutputMaxTokens(params: {
  route: 'chat' | 'coding' | 'search' | 'creative';
  appConfig: typeof appConfig;
}): number {
  switch (params.route) {
    case 'coding':
      return toPositiveInt(
        (params.appConfig.CODING_MAX_OUTPUT_TOKENS as number | undefined),
        4_200,
      );
    case 'search':
      return toPositiveInt(
        (params.appConfig.SEARCH_MAX_OUTPUT_TOKENS as number | undefined),
        2_000,
      );
    case 'creative':
      return toPositiveInt(
        (params.appConfig.CHAT_MAX_OUTPUT_TOKENS as number | undefined),
        1_800,
      );
    case 'chat':
    default:
      return toPositiveInt(
        (params.appConfig.CHAT_MAX_OUTPUT_TOKENS as number | undefined),
        1_800,
      );
  }
}

function resolveCriticOutputMaxTokens(config: typeof appConfig): number {
  return toPositiveInt((config.CRITIC_MAX_OUTPUT_TOKENS as number | undefined), 1_800);
}

function resolveSearchMaxAttempts(params: {
  mode: SearchExecutionMode | null;
  config: typeof appConfig;
}): number {
  if (params.mode === 'simple') {
    return toPositiveInt((params.config.SEARCH_MAX_ATTEMPTS_SIMPLE as number | undefined), 2);
  }
  return toPositiveInt((params.config.SEARCH_MAX_ATTEMPTS_COMPLEX as number | undefined), 4);
}

const ROUTE_TOOL_ALLOWLIST: Record<AgentKind, string[]> = {
  chat: [
    'get_current_datetime',
    'channel_file_lookup',
    'web_search',
    'web_scrape',
    'wikipedia_lookup',
    'github_repo_lookup',
    'npm_package_lookup',
  ],
  coding: [
    'get_current_datetime',
    'channel_file_lookup',
    'web_search',
    'web_scrape',
    'github_repo_lookup',
    'github_file_lookup',
    'npm_package_lookup',
    'stack_overflow_search',
    'local_llm_models',
    'local_llm_infer',
  ],
  search: [
    'get_current_datetime',
    'channel_file_lookup',
    'web_search',
    'web_scrape',
    'wikipedia_lookup',
    'stack_overflow_search',
    'github_repo_lookup',
    'github_file_lookup',
    'npm_package_lookup',
  ],
  creative: [],
};

function selectRouteToolNames(routeKind: AgentKind, globalToolNames: string[]): string[] {
  const allowed = ROUTE_TOOL_ALLOWLIST[routeKind] ?? [];
  const available = new Set(globalToolNames);
  return allowed.filter((toolName) => available.has(toolName));
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

function buildToolProtocolInstruction(params: {
  routeKind: AgentKind;
  searchMode: SearchExecutionMode | null;
  toolNames: string[];
}): string {
  const hasTool = (name: string): boolean => params.toolNames.includes(name);
  const routeSpecificGuidance =
    params.routeKind === 'search'
      ? [
          'Search route behavior:',
          '- Use tools for externally verifiable claims.',
          hasTool('web_search')
            ? '- Call web_search before finalizing factual/time-sensitive answers.'
            : '- Prefer available retrieval tools before finalizing factual/time-sensitive answers.',
          hasTool('web_scrape')
            ? '- If user provides URLs, call web_scrape on those URLs.'
            : '- If user provides URLs, use available retrieval tools to verify URL content when possible.',
          hasTool('channel_file_lookup')
            ? '- If user asks about previously uploaded files/attachments in this channel, call channel_file_lookup before answering.'
            : '- If user asks about previously uploaded files/attachments in this channel, acknowledge that direct file retrieval is unavailable.',
          params.searchMode === 'complex'
            ? '- In complex mode, compare multiple sources before concluding.'
            : '- In simple mode, keep the answer concise and directly scoped.',
        ].join('\n')
      : params.routeKind === 'coding'
        ? [
            'Coding route behavior:',
            '- Use tools when correctness depends on package versions, API behavior, docs, or exact commands.',
            hasTool('npm_package_lookup')
              ? '- Use npm_package_lookup for package version and metadata validation.'
              : '- Use available package/doc tools to validate package versions when uncertain.',
            hasTool('github_repo_lookup') || hasTool('github_file_lookup')
              ? '- Use GitHub lookup tools to confirm repository/docs claims before citing them.'
              : '- Use available retrieval tools to validate repository/docs claims before citing them.',
            hasTool('stack_overflow_search')
              ? '- Use stack_overflow_search for known error signatures or implementation pitfalls.'
              : '- Use available retrieval tools when debugging known error signatures.',
            hasTool('channel_file_lookup')
              ? '- If coding guidance depends on previously uploaded files in this channel, call channel_file_lookup to retrieve the file content first.'
              : '- If coding guidance depends on previously uploaded files in this channel, state that file retrieval is unavailable.',
          ].join('\n')
        : params.routeKind === 'chat'
          ? [
              'Chat route behavior:',
              '- Use tools for factual, time-sensitive, or externally verifiable claims.',
              hasTool('web_search')
                ? '- For current events/news/prices/releases/weather, call web_search before finalizing.'
                : '- For current events/news/prices/releases/weather, rely on available tools before finalizing.',
              hasTool('web_scrape')
                ? '- If the user shares URL(s), call web_scrape before summarizing or quoting page content.'
                : '- If the user shares URL(s), use available tools to validate page content before summarizing.',
              hasTool('channel_file_lookup')
                ? '- If the user asks what files were uploaded/remembered or asks to analyze earlier attachments, call channel_file_lookup before answering.'
                : '- If the user asks what files were uploaded/remembered, state that file retrieval is unavailable in this run.',
            ].join('\n')
          : '';
  return [
    '## Tool Protocol',
    'You may call tools when they materially improve correctness.',
    'Never invent tool outputs. If a tool fails, acknowledge the limitation and proceed safely.',
    'If a tool is needed, output ONLY valid JSON in this exact format:',
    '{',
    '  "type": "tool_calls",',
    '  "calls": [{ "name": "<tool_name>", "args": { ... } }]',
    '}',
    'Do not include markdown or any extra text when returning tool_calls JSON.',
    `Available tools: ${params.toolNames.join(', ')}`,
    routeSpecificGuidance,
    'If no tool is needed, answer normally in plain text.',
  ]
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

const TOOL_HARD_GATE_TIME_SENSITIVE_PATTERN =
  /(latest|today|current|now|right now|as of|recent|fresh|newest|release|version|price|weather|news|score)/i;
const TOOL_HARD_GATE_SOURCE_REQUEST_PATTERN = /(source|sources|citation|cite|reference|references|link|url)/i;
const TOOL_HARD_GATE_CODING_VERIFICATION_PATTERN =
  /(npm|pnpm|yarn|package|dependency|dependencies|install|version|api|sdk|docs|documentation|changelog|migration|deprecated|cli|command|stack trace|error|exception|runtime)/i;
const TOOL_HARD_GATE_ATTACHMENT_RECALL_PATTERN =
  /(attachment|attached|uploaded|upload|cached|remember(?:ed)?|previous file|earlier file|that file|that attachment)/i;
const SEARCH_RESPONSE_URL_PATTERN = /https?:\/\/[^\s<>()]+/i;
const SEARCH_RESPONSE_URL_PATTERN_GLOBAL = /https?:\/\/[^\s<>()]+/gi;
const SEARCH_RESPONSE_CHECKED_ON_PATTERN = /checked on:\s*\d{4}-\d{2}-\d{2}/i;
const SEARCH_RESPONSE_SOURCE_LABEL_PATTERN = /source urls?:/i;
const SEARCH_RESPONSE_MAX_EMITTED_URLS = 6;

function extractSearchSourceUrls(text: string): string[] {
  const matches = text.match(SEARCH_RESPONSE_URL_PATTERN_GLOBAL) ?? [];
  return Array.from(new Set(matches.map((url) => url.trim()))).slice(0, SEARCH_RESPONSE_MAX_EMITTED_URLS);
}

function normalizeSearchReplyText(params: {
  userText: string;
  replyText: string;
  currentDateIso: string;
  sourceUrls?: string[];
}): string {
  const base = params.replyText.trim();
  if (!base) return base;

  const mergedUrls = Array.from(
    new Set([...extractSearchSourceUrls(base), ...(params.sourceUrls ?? [])]),
  ).slice(0, SEARCH_RESPONSE_MAX_EMITTED_URLS);
  const asksFreshnessOrSources =
    TOOL_HARD_GATE_TIME_SENSITIVE_PATTERN.test(params.userText) ||
    TOOL_HARD_GATE_SOURCE_REQUEST_PATTERN.test(params.userText);

  let normalized = base;
  if (mergedUrls.length > 0 && !SEARCH_RESPONSE_SOURCE_LABEL_PATTERN.test(normalized)) {
    normalized = `${normalized}\n\nSource URLs: ${mergedUrls.join(' ')}`;
  }
  if (SEARCH_RESPONSE_SOURCE_LABEL_PATTERN.test(normalized) && mergedUrls.length > 0) {
    const existing = new Set(extractSearchSourceUrls(normalized));
    const missing = mergedUrls.filter((url) => !existing.has(url));
    if (missing.length > 0) {
      normalized = `${normalized}\nAdditional Source URLs: ${missing.join(' ')}`;
    }
  }
  if (
    asksFreshnessOrSources &&
    mergedUrls.length > 0 &&
    !SEARCH_RESPONSE_CHECKED_ON_PATTERN.test(normalized)
  ) {
    normalized = `${normalized}\nChecked on: ${params.currentDateIso}`;
  }
  return normalized;
}

function collectUrlsFromUnknown(value: unknown, sink: Set<string>, depth = 0): void {
  if (sink.size >= SEARCH_RESPONSE_MAX_EMITTED_URLS) return;
  if (depth > 5) return;
  if (typeof value === 'string') {
    const matches = value.match(SEARCH_RESPONSE_URL_PATTERN_GLOBAL) ?? [];
    for (const match of matches) {
      sink.add(match.trim());
      if (sink.size >= SEARCH_RESPONSE_MAX_EMITTED_URLS) return;
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUrlsFromUnknown(entry, sink, depth + 1);
      if (sink.size >= SEARCH_RESPONSE_MAX_EMITTED_URLS) return;
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    collectUrlsFromUnknown(entry, sink, depth + 1);
    if (sink.size >= SEARCH_RESPONSE_MAX_EMITTED_URLS) return;
  }
}

function extractSourceUrlsFromToolResults(toolResults: ToolResult[]): string[] {
  const urls = new Set<string>();
  for (const toolResult of toolResults) {
    if (!toolResult.success || toolResult.result === undefined) continue;
    collectUrlsFromUnknown(toolResult.result, urls);
    if (urls.size >= SEARCH_RESPONSE_MAX_EMITTED_URLS) break;
  }
  return [...urls].slice(0, SEARCH_RESPONSE_MAX_EMITTED_URLS);
}

function summarizeSearchPipelineToolExecution(params: {
  toolResults: ToolResult[];
  policyDecisions: ToolPolicyTraceDecision[];
  deduplicatedCallCount?: number;
}): Record<string, unknown> {
  const successfulTools = new Set<string>();
  const failedTools = new Set<string>();
  const providerCounts = new Map<string, number>();
  const providersTried = new Set<string>();
  const providersSkipped = new Set<string>();

  for (const toolResult of params.toolResults) {
    if (toolResult.success) {
      successfulTools.add(toolResult.name);
    } else {
      failedTools.add(toolResult.name);
    }

    if (!toolResult.success || !toolResult.result || typeof toolResult.result !== 'object') {
      continue;
    }
    const record = toolResult.result as Record<string, unknown>;
    const provider = typeof record.provider === 'string' ? record.provider.trim().toLowerCase() : '';
    if (provider) {
      providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
    }
    const tried = Array.isArray(record.providersTried)
      ? record.providersTried
          .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
          .filter((entry) => entry.length > 0)
      : [];
    for (const entry of tried) {
      providersTried.add(entry);
    }
    const skipped = Array.isArray(record.providersSkipped)
      ? record.providersSkipped
          .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
          .filter((entry) => entry.length > 0)
      : [];
    for (const entry of skipped) {
      providersSkipped.add(entry);
    }
  }

  const deniedToolCalls = params.policyDecisions
    .filter((decision) => !decision.allowed)
    .map((decision) => decision.toolName);

  return {
    successfulToolNames: [...successfulTools],
    failedToolNames: [...failedTools],
    providerCounts: Object.fromEntries(providerCounts),
    providersTried: [...providersTried],
    providersSkipped: [...providersSkipped],
    policyDecisionCount: params.policyDecisions.length,
    policyDeniedToolCalls: deniedToolCalls,
    deduplicatedCallCount: params.deduplicatedCallCount ?? 0,
  };
}

function shouldRequireToolEvidenceForTurn(params: {
  routeKind: AgentKind;
  userText: string;
  searchMode: SearchExecutionMode | null;
  hasChannelFileLookup: boolean;
}): boolean {
  const text = params.userText.trim();
  if (!text) return false;

  const asksFreshness = TOOL_HARD_GATE_TIME_SENSITIVE_PATTERN.test(text);
  const asksSources = TOOL_HARD_GATE_SOURCE_REQUEST_PATTERN.test(text);
  const asksAttachmentRecall =
    params.hasChannelFileLookup && TOOL_HARD_GATE_ATTACHMENT_RECALL_PATTERN.test(text);

  if (params.routeKind === 'search') {
    return true;
  }
  if (params.routeKind === 'coding') {
    return (
      asksFreshness ||
      asksSources ||
      asksAttachmentRecall ||
      TOOL_HARD_GATE_CODING_VERIFICATION_PATTERN.test(text)
    );
  }
  if (params.routeKind === 'chat') {
    return asksFreshness || asksSources || asksAttachmentRecall;
  }
  return false;
}

function buildToolHardGateInstruction(params: {
  routeKind: AgentKind;
  searchMode: SearchExecutionMode | null;
  minSuccessfulCalls: number;
  toolNames: string[];
}): string {
  const routeLabel =
    params.routeKind === 'search'
      ? `search (${params.searchMode ?? 'complex'} mode)`
      : params.routeKind;
  return [
    '## Tool Evidence Hard Gate',
    `Route: ${routeLabel}`,
    `Before final answer, execute at least ${params.minSuccessfulCalls} successful tool call(s) relevant to the user request.`,
    'Do not finalize with unverified external/time-sensitive/versioned claims.',
    'If tools fail, explicitly state the limitation and avoid confident unsupported assertions.',
    `Available tools: ${params.toolNames.join(', ') || 'none'}`,
  ].join('\n');
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
    persistStateEnabled: appConfig.AGENTIC_PERSIST_STATE_ENABLED,
  });
  const validatorRepairMaxAttempts = toNonNegativeInt(
    (appConfig.AGENTIC_VALIDATION_AUTO_REPAIR_MAX_ATTEMPTS as number | undefined),
    1,
  );

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
  const routeValidationPolicy = resolveRouteValidationPolicy({
    routeKind: agentDecision.kind,
    validatorsEnabled: appConfig.AGENTIC_VALIDATORS_ENABLED,
    policyJson: appConfig.AGENTIC_VALIDATION_POLICY_JSON,
  });
  const resolvedContextProviders = resolveContextProviderSet({
    providers: agentDecision.contextProviders,
    fallback: getStandardProvidersForAgent(agentDecision.kind),
  });
  const activeContextProviders =
    agentDecision.kind === 'chat'
      ? withRequiredContextProviders({
          providers: resolvedContextProviders,
          required: ['UserMemory', 'ChannelMemory'],
        })
      : resolvedContextProviders;
  const hasChannelMemoryProvider = activeContextProviders.includes('ChannelMemory');

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
  const canaryDecision = await evaluateAgenticCanary({
    traceId,
    guildId,
    routeKind: agentDecision.kind,
    config: canaryConfig,
  });
  let graphFailedTasks = 0;
  let graphExecutionFailed = false;
  let canaryHardGateUnmet = false;
  let canaryToolLoopFailed = false;

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
        providers: activeContextProviders,
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
        providers: activeContextProviders,
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
      graphFailedTasks = graphExecution.blackboard.counters.failedTasks;

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
      graphExecutionFailed = true;
      logger.warn({ error: err, traceId }, 'Agent graph execution failed; falling back to provider runner');
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

    if (!hasChannelMemoryProvider) {
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
  const globalToolNames = globalToolRegistry.listNames();
  const activeToolNames = selectRouteToolNames(agentDecision.kind, globalToolNames);
  const toolLoopEnabled =
    !!(appConfig.AGENTIC_TOOL_LOOP_ENABLED as boolean | undefined) &&
    activeToolNames.length > 0 &&
    (agentDecision.kind === 'chat' || agentDecision.kind === 'coding' || agentDecision.kind === 'search');
  const toolHardGateEnabled = !!(appConfig.AGENTIC_TOOL_HARD_GATE_ENABLED as boolean | undefined);
  const toolHardGateMinSuccessfulCalls = toPositiveInt(
    (appConfig.AGENTIC_TOOL_HARD_GATE_MIN_SUCCESSFUL_CALLS as number | undefined),
    1,
  );
  const scopedToolRegistry = toolLoopEnabled ? buildScopedToolRegistry(activeToolNames) : null;
  const requiresToolEvidenceThisTurn =
    toolHardGateEnabled &&
    toolLoopEnabled &&
    !!scopedToolRegistry &&
    shouldRequireToolEvidenceForTurn({
      routeKind: agentDecision.kind,
      userText,
      searchMode: searchExecutionMode,
      hasChannelFileLookup: activeToolNames.includes('channel_file_lookup'),
    });
  const toolProtocolInstruction = toolLoopEnabled
    ? buildToolProtocolInstruction({
        routeKind: agentDecision.kind,
        searchMode: searchExecutionMode,
        toolNames: activeToolNames,
      })
    : null;

  const capabilityPromptParams: BuildCapabilityPromptSectionParams = {
    routeKind: agentDecision.kind,
    searchMode: searchExecutionMode,
    routerReasoning: agentDecision.reasoningText,
    contextProviders: activeContextProviders,
    activeTools: activeToolNames,
  };
  const capabilityInstruction = buildCapabilityPromptSection(capabilityPromptParams);
  const includeAgenticState =
    capabilityPromptParams.routeKind === 'chat' || capabilityPromptParams.routeKind === 'coding';
  const agenticStateInstruction = includeAgenticState
    ? buildAgenticStateBlock(capabilityPromptParams)
    : null;
  const runtimeInstructionBlocks = [capabilityInstruction, agenticStateInstruction, toolProtocolInstruction]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');
  const managerWorkerConfig = normalizeManagerWorkerConfig({
    enabled: appConfig.AGENTIC_MANAGER_WORKER_ENABLED,
    maxWorkers: appConfig.AGENTIC_MANAGER_WORKER_MAX_WORKERS,
    maxPlannerLoops: appConfig.AGENTIC_MANAGER_WORKER_MAX_PLANNER_LOOPS,
    maxWorkerTokens: appConfig.AGENTIC_MANAGER_WORKER_MAX_TOKENS,
    maxWorkerInputChars: appConfig.AGENTIC_MANAGER_WORKER_MAX_INPUT_CHARS,
    timeoutMs: appConfig.AGENTIC_MANAGER_WORKER_TIMEOUT_MS,
    minComplexityScore: appConfig.AGENTIC_MANAGER_WORKER_MIN_COMPLEXITY_SCORE,
  });
  const managerWorkerPlanning = planManagerWorker({
    config: managerWorkerConfig,
    routeKind: agentDecision.kind,
    searchMode: searchExecutionMode,
    userText,
  });
  const managerWorkerCanaryAllowed = canaryDecision.allowAgentic;
  const managerWorkerShouldRun = managerWorkerPlanning.shouldRun && managerWorkerCanaryAllowed;
  let managerWorkerRuntime: Record<string, unknown> = {
    enabled: managerWorkerConfig.enabled,
    eligibleRoute: managerWorkerPlanning.eligibleRoute,
    plannerSuggestedRun: managerWorkerPlanning.shouldRun,
    shouldRun: managerWorkerShouldRun,
    allowAgentic: managerWorkerCanaryAllowed,
    routeKind: managerWorkerPlanning.routeKind,
    complexityScore: managerWorkerPlanning.complexityScore,
    rationale: managerWorkerPlanning.rationale,
    maxWorkers: managerWorkerConfig.maxWorkers,
    maxPlannerLoops: managerWorkerConfig.maxPlannerLoops,
    maxWorkerTokens: managerWorkerConfig.maxWorkerTokens,
    maxWorkerInputChars: managerWorkerConfig.maxWorkerInputChars,
  };
  let effectiveContextPacketsText = contextPacketsText || null;
  const buildRuntimeMessages = (contextText: string | null): LLMChatMessage[] =>
    buildContextMessages({
      userProfileSummary,
      runtimeInstruction: runtimeInstructionBlocks || null,
      replyToBotText,
      replyReferenceContent,
      userText,
      userContent,
      recentTranscript,
      channelRollingSummary: rollingSummaryText,
      channelProfileSummary: profileSummaryText,
      intentHint: intent ?? null,
      style,
      contextPackets: contextText,
      invokedBy,
      voiceInstruction,
    });
  let runtimeMessages = buildRuntimeMessages(effectiveContextPacketsText);

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

  if (managerWorkerShouldRun && managerWorkerPlanning.plan) {
    try {
      const managerWorkerExecution = await executeManagerWorkerPlan({
        traceId,
        guildId,
        apiKey,
        userText,
        contextText: contextPacketsText || '',
        plan: managerWorkerPlanning.plan,
        client,
        maxParallel: managerWorkerConfig.maxWorkers,
        maxTokens: managerWorkerConfig.maxWorkerTokens,
        maxInputChars: managerWorkerConfig.maxWorkerInputChars,
        timeoutMs: managerWorkerConfig.timeoutMs,
      });
      const managerWorkerAggregate = aggregateManagerWorkerArtifacts({
        artifacts: managerWorkerExecution.artifacts,
      });
      if (managerWorkerAggregate.contextBlock) {
        effectiveContextPacketsText = [contextPacketsText, managerWorkerAggregate.contextBlock]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join('\n\n');
        runtimeMessages = buildRuntimeMessages(effectiveContextPacketsText);
      }

      managerWorkerRuntime = {
        ...managerWorkerRuntime,
        executed: true,
        totalWorkers: managerWorkerExecution.totalWorkers,
        failedWorkers: managerWorkerExecution.failedWorkers,
        successfulWorkers: managerWorkerAggregate.successfulWorkers,
        citationCount: managerWorkerAggregate.citationCount,
        contextInjected: managerWorkerAggregate.contextBlock.length > 0,
      };
      if (Array.isArray(agentEventsJson)) {
        agentEventsJson.push({
          type: 'manager_worker',
          timestamp: new Date().toISOString(),
          details: managerWorkerRuntime,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ error: errorMessage, traceId }, 'Manager-worker orchestration failed (non-fatal)');
      managerWorkerRuntime = {
        ...managerWorkerRuntime,
        executed: false,
        error: errorMessage,
      };
      if (Array.isArray(agentEventsJson)) {
        agentEventsJson.push({
          type: 'manager_worker_failed',
          timestamp: new Date().toISOString(),
          details: {
            error: errorMessage,
          },
        });
      }
    }
  } else if (managerWorkerPlanning.shouldRun && !managerWorkerCanaryAllowed) {
    managerWorkerRuntime = {
      ...managerWorkerRuntime,
      executed: false,
      skipped: true,
      skippedReason: 'canary_disallow_agentic',
    };
    if (Array.isArray(agentEventsJson)) {
      agentEventsJson.push({
        type: 'manager_worker_skipped',
        timestamp: new Date().toISOString(),
        details: {
          reason: 'canary_disallow_agentic',
        },
      });
    }
  }
  budgetJson = {
    ...budgetJson,
    managerWorker: managerWorkerRuntime,
  };

  let draftText = '';
  let skipCriticLoop = false;
  let criticSkipReason: string | null = null;
  const modelResolutionEvents: Array<Record<string, unknown>> = [];
  const routeOutputMaxTokens = resolveRouteOutputMaxTokens({
    route: agentDecision.kind,
    appConfig,
  });
  const criticOutputMaxTokens = resolveCriticOutputMaxTokens(appConfig);
  const cleanDraftText = (text: string | null | undefined): string | null => {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  };
  const GUARDED_SEARCH_MODELS = ['gemini-search', 'perplexity-fast', 'perplexity-reasoning'] as const;
  const SEARCH_SCRAPER_MODEL = 'nomnom' as const;
  const COMPLEX_SEARCH_TOOL_ORCHESTRATOR_MODEL = 'openai-large' as const;
  const URL_IN_TEXT_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()]+/i;
  const userTextHasLink = URL_IN_TEXT_PATTERN.test(userText);
  const BASE_SEARCH_TIMEOUT_MS = toPositiveInt(
    (appConfig.TIMEOUT_SEARCH_MS as number | undefined) ?? appConfig.TIMEOUT_CHAT_MS,
    120_000,
  );
  const SCRAPER_SEARCH_TIMEOUT_MS = toPositiveInt(
    (appConfig.TIMEOUT_SEARCH_SCRAPER_MS as number | undefined) ?? BASE_SEARCH_TIMEOUT_MS,
    BASE_SEARCH_TIMEOUT_MS,
  );
  const SEARCH_MAX_ATTEMPTS = resolveSearchMaxAttempts({
    mode: searchExecutionMode,
    config: appConfig,
  });
  const normalizeModelId = (value: string): string => value.trim().toLowerCase();
  const dedupeModelIds = (values: string[]): string[] => {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
      const normalized = normalizeModelId(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
    }
    return output;
  };
  const resolveGuardedSearchAllowlist = (
    allowedModels: string[] | undefined,
    guardedModels: readonly string[],
  ): string[] => {
    if (!allowedModels || allowedModels.length === 0) {
      return [...guardedModels];
    }

    const allowedSet = new Set(allowedModels.map((model) => normalizeModelId(model)));
    return guardedModels.filter((model) => allowedSet.has(model));
  };
  const resolveSearchTimeoutMs = (modelId: string): number => {
    return modelId === SEARCH_SCRAPER_MODEL ? SCRAPER_SEARCH_TIMEOUT_MS : BASE_SEARCH_TIMEOUT_MS;
  };
  const runSearchPass = async (params: {
    phase: string;
    iteration?: number;
    revisionInstruction?: string;
    priorDraft?: string;
  }): Promise<string> => {
    const contextNotes: string[] = [];
    const boundedSearchTemperature = (() => {
      const base =
        agentDecision.kind === 'search' ? agentDecision.temperature : 0.3;
      return Math.max(0.1, Math.min(1.4, base));
    })();
    const searchTemperature = Math.max(0.1, boundedSearchTemperature - 0.1);

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
    // Help search models anchor "right now/latest" without guessing.
    contextNotes.push(`Current date: ${new Date().toISOString().slice(0, 10)}`);
    const usablePriorDraft = cleanDraftText(params.priorDraft);
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
    const currentDateIso = new Date().toISOString().slice(0, 10);
    const isTimeSensitiveQuery =
      /(latest|today|current|now|right now|as of|recent|fresh|newest|release|version|price|weather|news|score)/i.test(
        userText,
      );

    const searchGuardrailModels = userTextHasLink
      ? [...GUARDED_SEARCH_MODELS, SEARCH_SCRAPER_MODEL]
      : [...GUARDED_SEARCH_MODELS];
    const guardedSearchAllowlist = resolveGuardedSearchAllowlist(
      tenantPolicy.allowedModels,
      searchGuardrailModels,
    );
    if (guardedSearchAllowlist.length === 0) {
      throw new Error(
        `Search route requires one of: ${searchGuardrailModels.join(', ')}. ` +
        'Current tenant allowedModels excludes all guarded search models.',
      );
    }

    const searchModelDetails = await resolveModelForRequestDetailed({
      guildId,
      messages: [{ role: 'user', content: searchUserPrompt }],
      route: 'search',
      allowedModels: guardedSearchAllowlist,
      featureFlags: {
        search: true,
        linkScrape: userTextHasLink || undefined,
      },
    });

    const preferredAttemptOrder = userTextHasLink
      ? [SEARCH_SCRAPER_MODEL, ...searchGuardrailModels]
      : [...searchGuardrailModels];

    const attemptOrder = dedupeModelIds([
      ...preferredAttemptOrder,
      searchModelDetails.model,
      ...searchModelDetails.candidates,
      ...guardedSearchAllowlist,
    ]).filter((model) => guardedSearchAllowlist.includes(model));
    const cappedAttemptOrder = attemptOrder.slice(0, SEARCH_MAX_ATTEMPTS);

    if (cappedAttemptOrder.length === 0) {
      throw new Error('No eligible guarded search model candidates were produced.');
    }

    modelResolutionEvents.push({
      phase: params.phase,
      iteration: params.iteration,
      route: searchModelDetails.route,
      selected: searchModelDetails.model,
      candidates: searchModelDetails.candidates,
      decisions: searchModelDetails.decisions,
      allowlistApplied: searchModelDetails.allowlistApplied,
      linkDetected: userTextHasLink,
      guardrailAllowlist: guardedSearchAllowlist,
      guardrailAttemptOrder: cappedAttemptOrder,
      searchMaxAttempts: SEARCH_MAX_ATTEMPTS,
    });

    const searchSystemPrompt = `You are a search-focused assistant. Answer using the freshest reliable information available.

Hard requirements:
- Return plain text only.
- Include at least one source URL (https://...) supporting the main factual claim.
- Prefer primary sources (official sites) over third-party posts.
- Answer only what the user asked; avoid extra details unless requested.
- If you include a specific version number/date/time, include a source URL that explicitly contains it and quote the exact value when possible.
- For "latest" claims, tie "latest" to what is shown on the cited source(s); if you cannot definitively confirm, qualify the claim and say how to verify.
- For software versions/releases, prefer stable machine-readable sources (e.g., official JSON release indexes) and include the relevant field names/values when possible.
- If you cannot find a reliable source URL for a claim, explicitly say so and avoid overconfident assertions.
- If the question is time-sensitive (latest/current/now/today) OR the user asks for sources/citations/links, include: "Checked on: YYYY-MM-DD" using the current date provided.

Output format:
Answer: <your answer>
Source URLs: <one or more URLs>
Checked on: <YYYY-MM-DD> (only when required)`;
    const searchMessages: LLMChatMessage[] = [
      {
        role: 'system',
        content: searchSystemPrompt,
      },
      { role: 'user', content: searchUserPrompt },
    ];

    let lastError: unknown = null;
    for (let attemptIndex = 0; attemptIndex < cappedAttemptOrder.length; attemptIndex += 1) {
      const attemptModel = cappedAttemptOrder[attemptIndex];
      const attemptTimeoutMs = resolveSearchTimeoutMs(attemptModel);
      const searchClient = createLLMClient('pollinations', { chatModel: attemptModel });
      const startedAt = Date.now();
      try {
        const searchResponse = await searchClient.chat({
          messages: searchMessages,
          model: attemptModel,
          apiKey,
          temperature: searchTemperature,
          timeout: attemptTimeoutMs,
          maxTokens: routeOutputMaxTokens,
        });
        recordModelOutcome({
          model: attemptModel,
          success: true,
          latencyMs: Date.now() - startedAt,
        });
        modelResolutionEvents.push({
          phase: params.phase,
          iteration: params.iteration,
            route: 'search',
            selected: attemptModel,
            purpose: 'search_guardrail_attempt',
            attempt: attemptIndex + 1,
            attemptsTotal: cappedAttemptOrder.length,
            timeoutMs: attemptTimeoutMs,
            status: 'success',
          });
        const content = normalizeSearchReplyText({
          userText,
          replyText: searchResponse.content ?? '',
          currentDateIso,
        });
        // Guardrail: when possible, require at least one source URL from the search model.
        // If a model returns a clean answer without any URLs, try the next candidate (bounded).
        const hasSourceUrl = SEARCH_RESPONSE_URL_PATTERN.test(content);
        if (!hasSourceUrl && attemptIndex < cappedAttemptOrder.length - 1) {
          modelResolutionEvents.push({
            phase: params.phase,
            iteration: params.iteration,
            route: 'search',
            selected: attemptModel,
            purpose: 'search_guardrail_attempt',
            attempt: attemptIndex + 1,
            attemptsTotal: cappedAttemptOrder.length,
            timeoutMs: attemptTimeoutMs,
            status: 'rejected_missing_sources',
          });
          continue;
        }

        // Freshness guardrail: for "latest/current/now" requests, require a check date and multiple sources.
        if (isTimeSensitiveQuery) {
          const hasCheckedOn = SEARCH_RESPONSE_CHECKED_ON_PATTERN.test(content);
          const uniqueUrlCount = extractSearchSourceUrls(content).length;
          const minRequiredSources = searchExecutionMode === 'complex' ? 2 : 1;
          if (
            (!hasCheckedOn || uniqueUrlCount < minRequiredSources) &&
            attemptIndex < cappedAttemptOrder.length - 1
          ) {
            modelResolutionEvents.push({
              phase: params.phase,
              iteration: params.iteration,
              route: 'search',
              selected: attemptModel,
              purpose: 'search_guardrail_attempt',
              attempt: attemptIndex + 1,
              attemptsTotal: cappedAttemptOrder.length,
              timeoutMs: attemptTimeoutMs,
              status: 'rejected_weak_freshness_grounding',
              details: {
                hasCheckedOn,
                uniqueUrlCount,
                minRequiredSources,
              },
            });
            continue;
          }
        }

        // Dual-search cross-check for time-sensitive queries in complex mode.
        // This improves correctness by giving the summarizer conflicting/confirming evidence to reconcile.
        if (isTimeSensitiveQuery && searchExecutionMode === 'complex' && cappedAttemptOrder.length > 1) {
          const secondaryModel = cappedAttemptOrder.find((model) => model !== attemptModel) ?? null;
          if (secondaryModel) {
            try {
              const secondaryClient = createLLMClient('pollinations', { chatModel: secondaryModel });
              const crossCheckTimeoutMs = Math.min(attemptTimeoutMs, 60_000);
              const secondaryResponse = await secondaryClient.chat({
                messages: searchMessages,
                model: secondaryModel,
                apiKey,
                temperature: searchTemperature,
                timeout: crossCheckTimeoutMs,
                maxTokens: routeOutputMaxTokens,
              });
              const secondaryContent = normalizeSearchReplyText({
                userText,
                replyText: secondaryResponse.content ?? '',
                currentDateIso,
              });
              const secondaryHasUrl = SEARCH_RESPONSE_URL_PATTERN.test(secondaryContent);
              if (secondaryHasUrl) {
                return `Primary search findings:\n${content}\n\nSecondary cross-check:\n${secondaryContent}`;
              }
            } catch (secondaryError) {
              logger.warn(
                { error: secondaryError, traceId, phase: params.phase, iteration: params.iteration },
                'Secondary search cross-check failed; returning primary search findings',
              );
            }
          }
        }

        return content;
      } catch (error) {
        lastError = error;
        recordModelOutcome({
          model: attemptModel,
          success: false,
        });
        modelResolutionEvents.push({
          phase: params.phase,
          iteration: params.iteration,
          route: 'search',
          selected: attemptModel,
          purpose: 'search_guardrail_attempt',
          attempt: attemptIndex + 1,
          attemptsTotal: cappedAttemptOrder.length,
          timeoutMs: attemptTimeoutMs,
          status: 'failed',
          errorText: error instanceof Error ? error.message : String(error),
        });
        logger.warn(
          {
            traceId,
            phase: params.phase,
            iteration: params.iteration,
            model: attemptModel,
            attempt: attemptIndex + 1,
            attemptsTotal: cappedAttemptOrder.length,
            timeoutMs: attemptTimeoutMs,
            error,
          },
          'Search model attempt failed; trying next guarded search model',
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Search model attempts exhausted without success.');
  };

  const runSearchSummaryPass = async (params: {
    phase: string;
    iteration?: number;
    searchDraft: string;
    summaryReason?: string;
    priorDraft?: string;
  }): Promise<string> => {
    const buildSearchFindingsBlob = (draft: string): string => {
      const baseFindings = draft.trim();

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
    const priorDraftForComparison = cleanDraftText(params.priorDraft);
    const summaryModelDetails = await resolveModelForRequestDetailed({
      guildId,
      messages: [
        {
          role: 'user',
          content:
            `Original user request:\n${userText}\n\n` +
            `Search findings:\n${searchFindingsBlob}` +
            (priorDraftForComparison ? `\n\nPrevious draft to compare:\n${priorDraftForComparison}` : ''),
        },
      ],
      route: 'chat',
      allowedModels: tenantPolicy.allowedModels,
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
          'Use ONLY the information present in "Search findings" as ground truth; do not introduce new facts. ' +
          'When a previous draft is provided, compare it against refreshed findings: keep only validated points and remove or fix invalid points. ' +
          'If a needed detail is not present in the findings, omit it or mark it as unknown. ' +
          'Preserve or improve concise source cues (domains or URLs) for external factual claims and keep them attached to the relevant claims. ' +
          'If the findings include a "Checked on: YYYY-MM-DD" line, preserve it. ' +
          'Prefer eliminating contradictions over combining them. ' +
          'When sources conflict, prefer primary/official sources and discard third-party trackers/blog claims. ' +
          'Output format (plain text):\n' +
          'Answer: <final answer>\n' +
          'Source URLs: <one or more URLs>\n' +
          'Checked on: <YYYY-MM-DD> (only when available/required) ' +
          'Return plain text only.',
      },
      {
        role: 'user',
        content:
          `Original user request:\n${userText}\n\n` +
          `Search findings:\n${searchFindingsBlob}` +
          (priorDraftForComparison ? `\n\nPrevious draft to compare:\n${priorDraftForComparison}` : '') +
          (params.summaryReason?.trim() ? `\n\nFocus:\n${params.summaryReason.trim()}` : ''),
      },
    ];

    const startedAt = Date.now();
    try {
      const summaryResponse = await client.chat({
        messages: summaryMessages,
        model: summaryModel,
        apiKey,
        temperature: 0.4,
        timeout: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: routeOutputMaxTokens,
      });
      recordModelOutcome({
        model: summaryModel,
        success: true,
        latencyMs: Date.now() - startedAt,
      });
      return normalizeSearchReplyText({
        userText,
        replyText: summaryResponse.content,
        currentDateIso: new Date().toISOString().slice(0, 10),
        sourceUrls: extractSearchSourceUrls(searchFindingsBlob),
      });
    } catch (error) {
      recordModelOutcome({
        model: summaryModel,
        success: false,
      });
      throw error;
    }
  };
  let toolLoopBudgetJson: Record<string, unknown> | undefined;
  const buildToolLoopConfig = () => ({
    maxRounds: toPositiveInt(
      (appConfig.AGENTIC_TOOL_MAX_ROUNDS as number | undefined),
      2,
    ),
    maxCallsPerRound: toPositiveInt(
      (appConfig.AGENTIC_TOOL_MAX_CALLS_PER_ROUND as number | undefined),
      3,
    ),
    toolTimeoutMs: toPositiveInt(
      (appConfig.AGENTIC_TOOL_TIMEOUT_MS as number | undefined),
      45_000,
    ),
    maxToolResultChars: toPositiveInt(
      (appConfig.AGENTIC_TOOL_RESULT_MAX_CHARS as number | undefined),
      4_000,
    ),
    parallelReadOnlyTools:
      (appConfig.AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED as boolean | undefined) ?? true,
    maxParallelReadOnlyTools: toPositiveInt(
      (appConfig.AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY as number | undefined),
      3,
    ),
    cacheEnabled: true,
    cacheMaxEntries: 50,
  });
  const globalToolPolicy = parseToolPolicyJson(
    (appConfig.AGENTIC_TOOL_POLICY_JSON as string | undefined) ?? '',
  );
  const buildToolPolicy = (): ToolPolicyConfig => {
    const legacyPolicy: ToolPolicyConfig = {
      allowNetworkRead: true,
      allowDataExfiltrationRisk: true,
      allowExternalWrite: !!(appConfig.AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE as boolean | undefined),
      allowHighRisk: !!(appConfig.AGENTIC_TOOL_ALLOW_HIGH_RISK as boolean | undefined),
      blockedTools: parseToolBlocklistCsv(
        (appConfig.AGENTIC_TOOL_BLOCKLIST_CSV as string | undefined) ?? '',
      ),
    };
    const tenantPolicyOverrides: ToolPolicyConfig = {
      allowNetworkRead: tenantPolicy.toolAllowNetworkRead,
      allowDataExfiltrationRisk: tenantPolicy.toolAllowDataExfiltrationRisk,
      allowExternalWrite: tenantPolicy.toolAllowExternalWrite,
      allowHighRisk: tenantPolicy.toolAllowHighRisk,
      blockedTools: tenantPolicy.toolBlockedTools,
      riskOverrides: tenantPolicy.toolRiskOverrides,
    };
    return mergeToolPolicyConfig(
      mergeToolPolicyConfig(legacyPolicy, globalToolPolicy),
      tenantPolicyOverrides,
    );
  };
  const effectiveToolPolicy = buildToolPolicy();
  const toolExecutionProfile: ToolExecutionContext['toolExecutionProfile'] =
    agentDecision.kind === 'search' && searchExecutionMode === 'complex'
      ? 'search_complex'
      : 'default';
  const buildToolExecutionContext = (): ToolExecutionContext => ({
    traceId,
    userId,
    channelId,
    guildId,
    apiKey,
    routeKind: agentDecision.kind,
    searchMode: searchExecutionMode,
    toolExecutionProfile,
  });
  const runSearchToolPass = async (params: {
    phase: string;
    iteration?: number;
    revisionInstruction?: string;
    priorDraft?: string;
  }): Promise<{
    draft: string;
    loopBudget: Record<string, unknown>;
  }> => {
    if (!toolLoopEnabled || !scopedToolRegistry) {
      throw new Error('Search tool loop is disabled or has no scoped registry.');
    }

    const supplementalHints: string[] = [
      'Search route tool requirements:',
      '- Use tools for externally verifiable facts.',
      '- Call web_search before finalizing factual or freshness-sensitive answers.',
      '- When user provides URL(s), call web_scrape on those URL(s).',
      '- Keep source-backed claims tied to URLs.',
      '- If user asks latest/current/now, include "Checked on: YYYY-MM-DD".',
    ];
    if (searchExecutionMode === 'complex') {
      supplementalHints.push('- Compare and reconcile multiple sources before concluding.');
      supplementalHints.push(
        '- Complex search profile: prefer non-LLM retrieval tools first (web_search via searxng/tavily/exa, web_scrape via crawl4ai/jina/raw_fetch).',
      );
      supplementalHints.push('- Avoid AI-search fallbacks unless explicitly required.');
    }
    if (params.revisionInstruction?.trim()) {
      supplementalHints.push(`Critic focus: ${params.revisionInstruction.trim()}`);
    }
    const priorDraft = cleanDraftText(params.priorDraft);
    if (priorDraft) {
      supplementalHints.push(`Prior draft to improve:\n${priorDraft}`);
    }
    supplementalHints.push(`Current date: ${new Date().toISOString().slice(0, 10)}`);

    const searchMessages: LLMChatMessage[] = [
      ...runtimeMessages,
      {
        role: 'system',
        content: supplementalHints.join('\n'),
      },
    ];

    let searchModel = '';
    if (searchExecutionMode === 'complex') {
      const tenantAllowedModels = tenantPolicy.allowedModels;
      if (
        Array.isArray(tenantAllowedModels) &&
        tenantAllowedModels.length > 0 &&
        !tenantAllowedModels.some(
          (modelId) =>
            modelId.trim().toLowerCase() === COMPLEX_SEARCH_TOOL_ORCHESTRATOR_MODEL,
        )
      ) {
        throw new Error(
          `Complex search tool orchestrator requires "${COMPLEX_SEARCH_TOOL_ORCHESTRATOR_MODEL}", ` +
          'but tenant allowedModels excludes it.',
        );
      }
      searchModel = COMPLEX_SEARCH_TOOL_ORCHESTRATOR_MODEL;
      modelResolutionEvents.push({
        phase: params.phase,
        iteration: params.iteration,
        route: 'search',
        selected: searchModel,
        candidates: [searchModel],
        decisions: [
          {
            model: searchModel,
            accepted: true,
            reason: 'selected',
          },
        ],
        allowlistApplied: Array.isArray(tenantPolicy.allowedModels) && tenantPolicy.allowedModels.length > 0,
        purpose: 'search_tool_loop_complex_orchestrator',
        scopedTools: activeToolNames,
      });
    } else {
      const searchModelDetails = await resolveModelForRequestDetailed({
        guildId,
        messages: searchMessages,
        route: 'search',
        allowedModels: tenantPolicy.allowedModels,
        featureFlags: {
          search: true,
          tools: true,
          linkScrape: userTextHasLink || undefined,
        },
      });
      searchModel = searchModelDetails.model;
      modelResolutionEvents.push({
        phase: params.phase,
        iteration: params.iteration,
        route: searchModelDetails.route,
        selected: searchModelDetails.model,
        candidates: searchModelDetails.candidates,
        decisions: searchModelDetails.decisions,
        allowlistApplied: searchModelDetails.allowlistApplied,
        purpose: 'search_tool_loop',
        scopedTools: activeToolNames,
      });
    }

    const scopedToolSpecs = scopedToolRegistry
      .listOpenAIToolSpecs()
      .map((tool) => ({
        type: tool.type,
        function: {
          ...tool.function,
          parameters: tool.function.parameters as Record<string, unknown>,
        },
      }));

    const searchToolTemperature = Math.max(0.1, (agentDecision.temperature ?? 0.3) - 0.1);
    const searchToolMaxTokens = toPositiveInt(
      (appConfig.AGENTIC_TOOL_MAX_OUTPUT_TOKENS as number | undefined),
      1_200,
    );
    const toolLoopConfig = buildToolLoopConfig();
    const searchCallStartedAt = Date.now();
    const initialResponse = await client.chat({
      messages: searchMessages,
      model: searchModel,
      apiKey,
      temperature: searchToolTemperature,
      timeout: appConfig.TIMEOUT_CHAT_MS,
      maxTokens: routeOutputMaxTokens,
      tools: scopedToolSpecs,
      toolChoice: scopedToolSpecs.length > 0 ? 'auto' : undefined,
    });
    recordModelOutcome({
      model: searchModel,
      success: true,
      latencyMs: Date.now() - searchCallStartedAt,
    });

    const loopStartedAt = Date.now();
    const initialLoopResult = await runToolCallLoop({
      client,
      messages: searchMessages,
      registry: scopedToolRegistry,
      ctx: buildToolExecutionContext(),
      model: searchModel,
      apiKey,
      temperature: searchToolTemperature,
      timeoutMs: appConfig.TIMEOUT_CHAT_MS,
      maxTokens: searchToolMaxTokens,
      initialAssistantResponseText: initialResponse.content,
      config: toolLoopConfig,
      toolPolicy: effectiveToolPolicy,
    });

    let loopResult = initialLoopResult;
    let successfulToolCount = loopResult.toolResults.filter((toolResult) => toolResult.success).length;
    let hardGateForcedBudget: Record<string, unknown> | undefined;
    if (
      requiresToolEvidenceThisTurn &&
      successfulToolCount < toolHardGateMinSuccessfulCalls
    ) {
      logger.warn(
        {
          traceId,
          phase: params.phase,
          iteration: params.iteration,
          routeKind: agentDecision.kind,
          successfulToolCount,
          required: toolHardGateMinSuccessfulCalls,
        },
        'Search tool hard gate unmet on initial pass; forcing a tool-backed retry',
      );
      const forcedGateInstruction =
        buildToolHardGateInstruction({
          routeKind: agentDecision.kind,
          searchMode: searchExecutionMode,
          minSuccessfulCalls: toolHardGateMinSuccessfulCalls,
          toolNames: activeToolNames,
        }) +
        '\nUse tools now before finalizing. If tools fail, explicitly mention the limitation.';
      const priorDraftForForcedPass =
        cleanDraftText(stripToolEnvelopeDraft(loopResult.replyText) ?? loopResult.replyText) ??
        cleanDraftText(stripToolEnvelopeDraft(initialResponse.content) ?? initialResponse.content) ??
        'Previous pass did not produce a final answer.';
      const forcedMessages: LLMChatMessage[] = [
        ...searchMessages,
        { role: 'assistant', content: priorDraftForForcedPass },
        { role: 'system', content: forcedGateInstruction },
      ];
      const forcedSearchStartedAt = Date.now();
      const forcedInitialResponse = await client.chat({
        messages: forcedMessages,
        model: searchModel,
        apiKey,
        temperature: searchToolTemperature,
        timeout: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: routeOutputMaxTokens,
        tools: scopedToolSpecs,
        toolChoice: scopedToolSpecs.length > 0 ? 'auto' : undefined,
      });
      recordModelOutcome({
        model: searchModel,
        success: true,
        latencyMs: Date.now() - forcedSearchStartedAt,
      });
      modelResolutionEvents.push({
        phase: params.phase,
        iteration: params.iteration,
        route: 'search',
        selected: searchModel,
        purpose: 'search_tool_loop_forced_retry',
        required: toolHardGateMinSuccessfulCalls,
      });
      const forcedLoopStartedAt = Date.now();
      const forcedLoopResult = await runToolCallLoop({
        client,
        messages: forcedMessages,
        registry: scopedToolRegistry,
        ctx: buildToolExecutionContext(),
        model: searchModel,
        apiKey,
        temperature: searchToolTemperature,
        timeoutMs: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: searchToolMaxTokens,
        initialAssistantResponseText: forcedInitialResponse.content,
        config: toolLoopConfig,
        toolPolicy: effectiveToolPolicy,
      });
      const forcedSuccessfulToolCount = forcedLoopResult.toolResults.filter((toolResult) => toolResult.success).length;
      if (forcedSuccessfulToolCount < toolHardGateMinSuccessfulCalls) {
        throw new Error(
          `Search tool hard gate unmet after forced retry. Required=${toolHardGateMinSuccessfulCalls}, got=${forcedSuccessfulToolCount}.`,
        );
      }
      loopResult = forcedLoopResult;
      successfulToolCount = forcedSuccessfulToolCount;
      hardGateForcedBudget = {
        mode: 'search_hard_gate_forced_retry',
        toolsExecuted: forcedLoopResult.toolsExecuted,
        roundsCompleted: forcedLoopResult.roundsCompleted,
        toolResultCount: forcedLoopResult.toolResults.length,
        successfulToolCount: forcedSuccessfulToolCount,
        policyDecisions: forcedLoopResult.policyDecisions,
        toolExecutionSummary: summarizeSearchPipelineToolExecution({
          toolResults: forcedLoopResult.toolResults,
          policyDecisions: forcedLoopResult.policyDecisions,
          deduplicatedCallCount: forcedLoopResult.deduplicatedCallCount,
        }),
        deduplicatedCallCount: forcedLoopResult.deduplicatedCallCount ?? 0,
        latencyMs: Date.now() - forcedLoopStartedAt,
      };
    }
    if (successfulToolCount === 0) {
      throw new Error('Search tool loop produced no successful tool calls.');
    }

    const cleanedReply = cleanDraftText(stripToolEnvelopeDraft(loopResult.replyText) ?? loopResult.replyText) ?? '';
    if (!cleanedReply) {
      throw new Error('Search tool loop returned empty final text.');
    }
    const supplementalSourceUrls = extractSourceUrlsFromToolResults(loopResult.toolResults);
    const normalizedReply = normalizeSearchReplyText({
      userText,
      replyText: cleanedReply,
      currentDateIso: new Date().toISOString().slice(0, 10),
      sourceUrls: supplementalSourceUrls,
    });

    return {
      draft: normalizedReply,
      loopBudget: {
        enabled: true,
        route: 'search',
        mode: searchExecutionMode,
        toolExecutionProfile,
        orchestratorModel: searchModel,
        toolsExecuted: loopResult.toolsExecuted,
        roundsCompleted: loopResult.roundsCompleted,
        toolResultCount: loopResult.toolResults.length,
        successfulToolCount,
        policyDecisions: loopResult.policyDecisions,
        toolExecutionSummary: summarizeSearchPipelineToolExecution({
          toolResults: loopResult.toolResults,
          policyDecisions: loopResult.policyDecisions,
          deduplicatedCallCount: loopResult.deduplicatedCallCount,
        }),
        deduplicatedCallCount: loopResult.deduplicatedCallCount ?? 0,
        sourceUrls: supplementalSourceUrls,
        scopedTools: activeToolNames,
        latencyMs: Date.now() - loopStartedAt,
        hardGateForcedPass: hardGateForcedBudget,
      },
    };
  };
  const runSearchPassWithFallback = async (params: {
    phase: string;
    iteration?: number;
    revisionInstruction?: string;
    priorDraft?: string;
  }): Promise<string> => {
    if (toolLoopEnabled && scopedToolRegistry) {
      try {
        const toolPass = await runSearchToolPass(params);
        if (params.phase === 'search_initial') {
          toolLoopBudgetJson = {
            ...toolPass.loopBudget,
            hardGateRequired: requiresToolEvidenceThisTurn,
            hardGateSatisfied: true,
            hardGateMinSuccessfulCalls: toolHardGateMinSuccessfulCalls,
          };
        }
        return toolPass.draft;
      } catch (error) {
        canaryToolLoopFailed = true;
        if (requiresToolEvidenceThisTurn && agentDecision.kind === 'search') {
          canaryHardGateUnmet = true;
          throw new Error(
            `Search hard gate unmet: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        logger.warn(
          { error, traceId, phase: params.phase, iteration: params.iteration },
          'Search tool loop pass failed; falling back to guarded search model pass',
        );
      }
    }
    return runSearchPass(params);
  };

  // --- SEARCH AGENT ---
  if (agentDecision.kind === 'search') {
    logger.info({ traceId, userText, searchExecutionMode }, 'Agent Runtime: Executing Search Agent');
    try {
      draftText = await runSearchPassWithFallback({ phase: 'search_initial' });

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
      const searchErrorText = searchError instanceof Error ? searchError.message.toLowerCase() : String(searchError);
      skipCriticLoop = true;
      if (searchErrorText.includes('hard gate')) {
        canaryHardGateUnmet = true;
        criticSkipReason = 'search_hard_gate_unmet';
      } else {
        criticSkipReason = 'search_agent_failed';
      }
      draftText = searchErrorText.includes('hard gate')
        ? "I couldn't verify this request with tools right now, so I won't provide an unverified answer. Please try again."
        : "I couldn't complete the search request at this time.";
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
        featureFlags: toolLoopEnabled ? { tools: true } : undefined,
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
      const toolSpecs = toolLoopEnabled && scopedToolRegistry
        ? scopedToolRegistry.listOpenAIToolSpecs().map((tool) => ({
          type: tool.type,
          function: {
            ...tool.function,
            parameters: tool.function.parameters as Record<string, unknown>,
          },
        }))
        : undefined;

      const mainCallStartedAt = Date.now();
      const response = await client.chat({
        messages: runtimeMessages,
        model: resolvedModel,
        apiKey,
        temperature: agentDecision.temperature,
        timeout: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: routeOutputMaxTokens,
        tools: toolSpecs,
        toolChoice: toolSpecs ? 'auto' : undefined,
      });
      recordModelOutcome({
        model: resolvedModel,
        success: true,
        latencyMs: Date.now() - mainCallStartedAt,
      });

      draftText = response.content;

      if (toolLoopEnabled && scopedToolRegistry) {
        const toolLoopStartedAt = Date.now();
        const toolLoopConfig = buildToolLoopConfig();
        const toolPolicy = effectiveToolPolicy;
        const toolEvidenceRequiredForMainPass =
          requiresToolEvidenceThisTurn &&
          (agentDecision.kind === 'chat' || agentDecision.kind === 'coding');
        const forcedGateInstruction = buildToolHardGateInstruction({
          routeKind: agentDecision.kind,
          searchMode: searchExecutionMode,
          minSuccessfulCalls: toolHardGateMinSuccessfulCalls,
          toolNames: activeToolNames,
        });

        const runForcedToolEvidencePass = async (priorDraft: string): Promise<{
          replyText: string;
          budget: Record<string, unknown>;
        }> => {
          if (!scopedToolRegistry) {
            throw new Error('Tool hard gate requested without an active tool registry.');
          }
          const scopedToolSpecs = scopedToolRegistry
            .listOpenAIToolSpecs()
            .map((tool) => ({
              type: tool.type,
              function: {
                ...tool.function,
                parameters: tool.function.parameters as Record<string, unknown>,
              },
            }));
          if (scopedToolSpecs.length === 0) {
            throw new Error('Tool hard gate requested but no scoped tools are available.');
          }

          const forcedMessages: LLMChatMessage[] = [
            ...runtimeMessages,
            { role: 'assistant', content: priorDraft },
            {
              role: 'system',
              content:
                forcedGateInstruction +
                '\nUse tools now before finalizing. If tools fail, explicitly mention the limitation.',
            },
          ];

          const forcedStartedAt = Date.now();
          const initialForcedResponse = await client.chat({
            messages: forcedMessages,
            model: resolvedModel,
            apiKey,
            temperature: agentDecision.temperature,
            timeout: appConfig.TIMEOUT_CHAT_MS,
            maxTokens: routeOutputMaxTokens,
            tools: scopedToolSpecs,
            toolChoice: 'auto',
          });
          recordModelOutcome({
            model: resolvedModel,
            success: true,
            latencyMs: Date.now() - forcedStartedAt,
          });

          const forcedLoopStartedAt = Date.now();
          const forcedLoopResult = await runToolCallLoop({
            client,
            messages: forcedMessages,
            registry: scopedToolRegistry,
            ctx: buildToolExecutionContext(),
            model: resolvedModel,
            apiKey,
            temperature: agentDecision.temperature,
            timeoutMs: appConfig.TIMEOUT_CHAT_MS,
            maxTokens: toPositiveInt(
              (appConfig.AGENTIC_TOOL_MAX_OUTPUT_TOKENS as number | undefined),
              1_200,
            ),
            initialAssistantResponseText: initialForcedResponse.content,
            config: toolLoopConfig,
            toolPolicy,
          });

          const successfulToolCount = forcedLoopResult.toolResults.filter((toolResult) => toolResult.success).length;
          if (successfulToolCount < toolHardGateMinSuccessfulCalls) {
            throw new Error(
              `Tool hard gate unmet in forced pass. Required=${toolHardGateMinSuccessfulCalls}, got=${successfulToolCount}.`,
            );
          }

          const cleanedReply = cleanDraftText(
            stripToolEnvelopeDraft(forcedLoopResult.replyText) ?? forcedLoopResult.replyText,
          );
          if (!cleanedReply) {
            throw new Error('Tool hard gate forced pass returned empty reply.');
          }

          return {
            replyText: cleanedReply,
            budget: {
              mode: 'hard_gate_forced_pass',
              toolsExecuted: forcedLoopResult.toolsExecuted,
              roundsCompleted: forcedLoopResult.roundsCompleted,
              toolResultCount: forcedLoopResult.toolResults.length,
              successfulToolCount,
              policyDecisions: forcedLoopResult.policyDecisions,
              latencyMs: Date.now() - forcedLoopStartedAt,
            },
          };
        };

        try {
          const loopResult = await runToolCallLoop({
            client,
            messages: runtimeMessages,
            registry: scopedToolRegistry,
            ctx: buildToolExecutionContext(),
            model: resolvedModel,
            apiKey,
            temperature: agentDecision.temperature,
            timeoutMs: appConfig.TIMEOUT_CHAT_MS,
            maxTokens: toPositiveInt(
              (appConfig.AGENTIC_TOOL_MAX_OUTPUT_TOKENS as number | undefined),
              1_200,
            ),
            initialAssistantResponseText: response.content,
            config: toolLoopConfig,
            toolPolicy,
          });

          draftText = loopResult.replyText;
          const successfulToolCount = loopResult.toolResults.filter((toolResult) => toolResult.success).length;
          let hardGateSatisfied = !toolEvidenceRequiredForMainPass;
          let hardGateForcedBudget: Record<string, unknown> | undefined;

          if (toolEvidenceRequiredForMainPass && successfulToolCount < toolHardGateMinSuccessfulCalls) {
            logger.warn(
              {
                traceId,
                successfulToolCount,
                required: toolHardGateMinSuccessfulCalls,
                routeKind: agentDecision.kind,
              },
              'Tool hard gate unmet on initial pass; forcing tool-backed verification pass',
            );
            try {
              const forcedResult = await runForcedToolEvidencePass(
                cleanDraftText(draftText) ?? cleanDraftText(response.content) ?? draftText,
              );
              draftText = forcedResult.replyText;
              hardGateSatisfied = true;
              hardGateForcedBudget = forcedResult.budget;
            } catch (hardGateError) {
              hardGateSatisfied = false;
              canaryHardGateUnmet = true;
              canaryToolLoopFailed = true;
              logger.warn(
                {
                  error: hardGateError,
                  traceId,
                  routeKind: agentDecision.kind,
                },
                'Tool hard gate forced pass failed',
              );
              draftText =
                "I couldn't verify this with tools right now, so I won't provide an unverified answer. Please try again.";
            }
          } else if (toolEvidenceRequiredForMainPass) {
            hardGateSatisfied = true;
          }

          toolLoopBudgetJson = {
            enabled: true,
            toolsExecuted: loopResult.toolsExecuted,
            roundsCompleted: loopResult.roundsCompleted,
            toolResultCount: loopResult.toolResults.length,
            successfulToolCount,
            policyDecisions: loopResult.policyDecisions,
            latencyMs: Date.now() - toolLoopStartedAt,
            hardGateRequired: toolEvidenceRequiredForMainPass,
            hardGateSatisfied,
            hardGateMinSuccessfulCalls: toolHardGateMinSuccessfulCalls,
            hardGateForcedPass: hardGateForcedBudget,
          };
          modelResolutionEvents.push({
            phase: 'tool_loop',
            route: resolvedModelDetails.route,
            selected: resolvedModel,
            toolsExecuted: loopResult.toolsExecuted,
            roundsCompleted: loopResult.roundsCompleted,
            toolResultCount: loopResult.toolResults.length,
            successfulToolCount,
            policyDecisionCount: loopResult.policyDecisions.length,
            hardGateRequired: toolEvidenceRequiredForMainPass,
            hardGateSatisfied,
          });
          if (Array.isArray(agentEventsJson)) {
            agentEventsJson.push({
              type: 'tool_loop',
              timestamp: new Date().toISOString(),
              details: {
                toolsExecuted: loopResult.toolsExecuted,
                roundsCompleted: loopResult.roundsCompleted,
                toolResultCount: loopResult.toolResults.length,
                successfulToolCount,
                policyDecisionCount: loopResult.policyDecisions.length,
                hardGateRequired: toolEvidenceRequiredForMainPass,
                hardGateSatisfied,
              },
            });
          }
        } catch (toolLoopError) {
          canaryToolLoopFailed = true;
          logger.warn(
            { error: toolLoopError, traceId },
            'Tool loop failed; keeping initial model response',
          );
          toolLoopBudgetJson = {
            enabled: true,
            failed: true,
            latencyMs: Date.now() - toolLoopStartedAt,
            errorText: toolLoopError instanceof Error ? toolLoopError.message : String(toolLoopError),
            hardGateRequired: toolEvidenceRequiredForMainPass,
            hardGateSatisfied: !toolEvidenceRequiredForMainPass,
            hardGateMinSuccessfulCalls: toolHardGateMinSuccessfulCalls,
          };
          if (toolEvidenceRequiredForMainPass) {
            canaryHardGateUnmet = true;
            draftText =
              "I couldn't verify this with tools right now, so I won't provide an unverified answer. Please try again.";
          }
        }
      }

      const cleanedToolLoopDraft = stripToolEnvelopeDraft(draftText);
      if (!cleanedToolLoopDraft) {
        draftText =
          'I completed part of the request but could not format a final response. Please ask me to try once more.';
      } else {
        draftText = cleanedToolLoopDraft;
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
    rewritePrompt: string;
  }> = [];
  const criticRedispatches: Array<Record<string, unknown>> = [];
  const criticToolLoopBudgets: Array<Record<string, unknown>> = [];
  let revisionAttempts = 0;
  let revisionApplied = 0;

  const buildCriticToolExecutionSummary = (): string | null => {
    const summary: Record<string, unknown> = {
      toolsAvailable: activeToolNames,
      toolLoopEnabled,
      searchPipeline:
        agentDecision.kind === 'search'
          ? {
              mode: searchExecutionMode,
              toolExecutionProfile,
            }
          : undefined,
    };
    if (toolLoopBudgetJson) {
      summary.initialToolLoop = toolLoopBudgetJson;
    }
    if (criticToolLoopBudgets.length > 0) {
      summary.criticToolLoops = criticToolLoopBudgets.slice(-3);
    }
    return JSON.stringify(summary);
  };

  const shouldUseToolBackedRevision = (issues: string[], rewritePrompt: string): boolean => {
    if (!toolLoopEnabled || !scopedToolRegistry) return false;
    if (agentDecision.kind === 'creative') return false;
    const hintBlob = `${issues.join(' ')} ${rewritePrompt}`.toLowerCase();
    if (!hintBlob.trim()) return false;
    const verificationPattern =
      /(verify|verification|source|citation|fact|factual|latest|current|version|package|dependency|api|docs?|command|install|runtime|outdated|stale|incorrect|wrong|insecure)/i;
    return verificationPattern.test(hintBlob);
  };

  const deriveCriticRedispatchProviders = (
    issues: string[],
  ): (typeof activeContextProviders)[number][] => {
    const issueText = issues.join(' ').toLowerCase();
    const providers = new Set<(typeof activeContextProviders)[number]>();

    if (/(fact|factual|correct|accuracy|halluc|citation|source|verify|evidence)/.test(issueText)) {
      providers.add('UserMemory');
    }
    if (/(relationship|friend|social|tone|persona|community)/.test(issueText)) {
      providers.add('SocialGraph');
    }
    if (/(voice|speaker|audio|talked|vc)/.test(issueText)) {
      providers.add('VoiceAnalytics');
    }
    if (/(summary|summar|context|missing context|thread)/.test(issueText)) {
      providers.add('ChannelMemory');
    }
    if (/(attachment|attached|uploaded file|cached file|file recall|file retrieval)/.test(issueText)) {
      providers.add('ChannelMemory');
    }

    const allowedProviders = activeContextProviders;
    return [...providers].filter((provider) => allowedProviders.includes(provider));
  };

  if (skipCriticLoop) {
    logger.info(
      { traceId, routeKind: agentDecision.kind, reason: criticSkipReason },
      'Skipping critic loop after terminal search fallback',
    );
    if (Array.isArray(agentEventsJson)) {
      agentEventsJson.push({
        type: 'critic_skipped',
        timestamp: new Date().toISOString(),
        details: {
          reason: criticSkipReason,
          routeKind: agentDecision.kind,
        },
      });
    }
  }

  if (
    shouldRunCritic({
      config: criticConfig,
      routeKind: agentDecision.kind,
      draftText,
      isVoiceActive,
      hasFiles: files.length > 0,
      skip: skipCriticLoop,
    })
  ) {
    for (let iteration = 1; iteration <= criticConfig.maxLoops; iteration += 1) {
      const assessment = await evaluateDraftWithCritic({
        guildId,
        routeKind: agentDecision.kind,
        userText,
        draftText,
        availableTools: activeToolNames,
        toolExecutionSummary: buildCriticToolExecutionSummary(),
        allowedModels: tenantPolicy.allowedModels,
        apiKey,
        timeoutMs: Math.min(240_000, appConfig.TIMEOUT_CHAT_MS),
        maxTokens: criticOutputMaxTokens,
        conversationHistory,
      });

      if (!assessment) {
        // If the critic fails to return valid JSON, don't silently skip quality controls on search.
        // Prefer a fresh search pass to recover (bounded by maxLoops).
        if (agentDecision.kind === 'search') {
           criticAssessments.push({
             iteration,
             score: 0,
             verdict: 'revise',
             model: 'unknown',
             issues: ['Critic assessment failed (invalid JSON).'],
             rewritePrompt: '',
           });

          const revisionInstruction =
            'Critic assessment failed (invalid JSON). Re-run search verification and return a source-grounded answer. ' +
            'Include concise source cues (domains or URLs) for key factual claims. Avoid unsupported certainty.';

           try {
             const priorDraftForComparison = draftText;
             revisionAttempts += 1;
             draftText = await runSearchPassWithFallback({
                phase: 'critic_search_refresh_on_null',
                iteration,
                revisionInstruction,
                priorDraft: draftText,
              });
             revisionApplied += 1;

             if (searchExecutionMode === 'complex') {
               try {
                 revisionAttempts += 1;
                 draftText = await runSearchSummaryPass({
                   phase: 'critic_search_refresh_on_null_summary',
                   iteration,
                   searchDraft: draftText,
                   summaryReason: revisionInstruction,
                   priorDraft: priorDraftForComparison,
                 });
                 revisionApplied += 1;
               } catch (summaryError) {
                 logger.warn(
                   { error: summaryError, traceId, iteration },
                   'Critic-null search refresh summary failed; keeping refreshed search draft',
                );
              }
            }

            criticRedispatches.push({
              iteration,
              mode: 'search_refresh_on_null',
            });
            if (Array.isArray(agentEventsJson)) {
              agentEventsJson.push({
                type: 'critic_search_refresh_on_null',
                timestamp: new Date().toISOString(),
                details: { iteration },
              });
            }
            continue;
          } catch (error) {
            logger.warn({ error, traceId, iteration }, 'Critic-null search refresh failed; stopping critic loop');
          }
        }

        break;
      }

       criticAssessments.push({
         iteration,
         score: assessment.score,
         verdict: assessment.verdict,
         model: assessment.model,
         issues: assessment.issues,
         rewritePrompt: assessment.rewritePrompt,
       });

      const shouldReviseFromCritic = shouldRequestRevision({
        assessment,
        minScore: criticConfig.minScore,
      });
      const shouldForceSearchRefresh = shouldForceSearchRefreshFromDraft({
        routeKind: agentDecision.kind,
        userText,
        draftText,
      });
      if (!shouldReviseFromCritic && !shouldForceSearchRefresh) {
        break;
      }

      const revisionInstruction =
        assessment.rewritePrompt.trim() ||
        (assessment.issues.length > 0
          ? `Fix the following issues: ${assessment.issues.join('; ')}`
          : shouldForceSearchRefresh
            ? 'Re-run search verification. Produce a fresher, source-grounded answer and include concise source cues.'
            : 'Improve factual precision and completeness while preserving tone.');

       if (
         shouldForceSearchRefresh ||
         shouldRefreshSearchFromCritic({
           routeKind: agentDecision.kind,
           issues: assessment.issues,
           rewritePrompt: assessment.rewritePrompt,
         })
       ) {
         try {
           const priorDraftForComparison = draftText;
           revisionAttempts += 1;
           draftText = await runSearchPassWithFallback({
              phase: 'critic_search_refresh',
              iteration,
              revisionInstruction,
              priorDraft: draftText,
            });
           revisionApplied += 1;
           if (searchExecutionMode === 'complex') {
             try {
               revisionAttempts += 1;
               draftText = await runSearchSummaryPass({
                 phase: 'critic_search_refresh_summary',
                 iteration,
                 searchDraft: draftText,
                 summaryReason: revisionInstruction,
                 priorDraft: priorDraftForComparison,
               });
               revisionApplied += 1;
               criticRedispatches.push({
                 iteration,
                 mode: 'search_refresh_summary',
                 issueCount: assessment.issues.length,
                forcedByDraftGuardrail: shouldForceSearchRefresh,
              });
              if (Array.isArray(agentEventsJson)) {
                agentEventsJson.push({
                  type: 'critic_search_refresh_summary',
                  timestamp: new Date().toISOString(),
                  details: {
                    iteration,
                    issueCount: assessment.issues.length,
                    forcedByDraftGuardrail: shouldForceSearchRefresh,
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
            forcedByDraftGuardrail: shouldForceSearchRefresh,
          });
          if (Array.isArray(agentEventsJson)) {
            agentEventsJson.push({
              type: 'critic_search_refresh',
              timestamp: new Date().toISOString(),
              details: {
                iteration,
                issueCount: assessment.issues.length,
                forcedByDraftGuardrail: shouldForceSearchRefresh,
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

      const routeSpecificRevisionContract =
        agentDecision.kind === 'coding'
          ? '\n\nCoding revision contract:\n' +
            '- Return a complete, runnable answer (no TODO placeholders).\n' +
            '- Fix all blocking security/correctness issues explicitly called out by the critic.\n' +
            '- Keep scope aligned to the user request; do not bloat with unrelated optional hardening.\n' +
            '- Never use insecure secret fallbacks or weaken existing safeguards.'
          : '';
      const toolBackedRevisionRequested = shouldUseToolBackedRevision(
        assessment.issues,
        assessment.rewritePrompt,
      ) || requiresToolEvidenceThisTurn;
      const revisionToolContract =
        toolBackedRevisionRequested && toolLoopEnabled && scopedToolRegistry
          ? '\n\nTool-backed revision contract:\n' +
            '- You may call tools to verify or fix critic-flagged issues.\n' +
            '- If the critic flagged factual/version/source/command issues, call at least one relevant tool before finalizing.\n' +
            '- Never invent tool outputs; use only observed tool results.'
          : '';

      const revisionMessages: LLMChatMessage[] = [
        ...runtimeMessages,
        { role: 'assistant', content: draftText },
        {
          role: 'system',
          content:
            `Critic requested revision:\n${revisionInstruction}` +
            (assessment.issues.length > 0
              ? `\n\nCritic issues to address:\n- ${assessment.issues.join('\n- ')}`
              : '\n\nCritic issues to address:\n- Improve correctness/completeness while preserving useful parts.') +
            '\n\nAddress every listed issue before returning your final answer.' +
            routeSpecificRevisionContract +
            revisionToolContract +
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

        revisionAttempts += 1;
        const revisionTemperature =
          agentDecision.kind === 'chat' ? agentDecision.temperature : Math.max(0.1, agentDecision.temperature - 0.2);

        const runDirectRevisionPass = async (): Promise<string | null> => {
          const revisionStartedAt = Date.now();
          const revisedResponse = await client.chat({
            messages: revisionMessages,
            model: revisionModel,
            apiKey,
            temperature: revisionTemperature,
            timeout: appConfig.TIMEOUT_CHAT_MS,
            maxTokens: routeOutputMaxTokens,
          });
          recordModelOutcome({
            model: revisionModel,
            success: true,
            latencyMs: Date.now() - revisionStartedAt,
          });
          return cleanDraftText(stripToolEnvelopeDraft(revisedResponse.content) ?? revisedResponse.content);
        };

        let revisedText: string | null = null;
        if (toolBackedRevisionRequested && toolLoopEnabled && scopedToolRegistry) {
          const scopedToolSpecs = scopedToolRegistry
            .listOpenAIToolSpecs()
            .map((tool) => ({
              type: tool.type,
              function: {
                ...tool.function,
                parameters: tool.function.parameters as Record<string, unknown>,
              },
            }));
          if (scopedToolSpecs.length > 0) {
            const toolRevisionStartedAt = Date.now();
            try {
              const initialResponse = await client.chat({
                messages: revisionMessages,
                model: revisionModel,
                apiKey,
                temperature: revisionTemperature,
                timeout: appConfig.TIMEOUT_CHAT_MS,
                maxTokens: routeOutputMaxTokens,
                tools: scopedToolSpecs,
                toolChoice: 'auto',
              });
              recordModelOutcome({
                model: revisionModel,
                success: true,
                latencyMs: Date.now() - toolRevisionStartedAt,
              });

              const loopStartedAt = Date.now();
              const loopResult = await runToolCallLoop({
                client,
                messages: revisionMessages,
                registry: scopedToolRegistry,
                ctx: buildToolExecutionContext(),
                model: revisionModel,
                apiKey,
                temperature: revisionTemperature,
                timeoutMs: appConfig.TIMEOUT_CHAT_MS,
                maxTokens: toPositiveInt(
                  (appConfig.AGENTIC_TOOL_MAX_OUTPUT_TOKENS as number | undefined),
                  1_200,
                ),
                initialAssistantResponseText: initialResponse.content,
                config: buildToolLoopConfig(),
                toolPolicy: effectiveToolPolicy,
              });

              const cleanedLoopReply = cleanDraftText(
                stripToolEnvelopeDraft(loopResult.replyText) ?? loopResult.replyText,
              );
              const toolLoopBudget = {
                iteration,
                mode: 'critic_tool_loop_revision',
                route: agentDecision.kind,
                searchMode: searchExecutionMode,
                toolExecutionProfile,
                toolsExecuted: loopResult.toolsExecuted,
                roundsCompleted: loopResult.roundsCompleted,
                toolResultCount: loopResult.toolResults.length,
                successfulToolCount: loopResult.toolResults.filter((toolResult) => toolResult.success).length,
                policyDecisions: loopResult.policyDecisions,
                toolExecutionSummary: summarizeSearchPipelineToolExecution({
                  toolResults: loopResult.toolResults,
                  policyDecisions: loopResult.policyDecisions,
                  deduplicatedCallCount: loopResult.deduplicatedCallCount,
                }),
                deduplicatedCallCount: loopResult.deduplicatedCallCount ?? 0,
                latencyMs: Date.now() - loopStartedAt,
              };
              criticToolLoopBudgets.push(toolLoopBudget);
              criticRedispatches.push(toolLoopBudget);
              if (Array.isArray(agentEventsJson)) {
                agentEventsJson.push({
                  type: 'critic_tool_loop_revision',
                  timestamp: new Date().toISOString(),
                  details: toolLoopBudget,
                });
              }

              if (cleanedLoopReply) {
                revisedText = cleanedLoopReply;
              } else {
                logger.warn(
                  { traceId, iteration, revisionModel },
                  'Critic tool-backed revision returned empty content; falling back to direct revision pass',
                );
              }
            } catch (toolLoopError) {
              canaryToolLoopFailed = true;
              recordModelOutcome({
                model: revisionModel,
                success: false,
              });
              logger.warn(
                { error: toolLoopError, traceId, iteration },
                'Critic tool-backed revision failed; falling back to direct revision pass',
              );
            }
          }
        }

        if (!revisedText) {
          revisedText = await runDirectRevisionPass();
        }

        if (!revisedText) {
          logger.warn(
            { traceId, iteration, revisionModel },
            'Critic revision returned empty content; keeping previous draft and stopping critic loop',
          );
          break;
        }

        draftText = revisedText;
        revisionApplied += 1;
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

  const routeValidationEnabled = routeValidationPolicy.strictness !== 'off';
  const initialValidationResult = validateResponseForRoute({
    routeKind: agentDecision.kind,
    userText,
    replyText: draftText,
    policy: routeValidationPolicy,
  });
  const initialValidationIssueCodes = initialValidationResult.issues.map((issue) => issue.code);
  let validationResult = initialValidationResult;
  let validationRepairAttempts = 0;
  let validationRepaired = false;
  let validationBlocked = false;

  const runDirectValidationRepair = async (
    instruction: string,
    attempt: number,
  ): Promise<string | null> => {
    const revisionMessages: LLMChatMessage[] = [
      ...runtimeMessages,
      { role: 'assistant', content: draftText },
      {
        role: 'system',
        content:
          `${instruction}\n` +
          'Return one final user-facing answer in plain text only. Do not return JSON or tool-call envelopes.',
      },
    ];
    const revisionModelDetails = await resolveModelForRequestDetailed({
      guildId,
      messages: revisionMessages,
      route: agentDecision.kind,
      allowedModels: tenantPolicy.allowedModels,
      featureFlags: toolLoopEnabled ? { tools: true, reasoning: true } : { reasoning: true },
    });
    const revisionModel = revisionModelDetails.model;
    modelResolutionEvents.push({
      phase: 'validator_repair',
      iteration: attempt,
      route: revisionModelDetails.route,
      selected: revisionModelDetails.model,
      candidates: revisionModelDetails.candidates,
      decisions: revisionModelDetails.decisions,
      allowlistApplied: revisionModelDetails.allowlistApplied,
    });
    const repairStartedAt = Date.now();
    const revisedResponse = await client.chat({
      messages: revisionMessages,
      model: revisionModel,
      apiKey,
      temperature: Math.max(0.1, (agentDecision.temperature ?? 0.7) - 0.1),
      timeout: appConfig.TIMEOUT_CHAT_MS,
      maxTokens: routeOutputMaxTokens,
    });
    recordModelOutcome({
      model: revisionModel,
      success: true,
      latencyMs: Date.now() - repairStartedAt,
    });
    return cleanDraftText(stripToolEnvelopeDraft(revisedResponse.content) ?? revisedResponse.content);
  };

  if (
    routeValidationEnabled &&
    appConfig.AGENTIC_VALIDATION_AUTO_REPAIR_ENABLED &&
    validatorRepairMaxAttempts > 0 &&
    validationResult.blockingIssues.length > 0
  ) {
    for (let attempt = 1; attempt <= validatorRepairMaxAttempts; attempt += 1) {
      const issueCodes = validationResult.blockingIssues.map((issue) => issue.code);
      const repairInstruction = buildValidationRepairInstruction({
        routeKind: agentDecision.kind,
        userText,
        issueCodes,
        currentDateIso: new Date().toISOString().slice(0, 10),
      });
      validationRepairAttempts += 1;
      try {
        if (agentDecision.kind === 'search' && toolLoopEnabled && scopedToolRegistry) {
          const priorDraftForComparison = draftText;
          draftText = await runSearchPassWithFallback({
            phase: 'validator_repair_search',
            iteration: attempt,
            revisionInstruction: repairInstruction,
            priorDraft: draftText,
          });
          if (searchExecutionMode === 'complex') {
            try {
              draftText = await runSearchSummaryPass({
                phase: 'validator_repair_search_summary',
                iteration: attempt,
                searchDraft: draftText,
                summaryReason: repairInstruction,
                priorDraft: priorDraftForComparison,
              });
            } catch (summaryError) {
              logger.warn(
                { error: summaryError, traceId, attempt },
                'Validator repair summary pass failed; keeping repaired search draft',
              );
            }
          }
        } else {
          const revised = await runDirectValidationRepair(repairInstruction, attempt);
          if (revised) {
            draftText = revised;
          }
        }
      } catch (error) {
        logger.warn({ error, traceId, attempt }, 'Validation repair attempt failed');
      }

      validationResult = validateResponseForRoute({
        routeKind: agentDecision.kind,
        userText,
        replyText: draftText,
        policy: routeValidationPolicy,
      });
      if (validationResult.blockingIssues.length === 0) {
        validationRepaired = true;
        break;
      }
    }
  }

  if (routeValidationEnabled && validationResult.blockingIssues.length > 0) {
    validationBlocked = true;
    draftText =
      "I couldn't safely validate this response against runtime checks, so I won't provide a potentially incorrect answer right now. Please try again.";
  }

  if (routeValidationEnabled && Array.isArray(agentEventsJson)) {
    agentEventsJson.push({
      type: 'response_validation',
      timestamp: new Date().toISOString(),
      details: {
        strictness: routeValidationPolicy.strictness,
        initialIssueCodes: initialValidationIssueCodes,
        finalIssueCodes: validationResult.issues.map((issue) => issue.code),
        blockingIssueCodes: validationResult.blockingIssues.map((issue) => issue.code),
        warningIssueCodes: validationResult.warningIssues.map((issue) => issue.code),
        repairAttempts: validationRepairAttempts,
        repaired: validationRepaired,
        blocked: validationBlocked,
      },
    });
  }

  let safeFinalText = draftText;
  const allowIntentionalToolEnvelopeExample = isIntentionalToolEnvelopeExampleRequest(userText);
  if (containsLikelyToolEnvelopeFragment(safeFinalText) && !allowIntentionalToolEnvelopeExample) {
    const redactedText = removeLikelyToolEnvelopeFragments(safeFinalText);
    if (redactedText && !containsLikelyToolEnvelopeFragment(redactedText)) {
      logger.warn(
        { traceId, routeKind: agentDecision.kind },
        'Removed leaked tool-call payload from final draft',
      );
      safeFinalText = redactedText;
    } else {
      logger.warn(
        { traceId, routeKind: agentDecision.kind },
        'Final draft contained leaked tool-call payload; replacing with safe fallback text',
      );
      safeFinalText =
        'I completed part of the request but could not format a final response. Please ask me to try once more.';
    }
  }
  const hardGateRequiredFromBudget = toolLoopBudgetJson?.hardGateRequired === true;
  const hardGateSatisfiedFromBudget = toolLoopBudgetJson?.hardGateSatisfied === true;
  if (hardGateRequiredFromBudget && !hardGateSatisfiedFromBudget) {
    canaryHardGateUnmet = true;
  }
  if (toolLoopBudgetJson?.failed === true) {
    canaryToolLoopFailed = true;
  }

  const canaryReasonCodes = new Set<AgenticCanaryOutcomeReason>();
  if (graphExecutionFailed || graphFailedTasks > 0) {
    canaryReasonCodes.add('graph_failed_tasks');
  }
  if (canaryHardGateUnmet) {
    canaryReasonCodes.add('hard_gate_unmet');
  }
  if (canaryToolLoopFailed) {
    canaryReasonCodes.add('tool_loop_failed');
  }

  let canaryOutcome: {
    recorded: boolean;
    success: boolean | null;
    reasonCodes: AgenticCanaryOutcomeReason[];
  } = {
    recorded: false,
    success: null,
    reasonCodes: [],
  };
  if (canaryDecision.allowAgentic) {
    const outcomeReasons = [...canaryReasonCodes];
    const canarySuccess = outcomeReasons.length === 0;
    await recordAgenticOutcome({
      success: canarySuccess,
      reasonCodes: outcomeReasons,
      config: canaryConfig,
    });
    canaryOutcome = {
      recorded: true,
      success: canarySuccess,
      reasonCodes: outcomeReasons,
    };
    if (Array.isArray(agentEventsJson)) {
      agentEventsJson.push({
        type: 'canary_outcome',
        success: canarySuccess,
        reasonCodes: outcomeReasons,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const qualityJsonPayload: Record<string, unknown> = {};
  if (criticAssessments.length > 0) {
    qualityJsonPayload.critic = criticAssessments;
    qualityJsonPayload.revised = revisionApplied > 0;
    qualityJsonPayload.revisionAttempts = revisionAttempts;
    qualityJsonPayload.revisionApplied = revisionApplied;
    if (criticRedispatches.length > 0) {
      qualityJsonPayload.criticRedispatches = criticRedispatches;
    }
    if (criticToolLoopBudgets.length > 0) {
      qualityJsonPayload.criticToolLoops = criticToolLoopBudgets;
    }
  }
  if (routeValidationEnabled) {
    qualityJsonPayload.validation = {
      strictness: routeValidationPolicy.strictness,
      initialIssueCodes: initialValidationIssueCodes,
      finalIssueCodes: validationResult.issues.map((issue) => issue.code),
      blockingIssueCodes: validationResult.blockingIssues.map((issue) => issue.code),
      warningIssueCodes: validationResult.warningIssues.map((issue) => issue.code),
      repairAttempts: validationRepairAttempts,
      repaired: validationRepaired,
      blocked: validationBlocked,
      passed: validationResult.passed,
    };
  }
  const qualityJson = Object.keys(qualityJsonPayload).length > 0 ? qualityJsonPayload : undefined;
  const canarySnapshot = await getAgenticCanarySnapshot({ config: canaryConfig });
  const modelHealthRuntime = getModelHealthRuntimeStatus();
  if (canarySnapshot.degradedMode && Array.isArray(agentEventsJson)) {
    agentEventsJson.push({
      type: 'degraded_mode',
      subsystem: 'canary',
      mode: canarySnapshot.persistenceMode,
      error: canarySnapshot.lastPersistenceError,
      timestamp: new Date().toISOString(),
    });
  }
  if (modelHealthRuntime.degradedMode && Array.isArray(agentEventsJson)) {
    agentEventsJson.push({
      type: 'degraded_mode',
      subsystem: 'model_health',
      mode: modelHealthRuntime.persistenceMode,
      error: modelHealthRuntime.lastPersistenceError,
      timestamp: new Date().toISOString(),
    });
  }
  const promptUserText =
    userText.length <= 6_000
      ? userText
      : `${userText.slice(0, 6_000)}...`;
  const finalBudgetJson: Record<string, unknown> = {
    ...budgetJson,
    promptUserText,
    promptUserTextTruncated: userText.length > 6_000,
    ...(searchExecutionMode ? { searchExecutionMode } : {}),
    routeOutputMaxTokens,
    criticOutputMaxTokens,
    criticIterations: criticAssessments.length,
    criticRedispatches: criticRedispatches.length,
    criticToolLoops: criticToolLoopBudgets.length,
    modelResolution: modelResolutionEvents,
    toolLoop: toolLoopBudgetJson,
    policy: {
      tenantPolicyApplied:
        tenantPolicy.allowedModels !== undefined ||
        tenantPolicy.maxParallel !== undefined ||
        tenantPolicy.criticEnabled !== undefined ||
        tenantPolicy.criticMaxLoops !== undefined ||
        tenantPolicy.criticMinScore !== undefined ||
        tenantPolicy.toolAllowNetworkRead !== undefined ||
        tenantPolicy.toolAllowDataExfiltrationRisk !== undefined ||
        tenantPolicy.toolAllowExternalWrite !== undefined ||
        tenantPolicy.toolAllowHighRisk !== undefined ||
        tenantPolicy.toolBlockedTools !== undefined ||
        tenantPolicy.toolRiskOverrides !== undefined,
      allowedModels: tenantPolicy.allowedModels,
      graph: {
        parallelEnabled: effectiveGraphParallelEnabled,
        maxParallel: effectiveGraphMaxParallel,
      },
      toolPolicy: {
        allowNetworkRead: effectiveToolPolicy.allowNetworkRead ?? true,
        allowDataExfiltrationRisk: effectiveToolPolicy.allowDataExfiltrationRisk ?? true,
        allowExternalWrite: effectiveToolPolicy.allowExternalWrite ?? false,
        allowHighRisk: effectiveToolPolicy.allowHighRisk ?? false,
        blockedTools: effectiveToolPolicy.blockedTools ?? [],
        riskOverrides: effectiveToolPolicy.riskOverrides ?? {},
      },
      toolHardGate: {
        enabled: toolHardGateEnabled,
        minSuccessfulCalls: toolHardGateMinSuccessfulCalls,
        requiredThisTurn: requiresToolEvidenceThisTurn,
      },
      validation: {
        enabled: routeValidationEnabled,
        strictness: routeValidationPolicy.strictness,
        autoRepairEnabled: appConfig.AGENTIC_VALIDATION_AUTO_REPAIR_ENABLED,
        autoRepairMaxAttempts: validatorRepairMaxAttempts,
      },
      managerWorker: {
        enabled: managerWorkerConfig.enabled,
        allowAgentic: managerWorkerCanaryAllowed,
        maxWorkers: managerWorkerConfig.maxWorkers,
        maxPlannerLoops: managerWorkerConfig.maxPlannerLoops,
        maxWorkerTokens: managerWorkerConfig.maxWorkerTokens,
        maxWorkerInputChars: managerWorkerConfig.maxWorkerInputChars,
        timeoutMs: managerWorkerConfig.timeoutMs,
        minComplexityScore: managerWorkerConfig.minComplexityScore,
      },
      critic: criticConfig,
      canary: {
        ...canaryConfig,
        decision: canaryDecision,
        outcome: canaryOutcome,
        graphFailedTasks,
        snapshot: canarySnapshot,
      },
      modelHealth: modelHealthRuntime,
    },
  };

  if (appConfig.TRACE_ENABLED) {
    try {
      const toolJsonPayload: Record<string, unknown> = {
        enabled: toolLoopEnabled,
        routeTools: activeToolNames,
        policy: {
          allowNetworkRead: effectiveToolPolicy.allowNetworkRead ?? true,
          allowDataExfiltrationRisk: effectiveToolPolicy.allowDataExfiltrationRisk ?? true,
          allowExternalWrite: effectiveToolPolicy.allowExternalWrite ?? false,
          allowHighRisk: effectiveToolPolicy.allowHighRisk ?? false,
          blockedTools: effectiveToolPolicy.blockedTools ?? [],
          riskOverrides: effectiveToolPolicy.riskOverrides ?? {},
        },
      };
      if (toolLoopBudgetJson) {
        toolJsonPayload.main = toolLoopBudgetJson;
      }
      if (criticToolLoopBudgets.length > 0) {
        toolJsonPayload.critic = criticToolLoopBudgets;
      }
      await updateTraceEnd({
        id: traceId,
        toolJson: toolJsonPayload,
        qualityJson,
        budgetJson: finalBudgetJson,
        agentEventsJson,
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

  return {
    replyText: cleanedText,
    styleHint: styleMimicry,
    voice,
    debug: { messages: runtimeMessages },
    files,
  };
}

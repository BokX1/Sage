import { config as newConfig } from '../../config';

// Backwards compatibility layer
export const config = {
  discordToken: newConfig.DISCORD_TOKEN,
  discordAppId: newConfig.DISCORD_APP_ID,
  devGuildId: newConfig.DEV_GUILD_ID,
  logLevel: newConfig.LOG_LEVEL,
  rateLimitMax: newConfig.RATE_LIMIT_MAX.toString(), // casting to string to match old type if needed, or number
  rateLimitWindowSec: newConfig.RATE_LIMIT_WINDOW_SEC.toString(),
  autopilotMode: newConfig.AUTOPILOT_MODE,
  wakeWords: newConfig.WAKE_WORDS,
  wakeWordPrefixes: newConfig.WAKE_WORD_PREFIXES,
  wakeWordCooldownSec: newConfig.WAKEWORD_COOLDOWN_SEC.toString(),
  wakeWordMaxResponsesPerMinPerChannel:
    newConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL.toString(),

  // LLM
  llmProvider: newConfig.LLM_PROVIDER,
  pollinationsBaseUrl: newConfig.POLLINATIONS_BASE_URL,
  pollinationsApiKey: newConfig.POLLINATIONS_API_KEY,
  pollinationsModel: newConfig.POLLINATIONS_MODEL,
  llmModelLimitsJson: newConfig.LLM_MODEL_LIMITS_JSON,

  // Context Budgeting (D5)
  contextMaxInputTokens: newConfig.CONTEXT_MAX_INPUT_TOKENS,
  contextReservedOutputTokens: newConfig.CONTEXT_RESERVED_OUTPUT_TOKENS,
  systemPromptMaxTokens: newConfig.SYSTEM_PROMPT_MAX_TOKENS,
  tokenEstimator: newConfig.TOKEN_ESTIMATOR,
  tokenHeuristicCharsPerToken: newConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN,
  contextBlockMaxTokensTranscript: newConfig.CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT,
  contextBlockMaxTokensRollingSummary: newConfig.CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY,
  contextBlockMaxTokensProfileSummary: newConfig.CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY,
  contextBlockMaxTokensMemory: newConfig.CONTEXT_BLOCK_MAX_TOKENS_MEMORY,
  contextBlockMaxTokensReplyContext: newConfig.CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT,
  contextUserMaxTokens: newConfig.CONTEXT_USER_MAX_TOKENS,
  contextTruncationNotice: newConfig.CONTEXT_TRUNCATION_NOTICE,

  // Relationship Hints (D7)
  contextBlockMaxTokensRelationshipHints: newConfig.CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS,
  relationshipHintsMaxEdges: newConfig.RELATIONSHIP_HINTS_MAX_EDGES,
  relationshipDecayLambda: newConfig.RELATIONSHIP_DECAY_LAMBDA,
  relationshipWeightK: newConfig.RELATIONSHIP_WEIGHT_K,
  relationshipConfidenceC: newConfig.RELATIONSHIP_CONFIDENCE_C,

  // Admin Access Control (D7)
  adminRoleIds: newConfig.ADMIN_ROLE_IDS,
  adminUserIds: newConfig.ADMIN_USER_IDS,

  // MoE Orchestration (D9)
  contextBlockMaxTokensExperts: newConfig.CONTEXT_BLOCK_MAX_TOKENS_EXPERTS,
  traceEnabled: newConfig.TRACE_ENABLED,

  // Profile Memory LLM Override
  profileProvider: newConfig.PROFILE_PROVIDER,
  profilePollinationsModel: newConfig.PROFILE_POLLINATIONS_MODEL,

  // Formatter Model (for JSON formatting)
  formatterModel: newConfig.FORMATTER_MODEL,
};

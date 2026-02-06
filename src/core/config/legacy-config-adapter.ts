import { config as newConfig } from '../../config';

/**
 * Expose configuration values using the legacy shape expected by older modules.
 *
 * @returns A configuration object with string-coerced and renamed fields.
 *
 * Side effects:
 * - None.
 *
 * Error behavior:
 * - Does not throw; relies on base configuration defaults.
 *
 * Invariants:
 * - Values mirror the current config; only names and select types differ.
 */
export const config = {
  discordToken: newConfig.DISCORD_TOKEN,
  discordAppId: newConfig.DISCORD_APP_ID,
  devGuildId: newConfig.DEV_GUILD_ID,
  logLevel: newConfig.LOG_LEVEL,
  rateLimitMax: newConfig.RATE_LIMIT_MAX.toString(),
  rateLimitWindowSec: newConfig.RATE_LIMIT_WINDOW_SEC.toString(),
  autopilotMode: newConfig.AUTOPILOT_MODE,
  wakeWords: newConfig.WAKE_WORDS_CSV,
  wakeWordPrefixes: newConfig.WAKE_WORD_PREFIXES_CSV,
  wakeWordCooldownSec: newConfig.WAKEWORD_COOLDOWN_SEC.toString(),
  wakeWordMaxResponsesPerMinPerChannel:
    newConfig.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL.toString(),
  llmProvider: newConfig.LLM_PROVIDER,
  llmBaseUrl: newConfig.LLM_BASE_URL,
  llmImageBaseUrl: newConfig.LLM_IMAGE_BASE_URL,
  llmApiKey: newConfig.LLM_API_KEY,
  chatModel: newConfig.CHAT_MODEL,
  llmModelLimitsJson: newConfig.LLM_MODEL_LIMITS_JSON,
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
  contextBlockMaxTokensRelationshipHints: newConfig.CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS,
  relationshipHintsMaxEdges: newConfig.RELATIONSHIP_HINTS_MAX_EDGES,
  relationshipDecayLambda: newConfig.RELATIONSHIP_DECAY_LAMBDA,
  relationshipWeightK: newConfig.RELATIONSHIP_WEIGHT_K,
  relationshipConfidenceC: newConfig.RELATIONSHIP_CONFIDENCE_C,
  adminRoleIds: newConfig.ADMIN_ROLE_IDS_CSV,
  adminUserIds: newConfig.ADMIN_USER_IDS_CSV,
  contextBlockMaxTokensExperts: newConfig.CONTEXT_BLOCK_MAX_TOKENS_EXPERTS,
  traceEnabled: newConfig.TRACE_ENABLED,
  profileProvider: newConfig.PROFILE_PROVIDER,
  profileChatModel: newConfig.PROFILE_CHAT_MODEL,
  formatterModel: newConfig.FORMATTER_MODEL,
};

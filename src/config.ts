import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

if (process.env.NODE_ENV === 'test') {
  process.env.DISCORD_TOKEN ??= 'test-discord-token';
  process.env.DISCORD_APP_ID ??= 'test-discord-app-id';
  process.env.DATABASE_URL ??= 'test-database-url';

  // Bot Behavior
  process.env.LOG_LEVEL ??= 'info';
  process.env.RATE_LIMIT_MAX ??= '100';
  process.env.RATE_LIMIT_WINDOW_SEC ??= '60';
  process.env.AUTOPILOT_MODE ??= 'manual';
  process.env.WAKE_WORDS_CSV ??= 'sage,bot';
  process.env.WAKE_WORD_PREFIXES_CSV ??= '!';
  process.env.WAKEWORD_COOLDOWN_SEC ??= '10';
  process.env.WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL ??= '5';

  // Ingestion & Behavior
  process.env.INGESTION_ENABLED ??= 'true';
  process.env.INGESTION_MODE ??= 'all';
  process.env.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV ??= '';
  process.env.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV ??= '';
  process.env.RAW_MESSAGE_TTL_DAYS ??= '7';
  process.env.RING_BUFFER_MAX_MESSAGES_PER_CHANNEL ??= '50';
  process.env.CONTEXT_TRANSCRIPT_MAX_MESSAGES ??= '10';
  process.env.CONTEXT_TRANSCRIPT_MAX_CHARS ??= '1000';
  process.env.MESSAGE_DB_STORAGE_ENABLED ??= 'false';
  process.env.PROACTIVE_POSTING_ENABLED ??= 'false';
  process.env.SUMMARY_ROLLING_WINDOW_MIN ??= '15';
  process.env.SUMMARY_ROLLING_MIN_MESSAGES ??= '5';
  process.env.SUMMARY_ROLLING_MIN_INTERVAL_SEC ??= '60';
  process.env.SUMMARY_PROFILE_MIN_INTERVAL_SEC ??= '600';
  process.env.SUMMARY_MAX_CHARS ??= '500';
  process.env.SUMMARY_SCHED_TICK_SEC ??= '60';
  process.env.SUMMARY_MODEL ??= 'gpt-3.5-turbo';

  // Context & Tokens
  process.env.CONTEXT_MAX_INPUT_TOKENS ??= '4000';
  process.env.CONTEXT_RESERVED_OUTPUT_TOKENS ??= '1000';
  process.env.SYSTEM_PROMPT_MAX_TOKENS ??= '1000';
  process.env.TOKEN_ESTIMATOR ??= 'heuristic';
  process.env.TOKEN_HEURISTIC_CHARS_PER_TOKEN ??= '4';
  process.env.CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT ??= '1000';
  process.env.CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY ??= '500';
  process.env.CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY ??= '500';
  process.env.CONTEXT_BLOCK_MAX_TOKENS_MEMORY ??= '500';
  process.env.CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT ??= '500';
  process.env.CONTEXT_USER_MAX_TOKENS ??= '2000';
  process.env.CONTEXT_TRUNCATION_NOTICE ??= 'true';
  process.env.CONTEXT_BLOCK_MAX_TOKENS_EXPERTS ??= '500';
  process.env.TRACE_ENABLED ??= 'false';

  // Relationships
  process.env.CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS ??= '200';
  process.env.RELATIONSHIP_HINTS_MAX_EDGES ??= '5';
  process.env.RELATIONSHIP_DECAY_LAMBDA ??= '0.01';
  process.env.RELATIONSHIP_WEIGHT_K ??= '1.0';
  process.env.RELATIONSHIP_CONFIDENCE_C ??= '0.5';

  // Admin
  process.env.ADMIN_ROLE_IDS_CSV ??= '';
  process.env.ADMIN_USER_IDS_CSV ??= '';

  // LLM
  process.env.LLM_PROVIDER ??= 'pollinations';
  process.env.LLM_BASE_URL ??= 'https://text.pollinations.ai/';
  process.env.LLM_IMAGE_BASE_URL ??= 'https://image.pollinations.ai/';
  process.env.CHAT_MODEL ??= 'openai';
  process.env.LLM_MODEL_LIMITS_JSON ??= '{}';
  process.env.PROFILE_PROVIDER ??= 'pollinations';
  process.env.PROFILE_CHAT_MODEL ??= 'openai';
  process.env.PROFILE_UPDATE_INTERVAL ??= '600000';
  process.env.FORMATTER_MODEL ??= 'openai';

  // Timeouts
  process.env.TIMEOUT_CHAT_MS ??= '300000';
  process.env.TIMEOUT_MEMORY_MS ??= '600000';
}

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_APP_ID: z.string().min(1, 'DISCORD_APP_ID is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DEV_GUILD_ID: z.string().optional(),

  // Bot Behavior
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  RATE_LIMIT_MAX: z.coerce.number().int().positive(),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive(),
  AUTOPILOT_MODE: z.enum(['manual', 'reserved', 'talkative']),
  WAKE_WORDS_CSV: z.string(),
  WAKE_WORD_PREFIXES_CSV: z.string(),
  WAKEWORD_COOLDOWN_SEC: z.coerce.number().int().min(0),
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: z.coerce.number().int().min(0),

  // Event Ingestion & Proactive Behavior (D1)
  INGESTION_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true'),
  INGESTION_MODE: z.enum(['all', 'allowlist']),
  INGESTION_ALLOWLIST_CHANNEL_IDS_CSV: z.string(),
  INGESTION_BLOCKLIST_CHANNEL_IDS_CSV: z.string(),
  RAW_MESSAGE_TTL_DAYS: z.coerce.number().int().positive(),
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: z.coerce.number().int().positive(),
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: z.coerce.number().int().positive(),
  CONTEXT_TRANSCRIPT_MAX_CHARS: z.coerce.number().int().positive(),
  MESSAGE_DB_STORAGE_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true'),
  PROACTIVE_POSTING_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true'),
  SUMMARY_ROLLING_WINDOW_MIN: z.coerce.number().int().positive(),
  SUMMARY_ROLLING_MIN_MESSAGES: z.coerce.number().int().positive(),
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: z.coerce.number().int().positive(),
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: z.coerce.number().int().positive(),
  SUMMARY_MAX_CHARS: z.coerce.number().int().positive(),
  SUMMARY_SCHED_TICK_SEC: z.coerce.number().int().positive(),
  SUMMARY_MODEL: z.string(),

  // Context Budgeting (D5)
  CONTEXT_MAX_INPUT_TOKENS: z.coerce.number().int().positive(),
  CONTEXT_RESERVED_OUTPUT_TOKENS: z.coerce.number().int().positive(),
  SYSTEM_PROMPT_MAX_TOKENS: z.coerce.number().int().positive(),
  TOKEN_ESTIMATOR: z.enum(['heuristic']),
  TOKEN_HEURISTIC_CHARS_PER_TOKEN: z.coerce.number().int().positive(),
  CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT: z.coerce.number().int().positive(),
  CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY: z.coerce.number().int().positive(),
  CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY: z.coerce.number().int().positive(),
  CONTEXT_BLOCK_MAX_TOKENS_MEMORY: z.coerce.number().int().positive(),
  CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT: z.coerce.number().int().positive(),
  CONTEXT_USER_MAX_TOKENS: z.coerce.number().int().positive(),
  CONTEXT_TRUNCATION_NOTICE: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true'),

  // D9: MoE Orchestration
  CONTEXT_BLOCK_MAX_TOKENS_EXPERTS: z.coerce.number().int().positive(),
  TRACE_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true'),

  // Relationship Hints (D7)
  CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS: z.coerce.number().int().positive(),
  RELATIONSHIP_HINTS_MAX_EDGES: z.coerce.number().int().positive(),
  RELATIONSHIP_DECAY_LAMBDA: z.coerce.number().positive(),
  RELATIONSHIP_WEIGHT_K: z.coerce.number().positive(),
  RELATIONSHIP_CONFIDENCE_C: z.coerce.number().positive(),

  // Admin Access Control (D7)
  ADMIN_ROLE_IDS_CSV: z.string(),
  ADMIN_USER_IDS_CSV: z.string(),

  // LLM Configuration
  LLM_PROVIDER: z.enum(['pollinations']),
  LLM_BASE_URL: z.string(),
  LLM_IMAGE_BASE_URL: z.string(),
  CHAT_MODEL: z.string(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL_LIMITS_JSON: z.string(),

  // Profile Memory LLM Override
  PROFILE_PROVIDER: z.string(),
  PROFILE_CHAT_MODEL: z.string(),
  PROFILE_UPDATE_INTERVAL: z.coerce.number().int().positive(),

  // Formatter Model (for JSON formatting in profile updates)
  FORMATTER_MODEL: z.string(),

  // Timeouts (Phase 7)
  TIMEOUT_CHAT_MS: z.coerce.number().int().positive(),
  TIMEOUT_MEMORY_MS: z.coerce.number().int().positive(),
});

// Parse and validate or crash
const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment configuration:', _env.error.format());
  process.exit(1);
}

export const config = {
  ..._env.data,
  // Derived/Convenience accessors
  isDev: _env.data.NODE_ENV === 'development',
  isProd: _env.data.NODE_ENV === 'production',
};

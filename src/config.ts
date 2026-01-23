import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

if (process.env.NODE_ENV === 'test') {
  process.env.DISCORD_TOKEN ??= 'test-discord-token';
  process.env.DISCORD_APP_ID ??= 'test-discord-app-id';
  process.env.DATABASE_URL ??= 'test-database-url';
}

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_APP_ID: z.string().min(1, 'DISCORD_APP_ID is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DEV_GUILD_ID: z.string().optional(),

  // Bot Behavior
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(10),
  AUTOPILOT_MODE: z.enum(['manual', 'reserved', 'talkative']).default('manual'),
  WAKE_WORDS: z.string().default('sage'),
  WAKE_WORD_PREFIXES: z.string().default(''),
  WAKEWORD_COOLDOWN_SEC: z.coerce.number().int().min(0).default(20),
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: z.coerce.number().int().min(0).default(6),

  // Event Ingestion & Proactive Behavior (D1)
  LOGGING_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
  LOGGING_MODE: z.enum(['all', 'allowlist']).default('all'),
  LOGGING_ALLOWLIST_CHANNEL_IDS: z.string().default(''),
  LOGGING_BLOCKLIST_CHANNEL_IDS: z.string().default(''),
  RAW_MESSAGE_TTL_DAYS: z.coerce.number().int().positive().default(3),
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: z.coerce.number().int().positive().default(200),
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: z.coerce.number().int().positive().default(15),
  CONTEXT_TRANSCRIPT_MAX_CHARS: z.coerce.number().int().positive().default(12_000),
  MESSAGE_DB_STORAGE_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
  PROACTIVE_POSTING_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
  SUMMARY_ROLLING_WINDOW_MIN: z.coerce.number().int().positive().default(60),
  SUMMARY_ROLLING_MIN_MESSAGES: z.coerce.number().int().positive().default(20),
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: z.coerce.number().int().positive().default(300),
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: z.coerce.number().int().positive().default(21600),
  SUMMARY_MAX_CHARS: z.coerce.number().int().positive().default(1800),
  SUMMARY_SCHED_TICK_SEC: z.coerce.number().int().positive().default(60),
  SUMMARY_PROVIDER: z.string().optional().default(''),
  SUMMARY_MODEL: z.string().default('openai-large'), // Changed from 'gemini' to 'openai-large'

  // Context Budgeting (D5)
  CONTEXT_MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(65536),
  CONTEXT_RESERVED_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
  SYSTEM_PROMPT_MAX_TOKENS: z.coerce.number().int().positive().default(6000),
  TOKEN_ESTIMATOR: z.enum(['heuristic']).default('heuristic'),
  TOKEN_HEURISTIC_CHARS_PER_TOKEN: z.coerce.number().int().positive().default(4),
  CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT: z.coerce.number().int().positive().default(8000),
  CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY: z.coerce.number().int().positive().default(4800),
  CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY: z.coerce.number().int().positive().default(4800),
  CONTEXT_BLOCK_MAX_TOKENS_MEMORY: z.coerce.number().int().positive().default(6000),
  CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT: z.coerce.number().int().positive().default(3200),
  CONTEXT_USER_MAX_TOKENS: z.coerce.number().int().positive().default(24000),
  CONTEXT_TRUNCATION_NOTICE: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),

  // D9: MoE Orchestration
  CONTEXT_BLOCK_MAX_TOKENS_EXPERTS: z.coerce.number().int().positive().default(4800),
  TRACE_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),

  // Relationship Hints (D7)
  CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS: z.coerce.number().int().positive().default(2400),
  RELATIONSHIP_HINTS_MAX_EDGES: z.coerce.number().int().positive().default(10),
  RELATIONSHIP_DECAY_LAMBDA: z.coerce.number().positive().default(0.06),
  RELATIONSHIP_WEIGHT_K: z.coerce.number().positive().default(0.2),
  RELATIONSHIP_CONFIDENCE_C: z.coerce.number().positive().default(0.25),

  // Admin Access Control (D7)
  ADMIN_ROLE_IDS: z.string().default(''), // Comma-separated Discord role IDs
  ADMIN_USER_IDS: z.string().default(''), // Comma-separated Discord user IDs

  // LLM - Pollinations (Default)
  LLM_PROVIDER: z.enum(['pollinations']).default('pollinations'),
  POLLINATIONS_BASE_URL: z.string().default('https://gen.pollinations.ai/v1'),
  POLLINATIONS_MODEL: z.string().default('gemini'),
  POLLINATIONS_API_KEY: z.string().optional(),
  LLM_MODEL_LIMITS_JSON: z.string().default(''),

  // Profile Memory LLM Override
  PROFILE_PROVIDER: z.string().default(''),
  PROFILE_POLLINATIONS_MODEL: z.string().default('deepseek'), // Changed from 'gemini' to 'deepseek'
  PROFILE_UPDATE_INTERVAL: z.coerce.number().int().positive().default(5), // Update every N messages

  // Formatter Model (for JSON formatting in profile updates)
  FORMATTER_MODEL: z.string().default('qwen-coder'),

  // Timeouts (Phase 7)
  TIMEOUT_CHAT_MS: z.coerce.number().int().positive().default(300000), // 5m rigid limit for chat
  TIMEOUT_MEMORY_MS: z.coerce.number().int().positive().default(600000), // 10m relaxed limit for background memory
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

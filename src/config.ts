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

  // Bot Behavior
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_MAX: z.coerce.number().default(5),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().default(10),
  SERIOUS_MODE: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  AUTOPILOT_LEVEL: z.enum(['manual', 'cautious', 'full']).default('cautious'),
  SILENCE_GRACE_SEC: z.coerce.number().default(60),
  WAKE_WORDS: z.string().default('sage'),
  WAKE_WORD_PREFIXES: z.string().default('hey,yo,hi,hello'),
  WAKEWORD_COOLDOWN_SEC: z.coerce.number().default(20),
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: z.coerce.number().default(6),

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
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: z.coerce.number().int().positive().default(40),
  CONTEXT_TRANSCRIPT_MAX_CHARS: z.coerce.number().int().positive().default(12_000),
  MESSAGE_DB_STORAGE_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
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

  // Context Budgeting (D5)
  CONTEXT_MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(8000),
  CONTEXT_RESERVED_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1200),
  SYSTEM_PROMPT_MAX_TOKENS: z.coerce.number().int().positive().default(1500),
  TOKEN_ESTIMATOR: z.enum(['heuristic']).default('heuristic'),
  TOKEN_HEURISTIC_CHARS_PER_TOKEN: z.coerce.number().int().positive().default(4),
  CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT: z.coerce.number().int().positive().default(1800),
  CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY: z.coerce.number().int().positive().default(1200),
  CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY: z.coerce.number().int().positive().default(1200),
  CONTEXT_BLOCK_MAX_TOKENS_MEMORY: z.coerce.number().int().positive().default(1500),
  CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT: z.coerce.number().int().positive().default(800),
  CONTEXT_USER_MAX_TOKENS: z.coerce.number().int().positive().default(2500),
  CONTEXT_TRUNCATION_NOTICE: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),

  // D9: MoE Orchestration
  CONTEXT_BLOCK_MAX_TOKENS_EXPERTS: z.coerce.number().int().positive().default(1200),
  GOVERNOR_REWRITE_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
  TRACE_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),

  // Relationship Hints (D7)
  CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS: z.coerce.number().int().positive().default(600),
  RELATIONSHIP_HINTS_MAX_EDGES: z.coerce.number().int().positive().default(10),
  RELATIONSHIP_DECAY_LAMBDA: z.coerce.number().positive().default(0.06),
  RELATIONSHIP_WEIGHT_K: z.coerce.number().positive().default(0.2),
  RELATIONSHIP_CONFIDENCE_C: z.coerce.number().positive().default(0.25),

  // Admin Access Control (D7)
  ADMIN_ROLE_IDS: z.string().default(''), // Comma-separated Discord role IDs
  ADMIN_USER_IDS: z.string().default(''), // Comma-separated Discord user IDs

  // LLM - Pollinations (Default)
  LLM_PROVIDER: z.enum(['pollinations', 'gemini', 'noop']).default('pollinations'),
  POLLINATIONS_BASE_URL: z.string().default('https://gen.pollinations.ai/v1'),
  POLLINATIONS_MODEL: z.string().default('gemini'),
  POLLINATIONS_API_KEY: z.string().optional(),

  // LLM - Native Gemini
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash-exp'),
  GEMINI_BASE_URL: z.string().optional(),
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

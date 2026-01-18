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

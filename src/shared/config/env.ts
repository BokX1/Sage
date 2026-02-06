import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  );
}

const httpsUrlSchema = z.string().trim().url().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !isPrivateOrLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}, 'Must be a public HTTPS URL.');

const testDefaults: Record<string, string> = {
  DISCORD_TOKEN: 'test-discord-token',
  DISCORD_APP_ID: 'test-discord-app-id',
  DATABASE_URL: 'test-database-url',
  LOG_LEVEL: 'info',
  RATE_LIMIT_MAX: '100',
  RATE_LIMIT_WINDOW_SEC: '60',
  AUTOPILOT_MODE: 'manual',
  WAKE_WORDS_CSV: 'sage,bot',
  WAKE_WORD_PREFIXES_CSV: '!',
  WAKEWORD_COOLDOWN_SEC: '10',
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: '5',
  INGESTION_ENABLED: 'true',
  INGESTION_MODE: 'all',
  INGESTION_ALLOWLIST_CHANNEL_IDS_CSV: '',
  INGESTION_BLOCKLIST_CHANNEL_IDS_CSV: '',
  RAW_MESSAGE_TTL_DAYS: '7',
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: '50',
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: '10',
  CONTEXT_TRANSCRIPT_MAX_CHARS: '1000',
  MESSAGE_DB_STORAGE_ENABLED: 'false',
  PROACTIVE_POSTING_ENABLED: 'false',
  SUMMARY_ROLLING_WINDOW_MIN: '15',
  SUMMARY_ROLLING_MIN_MESSAGES: '5',
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: '60',
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: '600',
  SUMMARY_MAX_CHARS: '500',
  SUMMARY_SCHED_TICK_SEC: '60',
  SUMMARY_MODEL: 'gpt-3.5-turbo',
  CONTEXT_MAX_INPUT_TOKENS: '4000',
  CONTEXT_RESERVED_OUTPUT_TOKENS: '1000',
  SYSTEM_PROMPT_MAX_TOKENS: '1000',
  TOKEN_ESTIMATOR: 'heuristic',
  TOKEN_HEURISTIC_CHARS_PER_TOKEN: '4',
  CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT: '1000',
  CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY: '500',
  CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY: '500',
  CONTEXT_BLOCK_MAX_TOKENS_MEMORY: '500',
  CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT: '500',
  CONTEXT_USER_MAX_TOKENS: '2000',
  CONTEXT_TRUNCATION_NOTICE: 'true',
  CONTEXT_BLOCK_MAX_TOKENS_EXPERTS: '500',
  TRACE_ENABLED: 'false',
  CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS: '200',
  RELATIONSHIP_HINTS_MAX_EDGES: '5',
  RELATIONSHIP_DECAY_LAMBDA: '0.01',
  RELATIONSHIP_WEIGHT_K: '1.0',
  RELATIONSHIP_CONFIDENCE_C: '0.5',
  ADMIN_ROLE_IDS_CSV: '',
  ADMIN_USER_IDS_CSV: '',
  LLM_PROVIDER: 'pollinations',
  LLM_BASE_URL: 'https://text.pollinations.ai/',
  LLM_IMAGE_BASE_URL: 'https://image.pollinations.ai/',
  CHAT_MODEL: 'openai',
  LLM_MODEL_LIMITS_JSON: '{}',
  PROFILE_PROVIDER: 'pollinations',
  PROFILE_CHAT_MODEL: 'openai',
  PROFILE_UPDATE_INTERVAL: '5',
  FORMATTER_MODEL: 'openai',
  TIMEOUT_CHAT_MS: '300000',
  TIMEOUT_MEMORY_MS: '600000',
  LLM_DOCTOR_PING: '0',
  SECRET_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DEV_GUILD_ID: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().max(3600),
  AUTOPILOT_MODE: z.enum(['manual', 'reserved', 'talkative']),
  WAKE_WORDS_CSV: z.string(),
  WAKE_WORD_PREFIXES_CSV: z.string(),
  WAKEWORD_COOLDOWN_SEC: z.coerce.number().int().min(0),
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: z.coerce.number().int().min(0),
  INGESTION_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
  INGESTION_MODE: z.enum(['all', 'allowlist']),
  INGESTION_ALLOWLIST_CHANNEL_IDS_CSV: z.string(),
  INGESTION_BLOCKLIST_CHANNEL_IDS_CSV: z.string(),
  RAW_MESSAGE_TTL_DAYS: z.coerce.number().int().positive().max(365),
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: z.coerce.number().int().positive().max(5000),
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: z.coerce.number().int().positive(),
  CONTEXT_TRANSCRIPT_MAX_CHARS: z.coerce.number().int().positive(),
  MESSAGE_DB_STORAGE_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
  PROACTIVE_POSTING_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
  SUMMARY_ROLLING_WINDOW_MIN: z.coerce.number().int().positive(),
  SUMMARY_ROLLING_MIN_MESSAGES: z.coerce.number().int().positive(),
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: z.coerce.number().int().positive(),
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: z.coerce.number().int().positive(),
  SUMMARY_MAX_CHARS: z.coerce.number().int().positive(),
  SUMMARY_SCHED_TICK_SEC: z.coerce.number().int().positive(),
  SUMMARY_MODEL: z.string(),
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
  CONTEXT_TRUNCATION_NOTICE: z.enum(['true', 'false']).transform((v) => v === 'true'),
  CONTEXT_BLOCK_MAX_TOKENS_EXPERTS: z.coerce.number().int().positive(),
  TRACE_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
  CONTEXT_BLOCK_MAX_TOKENS_RELATIONSHIP_HINTS: z.coerce.number().int().positive(),
  RELATIONSHIP_HINTS_MAX_EDGES: z.coerce.number().int().positive(),
  RELATIONSHIP_DECAY_LAMBDA: z.coerce.number().positive(),
  RELATIONSHIP_WEIGHT_K: z.coerce.number().positive(),
  RELATIONSHIP_CONFIDENCE_C: z.coerce.number().positive(),
  ADMIN_ROLE_IDS_CSV: z.string().regex(/^[0-9,\s]*$/, 'Must contain only Discord snowflake IDs separated by commas.'),
  ADMIN_USER_IDS_CSV: z.string().regex(/^[0-9,\s]*$/, 'Must contain only Discord snowflake IDs separated by commas.'),
  LLM_PROVIDER: z.enum(['pollinations']),
  LLM_BASE_URL: httpsUrlSchema,
  LLM_IMAGE_BASE_URL: httpsUrlSchema,
  CHAT_MODEL: z.string(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL_LIMITS_JSON: z.string(),
  PROFILE_PROVIDER: z.string(),
  PROFILE_CHAT_MODEL: z.string(),
  PROFILE_UPDATE_INTERVAL: z.coerce.number().int().positive(),
  FORMATTER_MODEL: z.string(),
  TIMEOUT_CHAT_MS: z.coerce.number().int().positive().max(300000),
  TIMEOUT_MEMORY_MS: z.coerce.number().int().positive().max(600000),
  LLM_DOCTOR_PING: z.enum(['0', '1']).default('0'),
  SECRET_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

const mergedEnv = {
  ...(process.env.NODE_ENV === 'test' ? testDefaults : {}),
  ...process.env,
};

const parsed = envSchema.safeParse(mergedEnv);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
};

export type AppConfig = typeof config;

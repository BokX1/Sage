import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

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

  // Event Ingestion & Proactive Behavior (D1)
  LOGGING_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
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

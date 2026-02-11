import dotenv from 'dotenv';
import { z } from 'zod';

const isTestRuntime =
  process.env.NODE_ENV === 'test' ||
  process.env.VITEST === 'true' ||
  process.env.VITEST_WORKER_ID !== undefined;

if (!isTestRuntime) {
  dotenv.config();
}

/**
 * Check whether a hostname resolves to localhost or RFC1918 private network ranges.
 *
 * @param hostname Hostname (IPv4/IPv6 or DNS label) to validate.
 * @returns True when the host is local/private and should be rejected for outbound public URLs.
 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const unwrappedIpv6 = normalized.replace(/^\[/, '').replace(/\]$/, '');

  return (
    normalized === 'localhost' ||
    normalized.startsWith('127.') ||
    unwrappedIpv6 === '::1' ||
    unwrappedIpv6.startsWith('::ffff:127.') ||
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

const httpOrHttpsUrlSchema = z.string().trim().url().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Must be an HTTP(S) URL.');

const optionalHttpOrHttpsUrlSchema = z.string().trim().optional().refine((value) => {
  if (value === undefined || value.length === 0) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Must be an HTTP(S) URL.');

const testDefaults: Record<string, string> = {
  NODE_ENV: 'test',
  DISCORD_TOKEN: 'test-discord-token',
  DISCORD_APP_ID: 'test-discord-app-id',
  DATABASE_URL: 'test-database-url',
  DEV_GUILD_ID: '',
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
  FILE_INGEST_TIKA_BASE_URL: 'http://127.0.0.1:9998',
  FILE_INGEST_TIMEOUT_MS: '45000',
  FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE: '4',
  FILE_INGEST_MAX_BYTES_PER_FILE: '10485760',
  FILE_INGEST_MAX_TOTAL_BYTES_PER_MESSAGE: '20971520',
  FILE_INGEST_OCR_ENABLED: 'false',
  RAW_MESSAGE_TTL_DAYS: '7',
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: '50',
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: '10',
  CONTEXT_TRANSCRIPT_MAX_CHARS: '1000',
  MESSAGE_DB_STORAGE_ENABLED: 'false',
  MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL: '200',
  PROACTIVE_POSTING_ENABLED: 'false',
  SUMMARY_ROLLING_WINDOW_MIN: '15',
  SUMMARY_ROLLING_MIN_MESSAGES: '5',
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: '60',
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: '600',
  SUMMARY_MAX_CHARS: '1500',
  SUMMARY_SCHED_TICK_SEC: '60',
  SUMMARY_MODEL: 'gpt-3.5-turbo',
  CONTEXT_MAX_INPUT_TOKENS: '16000',
  CONTEXT_RESERVED_OUTPUT_TOKENS: '4000',
  SYSTEM_PROMPT_MAX_TOKENS: '2000',
  TOKEN_ESTIMATOR: 'heuristic',
  TOKEN_HEURISTIC_CHARS_PER_TOKEN: '4',
  CONTEXT_BLOCK_MAX_TOKENS_TRANSCRIPT: '4000',
  CONTEXT_BLOCK_MAX_TOKENS_ROLLING_SUMMARY: '2000',
  CONTEXT_BLOCK_MAX_TOKENS_PROFILE_SUMMARY: '2000',
  CONTEXT_BLOCK_MAX_TOKENS_MEMORY: '2000',
  CONTEXT_BLOCK_MAX_TOKENS_REPLY_CONTEXT: '1000',
  CONTEXT_USER_MAX_TOKENS: '8000',
  CONTEXT_TRUNCATION_NOTICE: 'true',
  CONTEXT_BLOCK_MAX_TOKENS_PROVIDERS: '2000',
  TRACE_ENABLED: 'false',

  ADMIN_ROLE_IDS_CSV: '',
  ADMIN_USER_IDS_CSV: '',
  LLM_PROVIDER: 'pollinations',
  LLM_BASE_URL: 'https://text.pollinations.ai/',
  LLM_IMAGE_BASE_URL: 'https://image.pollinations.ai/',
  CHAT_MODEL: 'openai-large',
  LLM_API_KEY: '',
  LLM_MODEL_LIMITS_JSON: '{}',
  PROFILE_PROVIDER: 'pollinations',
  PROFILE_CHAT_MODEL: 'openai',
  PROFILE_UPDATE_INTERVAL: '5',
  FORMATTER_MODEL: 'openai',
  TIMEOUT_CHAT_MS: '300000',
  TIMEOUT_SEARCH_MS: '300000',
  TIMEOUT_SEARCH_SCRAPER_MS: '480000',
  TIMEOUT_MEMORY_MS: '600000',
  SEARCH_MAX_ATTEMPTS_SIMPLE: '2',
  SEARCH_MAX_ATTEMPTS_COMPLEX: '4',
  TOOL_WEB_SEARCH_PROVIDER_ORDER: 'tavily,exa,searxng,pollinations',
  TOOL_WEB_SEARCH_TIMEOUT_MS: '45000',
  TOOL_WEB_SEARCH_MAX_RESULTS: '6',
  TOOL_WEB_SCRAPE_PROVIDER_ORDER: 'firecrawl,crawl4ai,jina,raw_fetch',
  TOOL_WEB_SCRAPE_TIMEOUT_MS: '45000',
  TOOL_WEB_SCRAPE_MAX_CHARS: '12000',
  TAVILY_API_KEY: '',
  EXA_API_KEY: '',
  SEARXNG_BASE_URL: '',
  SEARXNG_SEARCH_PATH: '/search',
  SEARXNG_CATEGORIES: 'general',
  SEARXNG_LANGUAGE: 'en-US',
  FIRECRAWL_API_KEY: '',
  FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev/v1',
  CRAWL4AI_BASE_URL: '',
  CRAWL4AI_BEARER_TOKEN: '',
  JINA_READER_BASE_URL: 'https://r.jina.ai/http://',
  GITHUB_TOKEN: '',
  OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  OLLAMA_MODEL: 'llama3.1:8b',
  CHAT_MAX_OUTPUT_TOKENS: '1800',
  CODING_MAX_OUTPUT_TOKENS: '4200',
  SEARCH_MAX_OUTPUT_TOKENS: '2000',
  CRITIC_MAX_OUTPUT_TOKENS: '1800',
  LLM_DOCTOR_PING: '0',
  AGENTIC_GRAPH_PARALLEL_ENABLED: 'true',
  AGENTIC_GRAPH_MAX_PARALLEL: '3',
  AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE: 'false',
  AGENTIC_TOOL_ALLOW_HIGH_RISK: 'false',
  AGENTIC_TOOL_BLOCKLIST_CSV: '',
  AGENTIC_TOOL_POLICY_JSON: '',
  AGENTIC_TOOL_LOOP_ENABLED: 'true',
  AGENTIC_TOOL_HARD_GATE_ENABLED: 'true',
  AGENTIC_TOOL_HARD_GATE_MIN_SUCCESSFUL_CALLS: '1',
  AGENTIC_TOOL_MAX_ROUNDS: '2',
  AGENTIC_TOOL_MAX_CALLS_PER_ROUND: '3',
  AGENTIC_TOOL_TIMEOUT_MS: '45000',
  AGENTIC_TOOL_MAX_OUTPUT_TOKENS: '1200',
  AGENTIC_TOOL_RESULT_MAX_CHARS: '4000',
  AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED: 'true',
  AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY: '3',
  AGENTIC_CANARY_ENABLED: 'true',
  AGENTIC_CANARY_PERCENT: '100',
  AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV: 'chat,coding,search,creative',
  AGENTIC_CANARY_MAX_FAILURE_RATE: '0.30',
  AGENTIC_CANARY_MIN_SAMPLES: '20',
  AGENTIC_CANARY_COOLDOWN_SEC: '300',
  AGENTIC_CANARY_WINDOW_SIZE: '100',
  AGENTIC_PERSIST_STATE_ENABLED: 'false',
  AGENTIC_TENANT_POLICY_JSON: '{}',
  AGENTIC_CRITIC_ENABLED: 'true',
  // Quality-first baseline from latest judge-enabled tuning sweep.
  AGENTIC_CRITIC_MIN_SCORE: '0.82',
  // Default to 2 based on larger-sample live tuning.
  AGENTIC_CRITIC_MAX_LOOPS: '2',
  // Keep validation disabled in test defaults to avoid brittle route/output fixtures.
  AGENTIC_VALIDATORS_ENABLED: 'false',
  AGENTIC_VALIDATION_POLICY_JSON: '',
  AGENTIC_VALIDATION_AUTO_REPAIR_ENABLED: 'true',
  AGENTIC_VALIDATION_AUTO_REPAIR_MAX_ATTEMPTS: '1',
  AGENTIC_MANAGER_WORKER_ENABLED: 'false',
  AGENTIC_MANAGER_WORKER_MAX_WORKERS: '3',
  AGENTIC_MANAGER_WORKER_MAX_PLANNER_LOOPS: '1',
  AGENTIC_MANAGER_WORKER_MAX_TOKENS: '900',
  AGENTIC_MANAGER_WORKER_MAX_INPUT_CHARS: '32000',
  AGENTIC_MANAGER_WORKER_TIMEOUT_MS: '60000',
  AGENTIC_MANAGER_WORKER_MIN_COMPLEXITY_SCORE: '0.55',

  REPLAY_GATE_LIMIT: '200',
  REPLAY_GATE_MIN_AVG_SCORE: '0.65',
  REPLAY_GATE_MIN_SUCCESS_RATE: '0.75',
  REPLAY_GATE_MIN_TOOL_EXECUTION_RATE: '0.00',
  REPLAY_GATE_MAX_HARD_GATE_FAILURE_RATE: '1.00',
  REPLAY_GATE_REQUIRE_DATA: '1',
  REPLAY_GATE_MIN_TOTAL: '10',
  REPLAY_GATE_REQUIRED_ROUTES_CSV: 'chat,coding,search,creative',
  REPLAY_GATE_MIN_ROUTE_SAMPLES: '1',
  REPLAY_GATE_ROUTE_THRESHOLDS_JSON: '',
  REPLAY_GATE_GUILD_ID: '',
  REPLAY_GATE_CHANNEL_ID: '',

  REPLAY_SEED_PER_ROUTE: '3',
  REPLAY_SEED_GUILD_ID: '',
  REPLAY_SEED_CHANNEL_PREFIX: 'seed-replay',
  REPLAY_SEED_USER_ID: 'seed-user',

  EVAL_RUN_LIMIT: '40',
  EVAL_RUN_CONCURRENCY: '2',
  EVAL_RUN_REQUIRE_DATA: '1',
  EVAL_RUN_CLEANUP_EXISTING: '1',
  EVAL_RUN_FAIL_ON_ERROR: '1',
  EVAL_RUN_RUBRIC_VERSION: 'v1',
  EVAL_RUN_TIMEOUT_MS: '120000',
  EVAL_RUN_MAX_TOKENS: '1200',
  EVAL_RUN_GUILD_ID: '',
  EVAL_RUN_CHANNEL_ID: '',
  EVAL_RUN_ROUTES_CSV: '',
  EVAL_RUN_OUTPUT_JSON: '',
  EVAL_RUN_API_KEY: '',
  EVAL_RUN_PRIMARY_MODEL: '',
  EVAL_RUN_SECONDARY_MODEL: '',
  EVAL_RUN_ADJUDICATOR_MODEL: '',

  EVAL_GATE_LIMIT: '60',
  EVAL_GATE_REQUIRE_DATA: '1',
  EVAL_GATE_MIN_TOTAL: '1',
  EVAL_GATE_RUBRIC_VERSION: 'v1',
  EVAL_GATE_MIN_AVG_SCORE: '0.75',
  EVAL_GATE_MIN_PASS_RATE: '0.70',
  EVAL_GATE_MAX_DISAGREEMENT_RATE: '0.40',
  EVAL_GATE_MIN_CONFIDENCE: '0.50',
  EVAL_GATE_GUILD_ID: '',
  EVAL_GATE_CHANNEL_ID: '',
  EVAL_GATE_ROUTE_KIND: '',
  EVAL_GATE_LATEST_PER_TRACE: '1',
  EVAL_GATE_REQUIRED_ROUTES_CSV: '',
  EVAL_GATE_MIN_ROUTE_SAMPLES: '1',
  EVAL_GATE_ROUTE_THRESHOLDS_JSON: '',

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
  FILE_INGEST_TIKA_BASE_URL: httpOrHttpsUrlSchema.default('http://127.0.0.1:9998'),
  FILE_INGEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE: z.coerce.number().int().min(1).max(20).default(4),
  FILE_INGEST_MAX_BYTES_PER_FILE: z.coerce.number().int().min(1024).max(104857600).default(10485760),
  FILE_INGEST_MAX_TOTAL_BYTES_PER_MESSAGE: z.coerce
    .number()
    .int()
    .min(1024)
    .max(209715200)
    .default(20971520),
  FILE_INGEST_OCR_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  RAW_MESSAGE_TTL_DAYS: z.coerce.number().int().positive().max(365),
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: z.coerce.number().int().positive().max(5000),
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: z.coerce.number().int().positive(),
  CONTEXT_TRANSCRIPT_MAX_CHARS: z.coerce.number().int().positive(),
  MESSAGE_DB_STORAGE_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
  MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL: z.coerce.number().int().positive().max(50000).default(500),
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
  CONTEXT_BLOCK_MAX_TOKENS_PROVIDERS: z.coerce.number().int().positive(),
  TRACE_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),

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
  TIMEOUT_SEARCH_MS: z.coerce.number().int().positive().max(900000).default(300000),
  TIMEOUT_SEARCH_SCRAPER_MS: z.coerce.number().int().positive().max(900000).default(480000),
  TIMEOUT_MEMORY_MS: z.coerce.number().int().positive().max(600000),
  SEARCH_MAX_ATTEMPTS_SIMPLE: z.coerce.number().int().min(1).max(8).default(2),
  SEARCH_MAX_ATTEMPTS_COMPLEX: z.coerce.number().int().min(1).max(8).default(4),
  TOOL_WEB_SEARCH_PROVIDER_ORDER: z.string().default('tavily,exa,searxng,pollinations'),
  TOOL_WEB_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  TOOL_WEB_SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(6),
  TOOL_WEB_SCRAPE_PROVIDER_ORDER: z.string().default('firecrawl,crawl4ai,jina,raw_fetch'),
  TOOL_WEB_SCRAPE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  TOOL_WEB_SCRAPE_MAX_CHARS: z.coerce.number().int().min(500).max(50000).default(12000),
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  SEARXNG_BASE_URL: optionalHttpOrHttpsUrlSchema,
  SEARXNG_SEARCH_PATH: z.string().default('/search'),
  SEARXNG_CATEGORIES: z.string().default('general'),
  SEARXNG_LANGUAGE: z.string().default('en-US'),
  FIRECRAWL_API_KEY: z.string().optional(),
  FIRECRAWL_BASE_URL: httpOrHttpsUrlSchema.default('https://api.firecrawl.dev/v1'),
  CRAWL4AI_BASE_URL: optionalHttpOrHttpsUrlSchema,
  CRAWL4AI_BEARER_TOKEN: z.string().optional(),
  JINA_READER_BASE_URL: z.string().default('https://r.jina.ai/http://'),
  GITHUB_TOKEN: z.string().optional(),
  OLLAMA_BASE_URL: httpOrHttpsUrlSchema.default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1:8b'),
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(16000).default(1800),
  CODING_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32000).default(4200),
  SEARCH_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(16000).default(2000),
  CRITIC_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(16000).default(1800),
  LLM_DOCTOR_PING: z.enum(['0', '1']).default('0'),
  AGENTIC_GRAPH_PARALLEL_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  AGENTIC_GRAPH_MAX_PARALLEL: z.coerce.number().int().min(1).max(16).default(3),
  AGENTIC_TOOL_ALLOW_EXTERNAL_WRITE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  AGENTIC_TOOL_ALLOW_HIGH_RISK: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  AGENTIC_TOOL_BLOCKLIST_CSV: z.string().default(''),
  AGENTIC_TOOL_POLICY_JSON: z.string().default(''),
  AGENTIC_TOOL_LOOP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  AGENTIC_TOOL_HARD_GATE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AGENTIC_TOOL_HARD_GATE_MIN_SUCCESSFUL_CALLS: z.coerce.number().int().min(1).max(3).default(1),
  AGENTIC_TOOL_MAX_ROUNDS: z.coerce.number().int().min(1).max(6).default(2),
  AGENTIC_TOOL_MAX_CALLS_PER_ROUND: z.coerce.number().int().min(1).max(10).default(3),
  AGENTIC_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  AGENTIC_TOOL_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(8000).default(1200),
  AGENTIC_TOOL_RESULT_MAX_CHARS: z.coerce.number().int().min(500).max(50000).default(4000),
  AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY: z.coerce.number().int().min(1).max(10).default(3),
  AGENTIC_CANARY_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  AGENTIC_CANARY_PERCENT: z.coerce.number().min(0).max(100).default(100),
  AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV: z.string().default(''),
  AGENTIC_CANARY_MAX_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.30),
  AGENTIC_CANARY_MIN_SAMPLES: z.coerce.number().int().min(1).max(10000).default(20),
  AGENTIC_CANARY_COOLDOWN_SEC: z.coerce.number().int().min(1).max(86400).default(300),
  AGENTIC_CANARY_WINDOW_SIZE: z.coerce.number().int().min(10).max(10000).default(100),
  AGENTIC_PERSIST_STATE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  AGENTIC_TENANT_POLICY_JSON: z.string().default('{}'),
  AGENTIC_CRITIC_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  AGENTIC_CRITIC_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.82),
  AGENTIC_CRITIC_MAX_LOOPS: z.coerce.number().int().min(0).max(2).default(2),
  AGENTIC_VALIDATORS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  AGENTIC_VALIDATION_POLICY_JSON: z.string().default(''),
  AGENTIC_VALIDATION_AUTO_REPAIR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AGENTIC_VALIDATION_AUTO_REPAIR_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(1).default(1),
  AGENTIC_MANAGER_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AGENTIC_MANAGER_WORKER_MAX_WORKERS: z.coerce.number().int().min(1).max(8).default(3),
  AGENTIC_MANAGER_WORKER_MAX_PLANNER_LOOPS: z.coerce.number().int().min(1).max(4).default(1),
  AGENTIC_MANAGER_WORKER_MAX_TOKENS: z.coerce.number().int().min(128).max(4000).default(900),
  AGENTIC_MANAGER_WORKER_MAX_INPUT_CHARS: z
    .coerce
    .number()
    .int()
    .min(4000)
    .max(200000)
    .default(32000),
  AGENTIC_MANAGER_WORKER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(60000),
  AGENTIC_MANAGER_WORKER_MIN_COMPLEXITY_SCORE: z.coerce.number().min(0).max(1).default(0.55),

  REPLAY_GATE_LIMIT: z.string().default('200'),
  REPLAY_GATE_MIN_AVG_SCORE: z.string().default('0.65'),
  REPLAY_GATE_MIN_SUCCESS_RATE: z.string().default('0.75'),
  REPLAY_GATE_MIN_TOOL_EXECUTION_RATE: z.string().default('0.00'),
  REPLAY_GATE_MAX_HARD_GATE_FAILURE_RATE: z.string().default('1.00'),
  REPLAY_GATE_REQUIRE_DATA: z.string().default('1'),
  REPLAY_GATE_MIN_TOTAL: z.string().default('10'),
  REPLAY_GATE_REQUIRED_ROUTES_CSV: z.string().default('chat,coding,search,creative'),
  REPLAY_GATE_MIN_ROUTE_SAMPLES: z.string().default('1'),
  REPLAY_GATE_ROUTE_THRESHOLDS_JSON: z.string().default(''),
  REPLAY_GATE_GUILD_ID: z.string().default(''),
  REPLAY_GATE_CHANNEL_ID: z.string().default(''),

  REPLAY_SEED_PER_ROUTE: z.string().default('3'),
  REPLAY_SEED_GUILD_ID: z.string().default(''),
  REPLAY_SEED_CHANNEL_PREFIX: z.string().default('seed-replay'),
  REPLAY_SEED_USER_ID: z.string().default('seed-user'),

  EVAL_RUN_LIMIT: z.string().default('40'),
  EVAL_RUN_CONCURRENCY: z.string().default('2'),
  EVAL_RUN_REQUIRE_DATA: z.string().default('1'),
  EVAL_RUN_CLEANUP_EXISTING: z.string().default('1'),
  EVAL_RUN_FAIL_ON_ERROR: z.string().default('1'),
  EVAL_RUN_RUBRIC_VERSION: z.string().default('v1'),
  EVAL_RUN_TIMEOUT_MS: z.string().default('120000'),
  EVAL_RUN_MAX_TOKENS: z.string().default('1200'),
  EVAL_RUN_GUILD_ID: z.string().default(''),
  EVAL_RUN_CHANNEL_ID: z.string().default(''),
  EVAL_RUN_ROUTES_CSV: z.string().default(''),
  EVAL_RUN_OUTPUT_JSON: z.string().default(''),
  EVAL_RUN_API_KEY: z.string().default(''),
  EVAL_RUN_PRIMARY_MODEL: z.string().default(''),
  EVAL_RUN_SECONDARY_MODEL: z.string().default(''),
  EVAL_RUN_ADJUDICATOR_MODEL: z.string().default(''),

  EVAL_GATE_LIMIT: z.string().default('60'),
  EVAL_GATE_REQUIRE_DATA: z.string().default('1'),
  EVAL_GATE_MIN_TOTAL: z.string().default('1'),
  EVAL_GATE_RUBRIC_VERSION: z.string().default('v1'),
  EVAL_GATE_MIN_AVG_SCORE: z.string().default('0.75'),
  EVAL_GATE_MIN_PASS_RATE: z.string().default('0.70'),
  EVAL_GATE_MAX_DISAGREEMENT_RATE: z.string().default('0.40'),
  EVAL_GATE_MIN_CONFIDENCE: z.string().default('0.50'),
  EVAL_GATE_GUILD_ID: z.string().default(''),
  EVAL_GATE_CHANNEL_ID: z.string().default(''),
  EVAL_GATE_ROUTE_KIND: z.string().default(''),
  EVAL_GATE_LATEST_PER_TRACE: z.string().default('1'),
  EVAL_GATE_REQUIRED_ROUTES_CSV: z.string().default(''),
  EVAL_GATE_MIN_ROUTE_SAMPLES: z.string().default('1'),
  EVAL_GATE_ROUTE_THRESHOLDS_JSON: z.string().default(''),

  SECRET_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

const mergedEnv = {
  ...(process.env.NODE_ENV === 'test' ? testDefaults : {}),
  ...process.env,
};

const parsed = envSchema.safeParse(mergedEnv);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
};

export type AppConfig = typeof config;


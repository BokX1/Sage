import { z } from 'zod';

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

export const testDefaults: Record<string, string> = {
  NODE_ENV: 'test',
  DISCORD_TOKEN: 'test-discord-token',
  DISCORD_APP_ID: 'test-discord-app-id',
  DATABASE_URL: 'test-database-url',
  MEMGRAPH_HOST: 'localhost',
  MEMGRAPH_PORT: '7687',
  MEMGRAPH_USER: '',
  MEMGRAPH_PASSWORD: '',
  MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS: 'redpanda:9092',
  KAFKA_BROKERS: '',
  KAFKA_INTERACTIONS_TOPIC: 'sage.social.interactions',
  KAFKA_VOICE_TOPIC: 'sage.social.voice-sessions',
  DEV_GUILD_ID: '',
  LOG_LEVEL: 'info',
  RATE_LIMIT_MAX: '100',
  RATE_LIMIT_WINDOW_SEC: '60',
  AUTOPILOT_MODE: 'manual',
  WAKE_WORDS_CSV: 'sage,bot',
  WAKE_WORD_PREFIXES_CSV: '!',
  WAKEWORD_COOLDOWN_SEC: '10',
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: '5',

  VOICE_SERVICE_BASE_URL: 'http://127.0.0.1:11333',
  VOICE_STT_ENABLED: 'false',
  VOICE_STT_MODEL_ID: 'deepdml/faster-whisper-large-v3-turbo-ct2',
  VOICE_STT_COMPUTE_TYPE: 'int8',
  VOICE_STT_END_SILENCE_MS: '900',
  VOICE_STT_MAX_UTTERANCE_MS: '15000',
  VOICE_STT_MIN_UTTERANCE_MS: '400',
  VOICE_LIVE_CONTEXT_LOOKBACK_SEC: '180',
  VOICE_LIVE_CONTEXT_MAX_CHARS: '4000',
  VOICE_LIVE_CONTEXT_MAX_UTTERANCES: '80',
  VOICE_SESSION_SUMMARY_ENABLED: 'true',
  VOICE_MESSAGE_STT_ENABLED: 'false',
  VOICE_MESSAGE_STT_MAX_SECONDS: '120',
  VOICE_MESSAGE_STT_MAX_BYTES: '5000000',
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
  SUMMARY_MODEL: 'deepseek',
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
  EMBEDDING_MODEL: 'nomic-ai/nomic-embed-text-v1.5',
  EMBEDDING_DIMENSIONS: '256',
  LTM_COMPACTION_ENABLED: 'true',
  USER_PROFILE_COMPACTION_INTERVAL_DAYS: '30',
  LLM_PROVIDER: 'pollinations',
  LLM_BASE_URL: 'https://gen.pollinations.ai/v1',
  LLM_IMAGE_BASE_URL: 'https://gen.pollinations.ai',
  CHAT_MODEL: 'kimi',
  LLM_API_KEY: '',
  LLM_MODEL_LIMITS_JSON: '{}',
  PROFILE_PROVIDER: 'pollinations',
  PROFILE_CHAT_MODEL: 'deepseek',
  PROFILE_UPDATE_INTERVAL: '5',
  TIMEOUT_CHAT_MS: '300000',
  TIMEOUT_SEARCH_MS: '300000',
  TIMEOUT_SEARCH_SCRAPER_MS: '480000',
  TIMEOUT_MEMORY_MS: '600000',
  SEARCH_MAX_ATTEMPTS: '4',
  TOOL_WEB_SEARCH_PROVIDER_ORDER: 'tavily,exa,searxng,pollinations',
  TOOL_WEB_SEARCH_TIMEOUT_MS: '45000',
  TOOL_WEB_SEARCH_MAX_RESULTS: '6',
  TOOL_WEB_SCRAPE_PROVIDER_ORDER: 'crawl4ai,firecrawl,jina,nomnom,raw_fetch',
  TOOL_WEB_SCRAPE_TIMEOUT_MS: '45000',
  TOOL_WEB_SCRAPE_MAX_CHARS: '20000',
  TAVILY_API_KEY: '',
  EXA_API_KEY: '',
  SEARXNG_BASE_URL: '',
  SEARXNG_HOST_PORT: '18080',
  SEARXNG_SEARCH_PATH: '/search',
  SEARXNG_CATEGORIES: 'general',
  SEARXNG_LANGUAGE: 'en-US',
  FIRECRAWL_API_KEY: '',
  FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev/v1',
  CRAWL4AI_BASE_URL: '',
  CRAWL4AI_BEARER_TOKEN: '',
  JINA_READER_BASE_URL: 'https://r.jina.ai/http://',
  GITHUB_TOKEN: '',
  GITHUB_CODE_SEARCH_MAX_CANDIDATES: '30',
  GITHUB_REGEX_MAX_FILES: '20',
  GITHUB_REGEX_MAX_MATCHES: '120',
  GITHUB_FILE_LOOKUP_MAX_LINE_SPAN: '800',
  CHAT_MAX_OUTPUT_TOKENS: '1800',
  CODING_MAX_OUTPUT_TOKENS: '4200',
  SEARCH_MAX_OUTPUT_TOKENS: '2000',
  LLM_DOCTOR_PING: '0',
  AGENTIC_TOOL_LOOP_ENABLED: 'true',
  AGENTIC_TOOL_MAX_ROUNDS: '6',
  AGENTIC_TOOL_MAX_CALLS_PER_ROUND: '3',
  AGENTIC_TOOL_TIMEOUT_MS: '45000',
  AGENTIC_TOOL_MAX_OUTPUT_TOKENS: '1200',
  AGENTIC_TOOL_RESULT_MAX_CHARS: '8000',
  AGENTIC_TOOL_GITHUB_GROUNDED_MODE: 'true',
  AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED: 'true',
  AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY: '3',

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
  EVAL_GATE_LATEST_PER_TRACE: '1',

  SIM_RUNS: '80',
  SIM_CONCURRENCY: '6',
  SIM_GUILD_ID: '',
  SIM_CHANNEL_PREFIX: 'sim-agentic',
  SIM_USER_PREFIX: 'sim-user',
  SIM_TRACE_PREFIX: 'sim-agentic',
  SIM_OUTPUT_JSON: '',
  SIM_MIN_AVG_SCORE: '0',
  SIM_MIN_SUCCESS_RATE: '0',
  SIM_MIN_TOOL_EXECUTION_RATE: '0',
  SIM_MAX_ERROR_RATE: '1',
  SIM_JUDGE_ENABLED: '0',
  SIM_JUDGE_WEIGHT: '0.55',
  SIM_JUDGE_TIMEOUT_MS: '120000',
  SIM_JUDGE_MAX_TOKENS: '900',
  SIM_REQUIRE_JUDGE_RESULTS: '0',
  SIM_MIN_JUDGE_AVG_SCORE: '0',
  SIM_MAX_JUDGE_REVISE_RATE: '1',
  SIM_JUDGE_API_KEY: '',
  SIM_REQUIRE_TRACE: '1',
  SIM_SEED: '',
  TUNE_RUNS_PER_VARIANT: '120',
  TUNE_CONCURRENCY: '6',
  TUNE_MAX_VARIANTS: '8',
  TUNE_KEEP_VARIANT_ROWS: '1',
  TUNE_JUDGE_ENABLED: '1',
  TUNE_JUDGE_WEIGHT: '0.55',
  TUNE_JUDGE_TIMEOUT_MS: '120000',
  TUNE_JUDGE_MAX_TOKENS: '900',
  TUNE_REQUIRE_JUDGE_RESULTS: '0',
  TUNE_MIN_JUDGE_AVG_SCORE: '0',
  TUNE_MAX_JUDGE_REVISE_RATE: '1',
  TUNE_VARIANTS_JSON: '',
  TUNE_OUTPUT_DIR: '',

  SECRET_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  MEMGRAPH_HOST: z.string().default('localhost'),
  MEMGRAPH_PORT: z.coerce.number().int().positive().default(7687),
  MEMGRAPH_USER: z.string().default(''),
  MEMGRAPH_PASSWORD: z.string().default(''),
  MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS: z.string().default('redpanda:9092'),
  KAFKA_BROKERS: z.string().default(''),
  KAFKA_INTERACTIONS_TOPIC: z.string().default('sage.social.interactions'),
  KAFKA_VOICE_TOPIC: z.string().default('sage.social.voice-sessions'),
  DEV_GUILD_ID: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().max(3600),
  AUTOPILOT_MODE: z.enum(['manual', 'reserved', 'talkative']),
  WAKE_WORDS_CSV: z.string(),
  WAKE_WORD_PREFIXES_CSV: z.string(),
  WAKEWORD_COOLDOWN_SEC: z.coerce.number().int().min(0),
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: z.coerce.number().int().min(0),

  VOICE_SERVICE_BASE_URL: httpOrHttpsUrlSchema.default('http://127.0.0.1:11333'),
  VOICE_STT_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  VOICE_STT_MODEL_ID: z.string().default('deepdml/faster-whisper-large-v3-turbo-ct2'),
  VOICE_STT_COMPUTE_TYPE: z.enum(['int8', 'int8_float16', 'float16', 'float32']).default('int8'),
  VOICE_STT_END_SILENCE_MS: z.coerce.number().int().min(100).max(10_000).default(900),
  VOICE_STT_MAX_UTTERANCE_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
  VOICE_STT_MIN_UTTERANCE_MS: z.coerce.number().int().min(0).max(10_000).default(400),
  VOICE_LIVE_CONTEXT_LOOKBACK_SEC: z.coerce.number().int().min(10).max(3600).default(180),
  VOICE_LIVE_CONTEXT_MAX_CHARS: z.coerce.number().int().min(200).max(30_000).default(4000),
  VOICE_LIVE_CONTEXT_MAX_UTTERANCES: z.coerce.number().int().min(5).max(500).default(80),
  VOICE_SESSION_SUMMARY_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  VOICE_MESSAGE_STT_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  VOICE_MESSAGE_STT_MAX_SECONDS: z.coerce.number().int().min(10).max(600).default(120),
  VOICE_MESSAGE_STT_MAX_BYTES: z.coerce.number().int().min(1024).max(104857600).default(5000000),
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
  EMBEDDING_MODEL: z.string().default('nomic-ai/nomic-embed-text-v1.5'),
  EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .default(256)
    .refine(
      (value) => value === 256,
      'EMBEDDING_DIMENSIONS must be 256 while AttachmentChunk.embedding uses vector(256).',
    ),
  LTM_COMPACTION_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
  USER_PROFILE_COMPACTION_INTERVAL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  LLM_PROVIDER: z.enum(['pollinations']),
  LLM_BASE_URL: httpsUrlSchema,
  LLM_IMAGE_BASE_URL: httpsUrlSchema,
  CHAT_MODEL: z
    .string()
    .refine(
      (value) => value.trim().toLowerCase() !== 'openai-large',
      'CHAT_MODEL "openai-large" is no longer supported. Use "kimi" or another active model.',
    ),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL_LIMITS_JSON: z.string(),
  PROFILE_PROVIDER: z.string(),
  PROFILE_CHAT_MODEL: z.string(),
  PROFILE_UPDATE_INTERVAL: z.coerce.number().int().positive(),
  TIMEOUT_CHAT_MS: z.coerce.number().int().positive().max(300000),
  TIMEOUT_SEARCH_MS: z.coerce.number().int().positive().max(900000).default(300000),
  TIMEOUT_SEARCH_SCRAPER_MS: z.coerce.number().int().positive().max(900000).default(480000),
  TIMEOUT_MEMORY_MS: z.coerce.number().int().positive().max(600000),
  SEARCH_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
  TOOL_WEB_SEARCH_PROVIDER_ORDER: z.string().default('tavily,exa,searxng,pollinations'),
  TOOL_WEB_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  TOOL_WEB_SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(6),
  TOOL_WEB_SCRAPE_PROVIDER_ORDER: z.string().default('crawl4ai,firecrawl,jina,nomnom,raw_fetch'),
  TOOL_WEB_SCRAPE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  TOOL_WEB_SCRAPE_MAX_CHARS: z.coerce.number().int().min(500).max(50000).default(20000),
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  SEARXNG_BASE_URL: optionalHttpOrHttpsUrlSchema,
  SEARXNG_HOST_PORT: z.string().default('18080'),
  SEARXNG_SEARCH_PATH: z.string().default('/search'),
  SEARXNG_CATEGORIES: z.string().default('general'),
  SEARXNG_LANGUAGE: z.string().default('en-US'),
  FIRECRAWL_API_KEY: z.string().optional(),
  FIRECRAWL_BASE_URL: httpOrHttpsUrlSchema.default('https://api.firecrawl.dev/v1'),
  CRAWL4AI_BASE_URL: optionalHttpOrHttpsUrlSchema,
  CRAWL4AI_BEARER_TOKEN: z.string().optional(),
  JINA_READER_BASE_URL: z.string().default('https://r.jina.ai/http://'),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_CODE_SEARCH_MAX_CANDIDATES: z.coerce.number().int().min(1).max(100).default(30),
  GITHUB_REGEX_MAX_FILES: z.coerce.number().int().min(1).max(100).default(20),
  GITHUB_REGEX_MAX_MATCHES: z.coerce.number().int().min(1).max(1000).default(120),
  GITHUB_FILE_LOOKUP_MAX_LINE_SPAN: z.coerce.number().int().min(10).max(5000).default(800),
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(16000).default(1800),
  CODING_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32000).default(4200),
  SEARCH_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(16000).default(2000),
  LLM_DOCTOR_PING: z.enum(['0', '1']).default('0'),
  AGENTIC_TOOL_LOOP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  AGENTIC_TOOL_MAX_ROUNDS: z.coerce.number().int().min(1).max(10).default(6),
  AGENTIC_TOOL_MAX_CALLS_PER_ROUND: z.coerce.number().int().min(1).max(10).default(3),
  AGENTIC_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  AGENTIC_TOOL_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(8000).default(1200),
  AGENTIC_TOOL_RESULT_MAX_CHARS: z.coerce.number().int().min(500).max(50000).default(8000),
  AGENTIC_TOOL_GITHUB_GROUNDED_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AGENTIC_TOOL_PARALLEL_READ_ONLY_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AGENTIC_TOOL_MAX_PARALLEL_READ_ONLY: z.coerce.number().int().min(1).max(10).default(3),

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
  EVAL_GATE_LATEST_PER_TRACE: z.string().default('1'),

  SIM_RUNS: z.string().default('80'),
  SIM_CONCURRENCY: z.string().default('6'),
  SIM_GUILD_ID: z.string().default(''),
  SIM_CHANNEL_PREFIX: z.string().default('sim-agentic'),
  SIM_USER_PREFIX: z.string().default('sim-user'),
  SIM_TRACE_PREFIX: z.string().default('sim-agentic'),
  SIM_OUTPUT_JSON: z.string().default(''),
  SIM_MIN_AVG_SCORE: z.string().default('0'),
  SIM_MIN_SUCCESS_RATE: z.string().default('0'),
  SIM_MIN_TOOL_EXECUTION_RATE: z.string().default('0'),
  SIM_MAX_ERROR_RATE: z.string().default('1'),
  SIM_JUDGE_ENABLED: z.string().default('0'),
  SIM_JUDGE_WEIGHT: z.string().default('0.55'),
  SIM_JUDGE_TIMEOUT_MS: z.string().default('120000'),
  SIM_JUDGE_MAX_TOKENS: z.string().default('900'),
  SIM_REQUIRE_JUDGE_RESULTS: z.string().default('0'),
  SIM_MIN_JUDGE_AVG_SCORE: z.string().default('0'),
  SIM_MAX_JUDGE_REVISE_RATE: z.string().default('1'),
  SIM_JUDGE_API_KEY: z.string().default(''),
  SIM_REQUIRE_TRACE: z.string().default('1'),
  SIM_SEED: z.string().default(''),
  TUNE_RUNS_PER_VARIANT: z.string().default('120'),
  TUNE_CONCURRENCY: z.string().default('6'),
  TUNE_MAX_VARIANTS: z.string().default('8'),
  TUNE_KEEP_VARIANT_ROWS: z.string().default('1'),
  TUNE_JUDGE_ENABLED: z.string().default('1'),
  TUNE_JUDGE_WEIGHT: z.string().default('0.55'),
  TUNE_JUDGE_TIMEOUT_MS: z.string().default('120000'),
  TUNE_JUDGE_MAX_TOKENS: z.string().default('900'),
  TUNE_REQUIRE_JUDGE_RESULTS: z.string().default('0'),
  TUNE_MIN_JUDGE_AVG_SCORE: z.string().default('0'),
  TUNE_MAX_JUDGE_REVISE_RATE: z.string().default('1'),
  TUNE_VARIANTS_JSON: z.string().default(''),
  TUNE_OUTPUT_DIR: z.string().default(''),

  SECRET_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export type EnvSchema = z.infer<typeof envSchema>;

export function mergeEnvWithTestDefaults(
  processEnv: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  return {
    ...(processEnv.NODE_ENV === 'test' ? testDefaults : {}),
    ...processEnv,
  };
}

export function parseEnvSafe(processEnv: NodeJS.ProcessEnv) {
  return envSchema.safeParse(mergeEnvWithTestDefaults(processEnv));
}

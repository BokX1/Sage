import { z } from 'zod';
import net from 'node:net';

/**
 * Check whether a hostname resolves to localhost or RFC1918 private network ranges.
 *
 * @param hostname Hostname (IPv4/IPv6 or DNS label) to validate.
 * @returns True when the host is local/private and should be rejected for outbound public URLs.
 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;

  const unwrappedIpv6 = normalized.replace(/^\[/, '').replace(/\]$/, '');

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;

  const ipFamily = net.isIP(unwrappedIpv6);
  if (ipFamily === 4) {
    return isNonPublicIpv4Address(unwrappedIpv6);
  }
  if (ipFamily === 6) {
    return isNonPublicIpv6Address(unwrappedIpv6);
  }

  return false;
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (!Number.isFinite(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function isNonPublicIpv4Address(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (!octets) return true;
  const [a, b, c] = octets;

  // Loopback 127.0.0.0/8
  if (a === 127) return true;
  // Unspecified / "this network" 0.0.0.0/8
  if (a === 0) return true;
  // RFC1918 private ranges
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Link-local 169.254.0.0/16
  if (a === 169 && b === 254) return true;
  // Carrier-grade NAT 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Documentation/test ranges
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  // Benchmarking 198.18.0.0/15
  if (a === 198 && (b === 18 || b === 19)) return true;
  // Multicast 224.0.0.0/4, reserved 240.0.0.0/4, and limited broadcast 255.255.255.255
  if (a >= 224) return true;

  return false;
}

function parseIpv6ToBytes(value: string): Uint8Array | null {
  const withoutZone = value.split('%')[0] ?? value;
  const input = withoutZone.toLowerCase();
  if (!input) return null;

  const parts = input.split('::');
  if (parts.length > 2) return null;
  const leftRaw = parts[0] ?? '';
  const rightRaw = parts.length === 2 ? parts[1] ?? '' : '';

  const left = leftRaw.length > 0 ? leftRaw.split(':').filter((s) => s.length > 0) : [];
  const right = rightRaw.length > 0 ? rightRaw.split(':').filter((s) => s.length > 0) : [];

  const convertIpv4Token = (token: string): string[] | null => {
    if (!token.includes('.')) return null;
    const octets = parseIpv4Octets(token);
    if (!octets) return null;
    const [a, b, c, d] = octets;
    return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
  };

  const maybeReplaceIpv4 = (groups: string[]): string[] | null => {
    if (groups.length === 0) return groups;
    const last = groups[groups.length - 1]!;
    const replacement = convertIpv4Token(last);
    if (!replacement) return groups;
    return [...groups.slice(0, -1), ...replacement];
  };

  const leftGroups = maybeReplaceIpv4(left);
  if (!leftGroups) return null;
  const rightGroups = maybeReplaceIpv4(right);
  if (!rightGroups) return null;

  const totalGroups = leftGroups.length + rightGroups.length;
  if (parts.length === 1) {
    if (totalGroups !== 8) return null;
  } else {
    if (totalGroups > 8) return null;
  }

  const zerosToInsert = parts.length === 2 ? 8 - totalGroups : 0;
  const groups = [...leftGroups, ...new Array(zerosToInsert).fill('0'), ...rightGroups];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const token = groups[i]!;
    if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
    const word = Number.parseInt(token, 16);
    if (!Number.isFinite(word) || word < 0 || word > 0xffff) return null;
    bytes[i * 2] = (word >> 8) & 0xff;
    bytes[i * 2 + 1] = word & 0xff;
  }
  return bytes;
}

function isNonPublicIpv6Address(ip: string): boolean {
  const bytes = parseIpv6ToBytes(ip);
  if (!bytes) return true;

  const isAllZero = bytes.every((b) => b === 0);
  if (isAllZero) return true; // ::

  const isLoopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
  if (isLoopback) return true; // ::1

  // IPv4-mapped address ::ffff:a.b.c.d
  const isV4Mapped =
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (isV4Mapped) {
    const ipv4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isNonPublicIpv4Address(ipv4);
  }

  // Unique local addresses fc00::/7
  if ((bytes[0] & 0xfe) === 0xfc) return true;

  // Link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;

  // Multicast ff00::/8
  if (bytes[0] === 0xff) return true;

  // Documentation 2001:db8::/32
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;

  return false;
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

/**
 * Declares exported bindings: testDefaults.
 */
export const testDefaults: Record<string, string> = {
  // Core / Discord
  NODE_ENV: 'test',
  DISCORD_TOKEN: 'test-discord-token',
  DISCORD_APP_ID: 'test-discord-app-id',
  DATABASE_URL: 'test-database-url',

  // Social Graph
  MEMGRAPH_HOST: 'localhost',
  MEMGRAPH_PORT: '7687',
  MEMGRAPH_USER: '',
  MEMGRAPH_PASSWORD: '',
  MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS: 'redpanda:9092',
  KAFKA_BROKERS: '',
  KAFKA_INTERACTIONS_TOPIC: 'sage.social.interactions',
  KAFKA_VOICE_TOPIC: 'sage.social.voice-sessions',

  // Bot Behavior
  LOG_LEVEL: 'info',
  RATE_LIMIT_MAX: '100',
  RATE_LIMIT_WINDOW_SEC: '60',
  AUTOPILOT_MODE: 'manual',
  WAKE_WORDS_CSV: 'sage,bot',
  WAKE_WORD_PREFIXES_CSV: '!',
  WAKEWORD_COOLDOWN_SEC: '10',
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: '5',

  // Voice
  VOICE_SERVICE_BASE_URL: 'http://127.0.0.1:11333',
  VOICE_STT_ENABLED: 'false',
  VOICE_STT_MODEL_ID: 'deepdml/faster-whisper-large-v3-turbo-ct2',
  VOICE_STT_COMPUTE_TYPE: 'int8',
  VOICE_STT_END_SILENCE_MS: '900',
  VOICE_STT_MAX_UTTERANCE_MS: '15000',
  VOICE_STT_MIN_UTTERANCE_MS: '400',
  VOICE_LIVE_CONTEXT_LOOKBACK_SEC: '180',
  VOICE_LIVE_CONTEXT_MAX_UTTERANCES: '80',
  VOICE_SESSION_SUMMARY_ENABLED: 'true',
  VOICE_MESSAGE_STT_ENABLED: 'false',
  VOICE_MESSAGE_STT_MAX_SECONDS: '120',
  VOICE_MESSAGE_STT_MAX_BYTES: '5000000',

  // Message Storage / Ingestion
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
  FILE_INGEST_IMAGE_ENABLED: 'true',
  FILE_INGEST_IMAGE_MODEL_ID: 'onnx-community/Florence-2-large-ft',
  FILE_INGEST_IMAGE_TIMEOUT_MS: '120000',
  RAW_MESSAGE_TTL_DAYS: '7',
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: '300',
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: '24',
  MESSAGE_DB_STORAGE_ENABLED: 'false',
  MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL: '1000',
  PROACTIVE_POSTING_ENABLED: 'false',

  // Channel Summaries
  SUMMARY_ROLLING_WINDOW_MIN: '15',
  SUMMARY_ROLLING_MIN_MESSAGES: '5',
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: '60',
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: '600',
  SUMMARY_SCHED_TICK_SEC: '60',

  // Context Budgets
  CONTEXT_MAX_INPUT_TOKENS: '120000',
  CONTEXT_RESERVED_OUTPUT_TOKENS: '4096',

  // Agentic Runtime / Embeddings / Tracing
  LANGSMITH_TRACING: 'false',
  LANGSMITH_ENDPOINT: 'https://api.smith.langchain.com',
  LANGSMITH_API_KEY: '',
  LANGSMITH_PROJECT: 'sage-test',
  SAGE_TRACE_DB_ENABLED: 'false',
  EMBEDDING_MODEL: 'nomic-ai/nomic-embed-text-v1.5',
  EMBEDDING_DIMENSIONS: '256',
  LTM_COMPACTION_ENABLED: 'true',
  USER_PROFILE_COMPACTION_INTERVAL_DAYS: '30',
  AI_PROVIDER_BASE_URL: 'https://ai-provider.example/v1',
  AI_PROVIDER_API_KEY: '',
  AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
  AI_PROVIDER_PROFILE_AGENT_MODEL: 'test-profile-agent-model',
  AI_PROVIDER_SUMMARY_AGENT_MODEL: 'test-summary-agent-model',
  AI_PROVIDER_MODEL_PROFILES_JSON: '',
  IMAGE_PROVIDER_BASE_URL: 'https://image-provider.example',
  IMAGE_PROVIDER_MODEL: 'test-image-model',
  IMAGE_PROVIDER_API_KEY: '',
  SERVER_PROVIDER_API_KEY: '',
  SERVER_PROVIDER_PROFILE_URL: 'https://server-provider.example/account/profile',
  SERVER_PROVIDER_AUTHORIZE_URL:
    'https://server-provider.example/authorize?redirect_url=https://server-provider.example&permissions=profile,balance,usage',
  SERVER_PROVIDER_DASHBOARD_URL: 'https://server-provider.example/dashboard',
  PROFILE_UPDATE_INTERVAL: '5',

  // Runtime Timeouts
  TIMEOUT_CHAT_MS: '300000',
  TIMEOUT_MEMORY_MS: '600000',

  // Tool Providers
  TOOL_WEB_SEARCH_PROVIDER_ORDER: 'tavily,exa,searxng',
  TOOL_WEB_SEARCH_TIMEOUT_MS: '45000',
  TOOL_WEB_SEARCH_MAX_RESULTS: '8',
  TOOL_WEB_SCRAPE_PROVIDER_ORDER: 'crawl4ai,firecrawl,jina,nomnom,raw_fetch',
  TOOL_WEB_SCRAPE_TIMEOUT_MS: '45000',
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
  GITHUB_CODE_SEARCH_MAX_CANDIDATES: '50',
  GITHUB_REGEX_MAX_FILES: '40',
  GITHUB_REGEX_MAX_MATCHES: '240',
  GITHUB_FILE_LOOKUP_MAX_LINE_SPAN: '1500',

  // Output / Runtime Control
  CHAT_MAX_OUTPUT_TOKENS: '4096',
  LLM_DOCTOR_PING: '0',
  AGENT_WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS: '2400',
  AGENT_WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS: '20000',
  AGENT_RUN_SLICE_MAX_STEPS: '10',
  AGENT_RUN_TOOL_TIMEOUT_MS: '45000',
  AGENT_GRAPH_MAX_OUTPUT_TOKENS: '4096',
  AGENT_GRAPH_GITHUB_GROUNDED_MODE: 'true',
  AGENT_RUN_SLICE_MAX_DURATION_MS: '120000',
  AGENT_RUN_MAX_TOTAL_DURATION_MS: '3600000',
  AGENT_RUN_MAX_IDLE_WAIT_MS: '86400000',
  AGENT_RUN_WORKER_POLL_MS: '5000',
  AGENT_RUN_LEASE_TTL_MS: '30000',
  AGENT_RUN_HEARTBEAT_MS: '10000',
  AGENT_RUN_MAX_RESUMES: '256',
  AGENT_RUN_COMPACTION_ENABLED: 'true',
  AGENT_RUN_COMPACTION_TRIGGER_EST_TOKENS: '64000',
  AGENT_RUN_COMPACTION_TRIGGER_ROUNDS: '6',
  AGENT_RUN_COMPACTION_TRIGGER_TOOL_RESULTS: '24',
  AGENT_RUN_COMPACTION_MAX_RAW_MESSAGES: '24',
  AGENT_RUN_COMPACTION_MAX_TOOL_OBSERVATIONS: '12',
  AGENT_GRAPH_MAX_TOOL_CALLS_PER_ROUND: '12',
  AGENT_GRAPH_MAX_IDENTICAL_TOOL_BATCHES: '4',
  AGENT_GRAPH_MAX_LOOP_GUARD_RECOVERIES: '3',

  // Security
  SECRET_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

/**
 * Declares exported bindings: envSchema.
 */
export const envSchema = z.object({
  // Core / Discord
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  // Social Graph
  MEMGRAPH_HOST: z.string().default('localhost'),
  MEMGRAPH_PORT: z.coerce.number().int().positive().default(7687),
  MEMGRAPH_USER: z.string().default(''),
  MEMGRAPH_PASSWORD: z.string().default(''),
  MEMGRAPH_KAFKA_BOOTSTRAP_SERVERS: z.string().default('redpanda:9092'),
  KAFKA_BROKERS: z.string().default(''),
  KAFKA_INTERACTIONS_TOPIC: z.string().default('sage.social.interactions'),
  KAFKA_VOICE_TOPIC: z.string().default('sage.social.voice-sessions'),

  // Bot Behavior
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().max(3600),
  AUTOPILOT_MODE: z.enum(['manual', 'reserved', 'talkative']),
  WAKE_WORDS_CSV: z.string(),
  WAKE_WORD_PREFIXES_CSV: z.string(),
  WAKEWORD_COOLDOWN_SEC: z.coerce.number().int().min(0),
  WAKEWORD_MAX_RESPONSES_PER_MIN_PER_CHANNEL: z.coerce.number().int().min(0),

  // Voice
  VOICE_SERVICE_BASE_URL: httpOrHttpsUrlSchema.default('http://127.0.0.1:11333'),
  VOICE_STT_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  VOICE_STT_MODEL_ID: z.string().default('deepdml/faster-whisper-large-v3-turbo-ct2'),
  VOICE_STT_COMPUTE_TYPE: z.enum(['int8', 'int8_float16', 'float16', 'float32']).default('int8'),
  VOICE_STT_END_SILENCE_MS: z.coerce.number().int().min(100).max(10_000).default(900),
  VOICE_STT_MAX_UTTERANCE_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
  VOICE_STT_MIN_UTTERANCE_MS: z.coerce.number().int().min(0).max(10_000).default(400),
  VOICE_LIVE_CONTEXT_LOOKBACK_SEC: z.coerce.number().int().min(10).max(3600).default(180),
  VOICE_LIVE_CONTEXT_MAX_UTTERANCES: z.coerce.number().int().min(5).max(500).default(80),
  VOICE_SESSION_SUMMARY_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  VOICE_MESSAGE_STT_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  VOICE_MESSAGE_STT_MAX_SECONDS: z.coerce.number().int().min(10).max(600).default(120),
  VOICE_MESSAGE_STT_MAX_BYTES: z.coerce.number().int().min(1024).max(104857600).default(5000000),

  // Message Storage / Ingestion
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
  FILE_INGEST_IMAGE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  FILE_INGEST_IMAGE_MODEL_ID: z.string().trim().min(1).default('onnx-community/Florence-2-large-ft'),
  FILE_INGEST_IMAGE_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120000),
  RAW_MESSAGE_TTL_DAYS: z.coerce.number().int().positive().max(365),
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: z.coerce.number().int().positive().max(5000),
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: z.coerce.number().int().positive(),
  MESSAGE_DB_STORAGE_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
  MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL: z.coerce.number().int().positive().max(50000).default(1000),
  PROACTIVE_POSTING_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),

  // Channel Summaries
  SUMMARY_ROLLING_WINDOW_MIN: z.coerce.number().int().positive(),
  SUMMARY_ROLLING_MIN_MESSAGES: z.coerce.number().int().positive(),
  SUMMARY_ROLLING_MIN_INTERVAL_SEC: z.coerce.number().int().positive(),
  SUMMARY_PROFILE_MIN_INTERVAL_SEC: z.coerce.number().int().positive(),
  SUMMARY_SCHED_TICK_SEC: z.coerce.number().int().positive(),

  // Context Budgets
  CONTEXT_MAX_INPUT_TOKENS: z.coerce.number().int().positive(),
  CONTEXT_RESERVED_OUTPUT_TOKENS: z.coerce.number().int().positive(),

  // Agentic Runtime / Embeddings / Tracing
  LANGSMITH_TRACING: z.enum(['true', 'false']).transform((v) => v === 'true'),
  LANGSMITH_ENDPOINT: optionalHttpOrHttpsUrlSchema.default('https://api.smith.langchain.com'),
  LANGSMITH_API_KEY: z.string().trim().optional(),
  LANGSMITH_PROJECT: z.string().trim().optional(),
  SAGE_TRACE_DB_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
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
  AI_PROVIDER_BASE_URL: httpOrHttpsUrlSchema,
  AI_PROVIDER_API_KEY: z.string().trim().optional(),
  AI_PROVIDER_MAIN_AGENT_MODEL: z.string().trim().min(1),
  AI_PROVIDER_PROFILE_AGENT_MODEL: z.string().trim().min(1),
  AI_PROVIDER_SUMMARY_AGENT_MODEL: z.string().trim().min(1),
  AI_PROVIDER_MODEL_PROFILES_JSON: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional()
    .refine((value) => {
      if (!value) return true;
      try {
        const parsed = JSON.parse(value) as unknown;
        return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
      } catch {
        return false;
      }
    }, 'AI_PROVIDER_MODEL_PROFILES_JSON must be a valid JSON object keyed by model id when provided.'),
  IMAGE_PROVIDER_BASE_URL: httpOrHttpsUrlSchema,
  IMAGE_PROVIDER_MODEL: z.string().trim().min(1),
  IMAGE_PROVIDER_API_KEY: z.string().optional(),
  SERVER_PROVIDER_API_KEY: z.string().optional(),
  SERVER_PROVIDER_PROFILE_URL: httpsUrlSchema,
  SERVER_PROVIDER_AUTHORIZE_URL: httpsUrlSchema,
  SERVER_PROVIDER_DASHBOARD_URL: httpsUrlSchema,
  PROFILE_UPDATE_INTERVAL: z.coerce.number().int().positive(),

  // Runtime Timeouts
  TIMEOUT_CHAT_MS: z.coerce.number().int().positive().max(300000),
  TIMEOUT_MEMORY_MS: z.coerce.number().int().positive().max(600000),

  // Tool Providers
  TOOL_WEB_SEARCH_PROVIDER_ORDER: z.string().default('tavily,exa,searxng'),
  TOOL_WEB_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  TOOL_WEB_SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(8),
  TOOL_WEB_SCRAPE_PROVIDER_ORDER: z.string().default('crawl4ai,firecrawl,jina,nomnom,raw_fetch'),
  TOOL_WEB_SCRAPE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
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
  GITHUB_CODE_SEARCH_MAX_CANDIDATES: z.coerce.number().int().min(1).max(100).default(50),
  GITHUB_REGEX_MAX_FILES: z.coerce.number().int().min(1).max(100).default(40),
  GITHUB_REGEX_MAX_MATCHES: z.coerce.number().int().min(1).max(1000).default(240),
  GITHUB_FILE_LOOKUP_MAX_LINE_SPAN: z.coerce.number().int().min(10).max(5000).default(1500),

  // Output / Runtime Control
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(16000).default(4096),
  LLM_DOCTOR_PING: z.enum(['0', '1']).default('0'),
  AGENT_WINDOW_CLOSEOUT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8_000).default(2_400),
  AGENT_WINDOW_CLOSEOUT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(60_000).default(20_000),
  AGENT_RUN_SLICE_MAX_STEPS: z.coerce.number().int().min(1).max(32).default(10),
  AGENT_RUN_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  AGENT_GRAPH_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(8000).default(4096),
  AGENT_GRAPH_GITHUB_GROUNDED_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AGENT_RUN_SLICE_MAX_DURATION_MS: z.coerce.number().int().min(10_000).max(300_000).default(120_000),
  AGENT_RUN_MAX_TOTAL_DURATION_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
  AGENT_RUN_MAX_IDLE_WAIT_MS: z.coerce.number().int().min(60_000).max(604_800_000).default(86_400_000),
  AGENT_RUN_WORKER_POLL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  AGENT_RUN_LEASE_TTL_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  AGENT_RUN_HEARTBEAT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  AGENT_RUN_MAX_RESUMES: z.coerce.number().int().min(1).max(10_000).default(256),
  AGENT_RUN_COMPACTION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AGENT_RUN_COMPACTION_TRIGGER_EST_TOKENS: z.coerce.number().int().min(1_000).max(200_000).default(64_000),
  AGENT_RUN_COMPACTION_TRIGGER_ROUNDS: z.coerce.number().int().min(1).max(64).default(6),
  AGENT_RUN_COMPACTION_TRIGGER_TOOL_RESULTS: z.coerce.number().int().min(1).max(256).default(24),
  AGENT_RUN_COMPACTION_MAX_RAW_MESSAGES: z.coerce.number().int().min(2).max(128).default(24),
  AGENT_RUN_COMPACTION_MAX_TOOL_OBSERVATIONS: z.coerce.number().int().min(1).max(128).default(12),
  AGENT_GRAPH_RECURSION_LIMIT: z.coerce.number().int().min(2).max(512).optional(),
  AGENT_GRAPH_MAX_TOOL_CALLS_PER_ROUND: z.coerce.number().int().min(1).max(32).default(12),
  AGENT_GRAPH_MAX_IDENTICAL_TOOL_BATCHES: z.coerce.number().int().min(2).max(8).default(4),
  AGENT_GRAPH_MAX_LOOP_GUARD_RECOVERIES: z.coerce.number().int().min(0).max(4).default(3),

  // Security
  SECRET_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'test') {
    return;
  }

  if (value.LANGSMITH_TRACING && !value.LANGSMITH_API_KEY?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LANGSMITH_API_KEY'],
      message: 'LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true.',
    });
  }
});

/**
 * Represents the EnvSchema type.
 */
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

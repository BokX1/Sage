import { config } from '../../../platform/config/env';
import { isPrivateOrLocalHostname } from '../../../platform/config/env';
import { PermissionsBitField } from 'discord.js';
import { client } from '../../../platform/discord/client';
import { prisma } from '../../../platform/db/prisma-client';
import { logger } from '../../../platform/logging/logger';
import { normalizeTimeoutMs } from '../../../shared/utils/timeout';
import { normalizeBoundedInt } from '../../../shared/utils/numbers';
import {
  ToolDetailedError,
  classifyHttpStatus,
  extractToolErrorDetails,
  type ToolFailureCategory,
} from '../toolErrors';
import { callMcpTool, getMcpToolDescriptor } from '../mcp/manager';
import {
  type IngestedAttachmentRecord,
  findIngestedAttachmentsForLookup,
  findIngestedAttachmentsForLookupInGuild,
  listIngestedAttachmentsByIds,
  listRecentIngestedAttachments,
} from '../../attachments/ingestedAttachmentRepo';
import { requestDiscordInteractionForTool } from '../../admin/adminActionService';
import { filterChannelIdsByMemberAccess, type ChannelPermissionRequirement } from '../../../platform/discord/channel-access';
import {
  type ChannelMessageSearchResult,
  cosineSimilarity,
  embedText,
  embedTexts,
  getChannelMessageHistoryStats,
  getChannelMessageWindowById,
  searchChannelMessagesLexical,
  searchChannelMessagesRegex,
  searchChannelMessagesSemantic,
  searchAttachments as searchAttachmentChunks,
  supportsChannelMessageSemanticSearch,
} from '../../embeddings';
import { getUserProfileRecord } from '../../memory/userProfileRepo';
import { parseUserProfileSummary } from '../../memory/userProfileXml';
import { getChannelSummaryStore } from '../../summary/channelSummaryStoreRegistry';
import { ChannelSummary } from '../../summary/channelSummaryStore';

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 45_000;
const DEFAULT_WEB_SCRAPE_TIMEOUT_MS = 45_000;
const MIN_FETCH_TIMEOUT_MS = 1_000;
const MAX_FETCH_TIMEOUT_MS = 600_000;
const DEFAULT_WEB_SEARCH_MAX_RESULTS = 6;
const WEB_PROVIDER_TRANSIENT_COOLDOWN_MS = 5 * 60_000;
const WEB_PROVIDER_UPSTREAM_COOLDOWN_MS = 2 * 60_000;
const WEB_PROVIDER_AUTH_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const DEFAULT_EXA_SEARCH_URL = 'https://api.exa.ai/search';
const DEFAULT_JINA_READER_BASE_URL = 'https://r.jina.ai/http://';
const DEFAULT_IMAGE_GEN_TIMEOUT_MS = 360_000;
/**
 * Represents the SearchDepth type.
 */
export type SearchDepth = 'quick' | 'balanced' | 'deep';
type SearchProviderId = 'tavily' | 'exa' | 'searxng';
type ScrapeProviderId = 'firecrawl' | 'crawl4ai' | 'jina' | 'raw_fetch';
type WebProviderId = SearchProviderId | ScrapeProviderId;
type WebProviderHealthState = {
  untilMs: number;
  reason: string;
  category: ToolFailureCategory;
};
type WebProviderRuntimeStatus = {
  provider: WebProviderId;
  family: 'search' | 'scrape';
  configured: boolean;
  coolingDown: boolean;
  cooldownUntil: string | null;
  cooldownReason: string | null;
  failureCategory: ToolFailureCategory | null;
};

type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  score?: number;
};

type SearchOutcome = {
  provider: SearchProviderId;
  answer: string;
  sourceUrls: string[];
  results: SearchResult[];
  model?: string;
  rawContent?: string;
};

const WEB_PROVIDER_IDS: readonly WebProviderId[] = [
  'tavily',
  'exa',
  'searxng',
  'firecrawl',
  'crawl4ai',
  'jina',
  'raw_fetch',
] as const;

const webProviderHealth = new Map<WebProviderId, WebProviderHealthState>();

const LOCAL_PROVIDER_CONNECTIVITY_MARKERS = [
  'econnrefused',
  'enotfound',
  'ehostunreach',
  'etimedout',
  'econnreset',
  'socket hang up',
  'fetch failed',
  'networkerror',
  'network error',
] as const;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError') {
    return true;
  }
  const lower = errorText(error).toLowerCase();
  return lower.includes('aborterror') || lower.includes('aborted');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new ToolDetailedError('Request aborted.', { category: 'timeout' });
}

function composeAbortSignal(parentSignal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!parentSignal) return timeoutSignal;
  if (parentSignal.aborted) return parentSignal;

  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', abort, { once: true });

  if (timeoutSignal.aborted) {
    controller.abort();
  }

  return controller.signal;
}

function isProviderConnectivityError(error: unknown): boolean {
  const lower = errorText(error).toLowerCase();
  if (/\bhttp\s+\d{3}\b/i.test(lower)) return false;
  return LOCAL_PROVIDER_CONNECTIVITY_MARKERS.some((marker) => lower.includes(marker));
}

function getWebProviderHealth(provider: WebProviderId): WebProviderHealthState | null {
  const state = webProviderHealth.get(provider);
  if (!state) return null;
  if (state.untilMs <= Date.now()) {
    webProviderHealth.delete(provider);
    return null;
  }
  return state;
}

function clearWebProviderHealth(provider: WebProviderId): void {
  webProviderHealth.delete(provider);
}

function getProviderCooldownMs(category: ToolFailureCategory, retryAfterMs?: number): number | null {
  switch (category) {
    case 'unauthorized':
    case 'forbidden':
    case 'misconfigured':
      return WEB_PROVIDER_AUTH_COOLDOWN_MS;
    case 'rate_limited':
      return Math.min(Math.max(retryAfterMs ?? WEB_PROVIDER_UPSTREAM_COOLDOWN_MS, 30_000), WEB_PROVIDER_AUTH_COOLDOWN_MS);
    case 'timeout':
    case 'network_error':
      return WEB_PROVIDER_TRANSIENT_COOLDOWN_MS;
    case 'server_error':
    case 'upstream_error':
    case 'unknown':
      return WEB_PROVIDER_UPSTREAM_COOLDOWN_MS;
    default:
      return null;
  }
}

function markWebProviderHealth(provider: WebProviderId, error: unknown): void {
  const details = extractToolErrorDetails(error)
    ?? (isProviderConnectivityError(error) ? { category: 'network_error' as const } : null);
  if (!details) return;

  const cooldownMs = getProviderCooldownMs(details.category, details.retryAfterMs);
  if (cooldownMs === null) return;

  const reason = errorText(error);
  const untilMs = Date.now() + cooldownMs;
  webProviderHealth.set(provider, {
    untilMs,
    reason,
    category: details.category,
  });
  logger.warn(
    {
      provider,
      cooldownUntil: new Date(untilMs).toISOString(),
      failureCategory: details.category,
      reason,
    },
    'Web provider degraded; entering cooldown',
  );
}

function formatProviderHealthState(state: WebProviderHealthState): string {
  const remainingMs = Math.max(0, state.untilMs - Date.now());
  return `${state.category}; ${Math.ceil(remainingMs / 1000)}s remaining (${state.reason})`;
}

export function __resetWebProviderHealthForTests(): void {
  webProviderHealth.clear();
}

function isWebProviderConfigured(provider: WebProviderId): boolean {
  switch (provider) {
    case 'tavily':
      return !!(config.TAVILY_API_KEY as string | undefined)?.trim();
    case 'exa':
      return !!(config.EXA_API_KEY as string | undefined)?.trim();
    case 'searxng':
      return !!(config.SEARXNG_BASE_URL as string | undefined)?.trim();
    case 'firecrawl':
      return !!getMcpToolDescriptor('firecrawl', 'firecrawl_scrape') || !!getMcpToolDescriptor('firecrawl', 'scrape');
    case 'crawl4ai':
      return !!(config.CRAWL4AI_BASE_URL as string | undefined)?.trim();
    case 'jina':
    case 'raw_fetch':
      return true;
  }
}

function providerFamily(provider: WebProviderId): 'search' | 'scrape' {
  return provider === 'tavily' || provider === 'exa' || provider === 'searxng' ? 'search' : 'scrape';
}

export function getWebProviderRuntimeStatus(): WebProviderRuntimeStatus[] {
  return WEB_PROVIDER_IDS.map((provider) => {
    const cooldown = getWebProviderHealth(provider);
    return {
      provider,
      family: providerFamily(provider),
      configured: isWebProviderConfigured(provider),
      coolingDown: !!cooldown,
      cooldownUntil: cooldown ? new Date(cooldown.untilMs).toISOString() : null,
      cooldownReason: cooldown?.reason ?? null,
      failureCategory: cooldown?.category ?? null,
    };
  });
}

function toInt(value: number | undefined, fallback: number, min: number, max: number): number {
  return normalizeBoundedInt(value, fallback, min, max);
}

function pickString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function pickNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mcpSchemaHasProperty(schema: Record<string, unknown>, property: string): boolean {
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};
  return property in properties;
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function normalizeSearchResults(rawResults: Record<string, unknown>[]): SearchResult[] {
  const normalized: SearchResult[] = [];
  for (const result of rawResults) {
    const url = sanitizePublicUrl(pickString(result, 'url') ?? pickString(result, 'link') ?? '');
    if (!url) continue;
    normalized.push({
      title: pickString(result, 'title') ?? pickString(result, 'name') ?? url,
      url,
      snippet: pickString(result, 'content') ?? pickString(result, 'snippet') ?? pickString(result, 'text') ?? undefined,
      publishedDate:
        pickString(result, 'published_date') ?? pickString(result, 'publishedDate') ?? pickString(result, 'date') ?? undefined,
      score: pickNumber(result, 'score') ?? undefined,
    });
  }
  return normalized;
}

function summarizeResults(results: SearchResult[], fallback = 'No concise answer returned.'): string {
  if (results.length === 0) return fallback;
  return results
    .slice(0, 3)
    .map((result, index) => `${index + 1}. ${result.title}${result.snippet ? ` - ${result.snippet}` : ''}`)
    .join('\n');
}

function summarizeLabeledList(
  items: Array<{ title: string; detail?: string }>,
  fallback: string,
  limit = 3,
): string {
  if (items.length === 0) return fallback;
  return items
    .slice(0, limit)
    .map((item, index) => `${index + 1}. ${item.title}${item.detail ? ` - ${item.detail}` : ''}`)
    .join('\n');
}

const BASIC_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: ' ',
  '#39': "'",
};

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&#(\d+);|&#x([0-9a-f]+);|&(amp|lt|gt|quot|nbsp|#39);/gi,
    (match: string, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (dec !== undefined) return String.fromCodePoint(Number.parseInt(dec, 10));
      if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (!named) return match;
      return BASIC_HTML_ENTITIES[named.toLowerCase()] ?? match;
    },
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const boundedTimeoutMs = normalizeTimeoutMs(timeoutMs, {
    fallbackMs: DEFAULT_WEB_SEARCH_TIMEOUT_MS,
    minMs: MIN_FETCH_TIMEOUT_MS,
    maxMs: MAX_FETCH_TIMEOUT_MS,
  });
  const controller = new AbortController();
  const callerSignal = signal ?? (init.signal as AbortSignal | undefined);
  throwIfAborted(callerSignal);
  const timeoutHandle = setTimeout(() => controller.abort(), boundedTimeoutMs);
  timeoutHandle.unref?.();
  try {
    return await fetch(url, {
      ...init,
      signal: composeAbortSignal(callerSignal, controller.signal),
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeUrlForErrorDetails(value: string): { url: string | null; host: string | null } {
  const parsed = tryParseUrl(value);
  if (!parsed) return { url: null, host: null };
  // Avoid leaking query strings / fragments into tool-error payloads (may include secrets).
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return { url: parsed.toString(), host: parsed.hostname };
}

function inferProviderFromUrl(value: string): string | null {
  const parsed = tryParseUrl(value);
  const host = parsed?.hostname?.trim().toLowerCase() ?? '';
  if (!host) return null;

  if (host === 'api.github.com' || host === 'github.com' || host === 'www.github.com') return 'github';
  if (host === 'registry.npmjs.org') return 'npm';
  if (host === 'api.stackexchange.com') return 'stackexchange';
  if (host === 'api.tavily.com') return 'tavily';
  if (host === 'api.exa.ai') return 'exa';
  if (host === 'api.firecrawl.dev') return 'firecrawl';
  if (host === 'r.jina.ai') return 'jina';
  if (host.endsWith('.wikipedia.org')) return 'wikipedia';
  if (host.includes('searx')) return 'searxng';

  return null;
}

function parseRetryAfterMs(value: string | null): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds * 1000));
  const untilMs = Date.parse(raw);
  if (Number.isFinite(untilMs)) return Math.max(0, untilMs - Date.now());
  return null;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const safe = safeUrlForErrorDetails(url);
  const provider = inferProviderFromUrl(url) ?? undefined;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, init, timeoutMs, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw new ToolDetailedError(
        'Request aborted.',
        {
          category: 'timeout',
          provider,
          host: safe.host ?? undefined,
          url: safe.url ?? undefined,
        },
        { cause: error },
      );
    }
    const errorCode = (error as unknown as { code?: unknown }).code;
    throw new ToolDetailedError(
      `Network request failed: ${errorText(error)}`,
      {
        category: 'network_error',
        provider,
        host: safe.host ?? undefined,
        url: safe.url ?? undefined,
        code: typeof errorCode === 'string' ? errorCode.trim() : undefined,
      },
      { cause: error },
    );
  }

  const raw = await response.text();
  if (!response.ok) {
    const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after') ?? null);
    const statusText = response.statusText?.trim() ?? '';
    const snippet = raw.trim().slice(0, 240);
    const detail = statusText || snippet || 'Request failed';
    throw new ToolDetailedError(`HTTP ${response.status}: ${detail}`, {
      category: classifyHttpStatus(response.status),
      httpStatus: response.status,
      retryAfterMs: retryAfterMs ?? undefined,
      provider,
      host: safe.host ?? undefined,
      url: safe.url ?? undefined,
    });
  }

  if (!raw.trim()) {
    throw new ToolDetailedError('Response body was empty', {
      category: 'upstream_error',
      httpStatus: response.status,
      provider,
      host: safe.host ?? undefined,
      url: safe.url ?? undefined,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ToolDetailedError(`Response body was not valid JSON: ${raw.slice(0, 240)}`, {
      category: 'upstream_error',
      httpStatus: response.status,
      provider,
      host: safe.host ?? undefined,
      url: safe.url ?? undefined,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolDetailedError('JSON payload is not an object', {
      category: 'upstream_error',
      httpStatus: response.status,
      provider,
      host: safe.host ?? undefined,
      url: safe.url ?? undefined,
    });
  }
  return parsed as Record<string, unknown>;
}

function parseSearchProviderOrder(
  csv: string | undefined,
  options?: {
    preferredOrder?: SearchProviderId[];
  },
): SearchProviderId[] {
  const fallback: SearchProviderId[] = ['tavily', 'exa', 'searxng'];
  const valid = new Set<SearchProviderId>(['tavily', 'exa', 'searxng']);
  const preferredOrder = options?.preferredOrder ?? [];
  const sourceValues =
    preferredOrder.length > 0
      ? preferredOrder
      : csv
        ? csv.split(',').map((value) => value.trim())
        : [];
  const parsed = sourceValues
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is SearchProviderId => valid.has(value as SearchProviderId));
  const seen = new Set<SearchProviderId>();
  const deduped: SearchProviderId[] = [];
  for (const provider of parsed) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    deduped.push(provider);
  }
  return deduped.length > 0 ? deduped : fallback;
}

function buildBaseUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export function sanitizeUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function sanitizePublicUrl(value: string): string | null {
  const sanitized = sanitizeUrl(value);
  if (!sanitized) return null;
  try {
    const parsed = new URL(sanitized);
    if (isPrivateOrLocalHostname(parsed.hostname)) return null;
    return sanitized;
  } catch {
    return null;
  }
}

export function uniqueUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of matches) {
    const sanitized = sanitizePublicUrl(match);
    if (!sanitized) continue;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(sanitized);
  }
  return urls;
}

async function searchWithTavily(
  query: string,
  depth: SearchDepth,
  maxResults: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const apiKey = (config.TAVILY_API_KEY as string | undefined)?.trim();
  if (!apiKey) throw new Error('TAVILY_API_KEY is not configured');
  const payload = await fetchJson(
    DEFAULT_TAVILY_SEARCH_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: depth === 'deep' ? 'advanced' : 'basic',
        include_answer: true,
        include_raw_content: depth === 'deep',
        max_results: maxResults,
      }),
    },
    timeoutMs,
    signal,
  );
  const results = normalizeSearchResults(toRecordList(payload.results));
  const answer = pickString(payload, 'answer')?.trim() ?? '';
  if (results.length === 0 && !answer) {
    throw new Error('Tavily returned no results');
  }
  return {
    provider: 'tavily',
    answer: answer || summarizeResults(results),
    sourceUrls: results.map((entry) => entry.url),
    results,
  };
}

async function searchWithExa(
  query: string,
  depth: SearchDepth,
  maxResults: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const apiKey = (config.EXA_API_KEY as string | undefined)?.trim();
  if (!apiKey) throw new Error('EXA_API_KEY is not configured');
  const payload = await fetchJson(
    DEFAULT_EXA_SEARCH_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        numResults: maxResults,
        useAutoprompt: true,
        type: depth === 'quick' ? 'keyword' : 'neural',
        contents: depth === 'quick' ? { text: false } : { text: true },
      }),
    },
    timeoutMs,
    signal,
  );
  const results = normalizeSearchResults(toRecordList(payload.results));
  if (results.length === 0) throw new Error('Exa returned no results');
  return { provider: 'exa', answer: summarizeResults(results), sourceUrls: results.map((entry) => entry.url), results };
}

function parseSearxngHtmlResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const articlePattern = /<article\b[\s\S]*?<\/article>/gi;
  for (const match of html.matchAll(articlePattern)) {
    if (results.length >= maxResults) break;
    const article = match[0];
    const hrefMatch =
      article.match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"/i) ??
      article.match(/<a[^>]*class="[^"]*url_header[^"]*"[^>]*href="([^"]+)"/i);
    const url = sanitizePublicUrl(decodeHtmlEntities((hrefMatch?.[1] ?? '').trim()));
    if (!url) continue;

    const titleMatch = article.match(/<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = decodeHtmlEntities(stripHtml(titleMatch?.[1] ?? '')).trim() || url;
    const snippetMatch = article.match(/<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = decodeHtmlEntities(stripHtml(snippetMatch?.[1] ?? '')).trim() || undefined;
    results.push({ title, url, snippet });
  }
  return results;
}

async function searchWithSearxng(
  query: string,
  maxResults: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const baseUrl = (config.SEARXNG_BASE_URL as string | undefined)?.trim();
  if (!baseUrl) throw new Error('SEARXNG_BASE_URL is not configured');
  const searchPath = (config.SEARXNG_SEARCH_PATH as string | undefined)?.trim() || '/search';
  const language = (config.SEARXNG_LANGUAGE as string | undefined)?.trim() || 'en-US';
  const categories = (config.SEARXNG_CATEGORIES as string | undefined)?.trim() || 'general';
  const buildEndpoint = (format: 'json' | 'html'): URL => {
    const endpoint = new URL(buildBaseUrl(baseUrl, searchPath));
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('safesearch', '0');
    endpoint.searchParams.set('pageno', '1');
    endpoint.searchParams.set('language', language);
    endpoint.searchParams.set('categories', categories);
    if (format === 'json') {
      endpoint.searchParams.set('format', 'json');
    }
    return endpoint;
  };

  let jsonError: Error | undefined;
  try {
    const payload = await fetchJson(
      buildEndpoint('json').toString(),
      { method: 'GET', headers: { Accept: 'application/json' } },
      timeoutMs,
      signal,
    );
    const results = normalizeSearchResults(toRecordList(payload.results)).slice(0, maxResults);
    const answers = Array.isArray(payload.answers) ? payload.answers.filter((entry): entry is string => typeof entry === 'string') : [];
    if (results.length > 0 || answers.length > 0) {
      return {
        provider: 'searxng',
        answer: answers.find((entry) => entry.trim().length > 0)?.trim() || summarizeResults(results),
        sourceUrls: results.map((entry) => entry.url),
        results,
      };
    }
    throw new Error('SearXNG JSON endpoint returned no results');
  } catch (error) {
    if (isAbortError(error)) throw error;
    jsonError = error instanceof Error ? error : new Error(String(error));
    logger.warn({ error: jsonError }, 'searxng json endpoint failed; trying html fallback');
  }

  const htmlEndpoint = buildEndpoint('html');
  const htmlResponse = await fetchWithTimeout(
    htmlEndpoint.toString(),
    { method: 'GET', headers: { Accept: 'text/html' } },
    timeoutMs,
    signal,
  );
  const htmlBody = await htmlResponse.text();
  if (!htmlResponse.ok) {
    const jsonErrorText = jsonError ? ` JSON endpoint error: ${jsonError.message}` : '';
    throw new Error(`SearXNG HTML fallback failed with status ${htmlResponse.status}.${jsonErrorText}`);
  }
  const htmlResults = parseSearxngHtmlResults(htmlBody, maxResults);
  if (htmlResults.length === 0) {
    const jsonErrorText = jsonError ? ` JSON endpoint error: ${jsonError.message}` : '';
    throw new Error(`SearXNG returned no parseable HTML results.${jsonErrorText}`);
  }
  return {
    provider: 'searxng',
    answer: summarizeResults(htmlResults),
    sourceUrls: htmlResults.map((entry) => entry.url),
    results: htmlResults,
  };
}

export async function runWebSearch(params: {
  query: string;
  depth: SearchDepth;
  maxResults?: number;
  apiKey?: string;
  providerOrder?: SearchProviderId[];
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SEARCH_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SEARCH_TIMEOUT_MS, 5_000, 180_000);
  const configuredMaxResults = toInt((config.TOOL_WEB_SEARCH_MAX_RESULTS as number | undefined), DEFAULT_WEB_SEARCH_MAX_RESULTS, 1, 10);
  const maxResults = toInt(params.maxResults ?? configuredMaxResults, configuredMaxResults, 1, 10);
  const providerOrder = parseSearchProviderOrder(
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER as string | undefined,
    {
      preferredOrder: params.providerOrder,
    },
  );
  const providersTried: string[] = [];
  const providersSkipped: string[] = [];
  const providersSkipReasons: Record<string, string> = {};
  const errors: string[] = [];

  for (const provider of providerOrder) {
    if (!isWebProviderConfigured(provider)) {
      providersSkipped.push(provider);
      const reason = provider === 'searxng'
        ? 'not configured (SEARXNG_BASE_URL is empty)'
        : provider === 'tavily'
          ? 'not configured (TAVILY_API_KEY is empty)'
          : 'not configured (EXA_API_KEY is empty)';
      providersSkipReasons[provider] = reason;
      errors.push(`${provider}: skipped (${reason})`);
      continue;
    }
    const providerHealth = getWebProviderHealth(provider);
    if (providerHealth) {
      providersSkipped.push(provider);
      const reason = formatProviderHealthState(providerHealth);
      providersSkipReasons[provider] = reason;
      errors.push(`${provider}: skipped (${reason})`);
      continue;
    }
    providersTried.push(provider);
    try {
      const outcome =
        provider === 'tavily'
          ? await searchWithTavily(params.query, params.depth, maxResults, timeoutMs, params.signal)
          : provider === 'exa'
            ? await searchWithExa(params.query, params.depth, maxResults, timeoutMs, params.signal)
            : await searchWithSearxng(params.query, maxResults, timeoutMs, params.signal);

      clearWebProviderHealth(provider);

      return {
        query: params.query,
        depth: params.depth,
        checkedOn: new Date().toISOString().slice(0, 10),
        provider: outcome.provider,
        providersTried,
        providersSkipped,
        providersSkipReasons,
        providerHealth: getWebProviderRuntimeStatus(),
        sourceUrls: outcome.sourceUrls,
        answer: outcome.answer,
        results: outcome.results.slice(0, maxResults),
        model: outcome.model,
        rawContent: outcome.rawContent,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      markWebProviderHealth(provider, error);
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const skippedSuffix =
    providersSkipped.length > 0
      ? ` Skipped providers: ${providersSkipped.join(', ')}.`
      : '';
  throw new Error(
    `web.search failed. Providers attempted: ${providersTried.join(', ')}.${skippedSuffix} ${errors.join(' | ')}`.trim(),
  );
}

function extractScrapeContent(record: Record<string, unknown>): { title?: string; content: string } | null {
  const candidates: Record<string, unknown>[] = [record];
  const nestedData = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : null;
  if (nestedData) candidates.push(nestedData);
  const nestedResult = record.result && typeof record.result === 'object' && !Array.isArray(record.result)
    ? (record.result as Record<string, unknown>)
    : null;
  if (nestedResult) candidates.push(nestedResult);
  candidates.push(...toRecordList(record.results));
  if (nestedData?.results) candidates.push(...toRecordList(nestedData.results));

  for (const candidate of candidates) {
    const content = pickString(candidate, 'markdown') ?? pickString(candidate, 'fit_markdown') ?? pickString(candidate, 'content') ?? pickString(candidate, 'text');
    if (!content?.trim()) continue;
    const metadata = candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
      ? (candidate.metadata as Record<string, unknown>)
      : {};
    const title = pickString(candidate, 'title') ?? pickString(candidate, 'pageTitle') ?? pickString(metadata, 'title') ?? undefined;
    return { title, content: content.trim() };
  }

  return null;
}

async function scrapeWithFirecrawl(
  url: string,
  timeoutMs: number,
  _signal?: AbortSignal,
): Promise<{ provider: string; title?: string; content: string }> {
  void _signal;
  const tool =
    getMcpToolDescriptor('firecrawl', 'firecrawl_scrape')
    ?? getMcpToolDescriptor('firecrawl', 'scrape');
  if (!tool) {
    throw new Error('Firecrawl MCP preset is not configured or did not expose a scrape tool.');
  }

  const args: Record<string, unknown> = { url };
  if (mcpSchemaHasProperty(tool.inputSchema, 'formats')) args.formats = ['markdown'];
  if (mcpSchemaHasProperty(tool.inputSchema, 'format')) args.format = 'markdown';
  if (mcpSchemaHasProperty(tool.inputSchema, 'onlyMainContent')) args.onlyMainContent = true;
  if (mcpSchemaHasProperty(tool.inputSchema, 'only_main_content')) args.only_main_content = true;
  if (mcpSchemaHasProperty(tool.inputSchema, 'timeoutMs')) args.timeoutMs = timeoutMs;
  else if (mcpSchemaHasProperty(tool.inputSchema, 'timeout')) args.timeout = timeoutMs;

  const payload = await callMcpTool({
    serverId: 'firecrawl',
    rawToolName: tool.name,
    args,
  });
  const extracted = extractScrapeContent(
    payload.structuredContent && typeof payload.structuredContent === 'object' && !Array.isArray(payload.structuredContent)
      ? (payload.structuredContent as Record<string, unknown>)
      : { content: payload.modelSummary ?? '' },
  );
  if (!extracted) throw new Error('Firecrawl returned empty content');
  return { provider: 'firecrawl', title: extracted.title, content: extracted.content };
}

async function scrapeWithCrawl4ai(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ provider: string; title?: string; content: string }> {
  const baseUrl = (config.CRAWL4AI_BASE_URL as string | undefined)?.trim();
  if (!baseUrl) throw new Error('CRAWL4AI_BASE_URL is not configured');
  const endpoint = buildBaseUrl(baseUrl, '/md');
  const bearer = (config.CRAWL4AI_BEARER_TOKEN as string | undefined)?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const response = await fetchWithTimeout(
    endpoint,
    { method: 'POST', headers, body: JSON.stringify({ url }) },
    timeoutMs,
    signal,
  );
  const raw = await response.text();
  if (!response.ok) throw new Error(`Crawl4AI failed with status ${response.status}: ${raw.slice(0, 240)}`);

  let extracted: { title?: string; content: string } | null = null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      extracted = extractScrapeContent(parsed as Record<string, unknown>);
    }
  } catch {
    extracted = raw.trim() ? { content: raw.trim() } : null;
  }

  if (!extracted?.content.trim()) throw new Error('Crawl4AI returned empty content');
  return { provider: 'crawl4ai', title: extracted.title, content: extracted.content };
}

async function scrapeWithJina(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ provider: string; content: string }> {
  const readerBase = ((config.JINA_READER_BASE_URL as string | undefined)?.trim() || DEFAULT_JINA_READER_BASE_URL).replace(/\/+$/, '/');
  const readerUrl = `${readerBase}${url.replace(/^https?:\/\//i, '')}`;
  const response = await fetchWithTimeout(readerUrl, { method: 'GET', headers: { Accept: 'text/plain' } }, timeoutMs, signal);
  const text = await response.text();
  if (!response.ok) throw new Error(`Jina reader failed with status ${response.status}`);
  if (!text.trim()) throw new Error('Jina reader returned empty content');
  return { provider: 'jina', content: text.trim() };
}

async function scrapeWithRawFetch(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ provider: string; content: string }> {
  const response = await fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'SageAgent/1.0 (+https://github.com)' } }, timeoutMs, signal);
  const body = await response.text();
  if (!response.ok) throw new Error(`Raw fetch failed with status ${response.status}`);
  const stripped = stripHtml(body);
  if (!stripped.trim()) throw new Error('Raw fetch extracted no readable content');
  return { provider: 'raw_fetch', content: stripped };
}

export async function scrapeWebPage(params: {
  url: string;
  providerOrder?: ScrapeProviderId[];
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const sanitizedUrl = sanitizePublicUrl(params.url);
  if (!sanitizedUrl) {
    throw new Error('URL must be a public HTTP(S) URL.');
  }
  const timeoutMs = toInt((config.TOOL_WEB_SCRAPE_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SCRAPE_TIMEOUT_MS, 5_000, 180_000);
  const source = (config.TOOL_WEB_SCRAPE_PROVIDER_ORDER as string | undefined)?.trim() || 'crawl4ai,firecrawl,jina,raw_fetch';
  const configuredProviderOrder = source
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ScrapeProviderId => ['firecrawl', 'crawl4ai', 'jina', 'raw_fetch'].includes(value));
  const fallbackOrder: ScrapeProviderId[] = ['crawl4ai', 'firecrawl', 'jina', 'raw_fetch'];
  const seedOrder =
    params.providerOrder && params.providerOrder.length > 0
      ? params.providerOrder
      : configuredProviderOrder.length > 0
        ? configuredProviderOrder
        : fallbackOrder;
  const seenProviders = new Set<string>();
  const finalOrder: ScrapeProviderId[] = [];
  for (const provider of [...seedOrder, 'raw_fetch'] as const) {
    if (seenProviders.has(provider)) continue;
    seenProviders.add(provider);
    finalOrder.push(provider);
  }

  const errors: string[] = [];
  const providersTried: string[] = [];
  const providersSkipped: string[] = [];
  const providersSkipReasons: Record<string, string> = {};
  for (const provider of finalOrder) {
    if (!isWebProviderConfigured(provider)) {
      providersSkipped.push(provider);
      const reason = provider === 'firecrawl'
        ? 'not configured (Firecrawl MCP preset is unavailable)'
        : provider === 'crawl4ai'
          ? 'not configured (CRAWL4AI_BASE_URL is empty)'
          : 'not configured';
      providersSkipReasons[provider] = reason;
      errors.push(`${provider}: skipped (${reason})`);
      continue;
    }
    const providerHealth = getWebProviderHealth(provider);
    if (providerHealth) {
      providersSkipped.push(provider);
      const reason = formatProviderHealthState(providerHealth);
      providersSkipReasons[provider] = reason;
      errors.push(`${provider}: skipped (${reason})`);
      continue;
    }
    providersTried.push(provider);
    try {
      const outcome =
        provider === 'firecrawl'
          ? await scrapeWithFirecrawl(sanitizedUrl, timeoutMs, params.signal)
          : provider === 'crawl4ai'
            ? await scrapeWithCrawl4ai(sanitizedUrl, timeoutMs, params.signal)
            : provider === 'jina'
              ? await scrapeWithJina(sanitizedUrl, timeoutMs, params.signal)
              : await scrapeWithRawFetch(sanitizedUrl, timeoutMs, params.signal);
      clearWebProviderHealth(provider);
      return {
        url: sanitizedUrl,
        provider: outcome.provider,
        providersTried,
        providersSkipped,
        providersSkipReasons,
        providerHealth: getWebProviderRuntimeStatus(),
        title: 'title' in outcome ? outcome.title : undefined,
        content: outcome.content,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      markWebProviderHealth(provider, error);
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const skippedSuffix =
    providersSkipped.length > 0
      ? ` Skipped providers: ${providersSkipped.join(', ')}.`
      : '';
  throw new Error(`web.read failed:${skippedSuffix} ${errors.join(' | ')}`.trim());
}

function inferAttachmentType(record: IngestedAttachmentRecord): 'image' | 'file' {
  const contentType = record.contentType?.toLowerCase() ?? '';
  if (contentType.startsWith('image/')) {
    return 'image';
  }
  return record.extractor === 'vision' ? 'image' : 'file';
}

function hasStoredAttachmentText(record: IngestedAttachmentRecord): boolean {
  return typeof record.extractedText === 'string' && record.extractedText.length > 0;
}

function getAttachmentContentUnavailableGuidance(record: IngestedAttachmentRecord): string {
  const noun = inferAttachmentType(record) === 'image' ? 'image recall text' : 'attachment text';

  switch (record.status) {
    case 'queued':
      return `Stored ${noun} is queued for background processing. You can still resend the original attachment with \`discord_files\` action send_attachment.`;
    case 'processing':
      return `Stored ${noun} is still being generated. You can still resend the original attachment with \`discord_files\` action send_attachment.`;
    case 'error':
      return `Stored ${noun} is unavailable because extraction failed. You can still resend the original attachment with \`discord_files\` action send_attachment.`;
    case 'skip':
      return `Stored ${noun} is unavailable for this attachment. You can still resend the original attachment with \`discord_files\` action send_attachment.`;
    default:
      return `No stored ${noun} is available for this attachment. You can still resend the original attachment with \`discord_files\` action send_attachment.`;
  }
}

function buildStoredAttachmentPage(params: {
  record: IngestedAttachmentRecord;
  startChar: number;
  maxChars: number;
}): {
  readable: boolean;
  content: string | null;
  startChar: number;
  maxChars: number;
  returnedChars: number;
  totalChars: number;
  hasMore: boolean;
  nextStartChar: number | null;
  guidance: string;
} {
  if (!hasStoredAttachmentText(params.record)) {
    return {
      readable: false,
      content: null,
      startChar: 0,
      maxChars: params.maxChars,
      returnedChars: 0,
      totalChars: params.record.extractedTextChars,
      hasMore: false,
      nextStartChar: null,
      guidance: getAttachmentContentUnavailableGuidance(params.record),
    };
  }

  const extractedText = params.record.extractedText ?? '';
  const totalChars = extractedText.length;
  const boundedStart = Math.max(0, Math.min(params.startChar, totalChars));
  const endChar = Math.min(totalChars, boundedStart + params.maxChars);
  const content = extractedText.slice(boundedStart, endChar);
  const nextStartChar = endChar < totalChars ? endChar : null;

  return {
    readable: true,
    content,
    startChar: boundedStart,
    maxChars: params.maxChars,
    returnedChars: content.length,
    totalChars,
    hasMore: nextStartChar !== null,
    nextStartChar,
    guidance:
      nextStartChar !== null
        ? 'Call again with nextStartChar to continue paging stored attachment text.'
        : 'End of stored attachment text.',
  };
}

function formatAttachmentLookupItem(params: {
  record: IngestedAttachmentRecord;
  includeContent: boolean;
}): Record<string, unknown> {
  const { record, includeContent } = params;
  const hasStoredText = hasStoredAttachmentText(record);
  const content = record.extractedText ?? '';

  return {
    id: record.id,
    attachmentRef: `attachment:${record.id}`,
    attachmentType: inferAttachmentType(record),
    messageId: record.messageId,
    channelId: record.channelId,
    filename: record.filename,
    contentType: record.contentType,
    status: record.status,
    extractor: record.extractor,
    declaredSizeBytes: record.declaredSizeBytes,
    readSizeBytes: record.readSizeBytes,
    extractedTextChars: record.extractedTextChars,
    contentAvailable: hasStoredText,
    resendAvailable: true,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(includeContent
      ? {
        content: hasStoredText ? content : null,
      }
      : {
        snippet: hasStoredText ? content.slice(0, Math.min(400, content.length)) : null,
        contentIncluded: false,
      }),
    guidance: hasStoredText
      ? 'Use `discord_files` action read_attachment for paged stored text or send_attachment to resend the original attachment.'
      : getAttachmentContentUnavailableGuidance(record),
    ...(record.errorText ? { errorText: record.errorText } : {}),
  };
}

type MessageAttachmentLike = {
  url?: string | null;
  name?: string | null;
};

type MessageAttachmentCollectionLike = {
  values?: () => Iterable<MessageAttachmentLike>;
  first?: () => MessageAttachmentLike | null;
};

type ChannelMessageLike = {
  attachments?: MessageAttachmentCollectionLike;
};

type MessageLookupChannelLike = {
  guildId?: string;
  isDMBased?: () => boolean;
  messages?: {
    fetch: (messageId: string) => Promise<ChannelMessageLike>;
  };
};

function listMessageAttachments(
  attachments: MessageAttachmentCollectionLike | undefined,
): MessageAttachmentLike[] {
  if (attachments?.values) {
    return Array.from(attachments.values());
  }

  const firstAttachment = attachments?.first?.() ?? null;
  return firstAttachment ? [firstAttachment] : [];
}

function normalizeAttachmentName(name: string | null | undefined): string {
  return typeof name === 'string' ? name.trim() : '';
}

function getAttachmentUrl(attachment: MessageAttachmentLike | undefined): string | null {
  return typeof attachment?.url === 'string' ? sanitizeUrl(attachment.url) : null;
}

async function resolveFreshAttachmentUrl(record: IngestedAttachmentRecord): Promise<string> {
  try {
    const channel = (await client.channels.fetch(record.channelId).catch(() => null)) as MessageLookupChannelLike | null;
    if (!channel || channel.isDMBased?.()) {
      return record.sourceUrl;
    }
    if (channel.guildId !== record.guildId) {
      return record.sourceUrl;
    }
    if (!channel.messages?.fetch) {
      return record.sourceUrl;
    }

    const message = await channel.messages.fetch(record.messageId).catch(() => null);
    const attachmentList = listMessageAttachments(message?.attachments);
    const recordSourceUrl = sanitizeUrl(record.sourceUrl);
    const recordFilename = normalizeAttachmentName(record.filename);

    const indexedAttachment = attachmentList[record.attachmentIndex];
    const indexedUrl = getAttachmentUrl(indexedAttachment);
    if (
      indexedUrl &&
      ((recordSourceUrl && indexedUrl === recordSourceUrl) ||
        (recordFilename && normalizeAttachmentName(indexedAttachment?.name) === recordFilename))
    ) {
      return indexedUrl;
    }

    if (recordSourceUrl) {
      const sourceMatch = attachmentList.find((attachment) => getAttachmentUrl(attachment) === recordSourceUrl);
      const sourceMatchUrl = getAttachmentUrl(sourceMatch);
      if (sourceMatchUrl) {
        return sourceMatchUrl;
      }
    }

    if (recordFilename) {
      const filenameMatches = attachmentList.filter(
        (attachment) => normalizeAttachmentName(attachment.name) === recordFilename,
      );
      if (filenameMatches.length === 1) {
        const filenameMatchUrl = getAttachmentUrl(filenameMatches[0]);
        if (filenameMatchUrl) {
          return filenameMatchUrl;
        }
      }
    }

    return record.sourceUrl;
  } catch (error) {
    logger.debug(
      { error, attachmentId: record.id, messageId: record.messageId },
      'Falling back to stored attachment source URL',
    );
    return record.sourceUrl;
  }
}

export async function lookupChannelFileCache(params: {
  guildId: string | null | undefined;
  channelId: string;
  messageId?: string;
  filename?: string;
  query?: string;
  limit?: number;
  includeContent?: boolean;
}): Promise<Record<string, unknown>> {
  const limit = toInt(params.limit, 3, 1, 10);
  const includeContent = params.includeContent !== false;

  const records = await findIngestedAttachmentsForLookup({
    guildId: params.guildId ?? null,
    channelId: params.channelId,
    messageId: params.messageId?.trim() || undefined,
    filename: params.filename?.trim() || undefined,
    query: params.query?.trim() || undefined,
    limit,
  });

  const items = records.map((record) =>
    formatAttachmentLookupItem({
      record,
      includeContent,
    }),
  );

  return {
    guildId: params.guildId ?? null,
    channelId: params.channelId,
    count: items.length,
    query: params.query ?? null,
    messageId: params.messageId ?? null,
    filename: params.filename ?? null,
    includeContent,
    items,
    guidance:
      items.length > 0
      ? 'Use attachmentId with `discord_files` action read_attachment for paged stored text or send_attachment to resend the original attachment.'
        : 'No cached attachments matched this query in the current channel.',
  };
}

const CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY: ChannelPermissionRequirement[] = [
  { flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' },
  { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' },
];

export async function lookupServerFileCache(params: {
  guildId: string | null | undefined;
  requesterUserId: string;
  messageId?: string;
  filename?: string;
  query?: string;
  limit?: number;
  includeContent?: boolean;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      content: 'Server file lookup is unavailable in DM context.',
      items: [],
      scope: 'guild_cached_files',
    };
  }

  const limit = toInt(params.limit, 3, 1, 10);
  const includeContent = params.includeContent !== false;

  const records = await findIngestedAttachmentsForLookupInGuild({
    guildId: params.guildId,
    messageId: params.messageId?.trim() || undefined,
    filename: params.filename?.trim() || undefined,
    query: params.query?.trim() || undefined,
    limit: Math.min(50, Math.max(20, limit * 10)),
  });

  const allowedChannelIds = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: records.map((record) => record.channelId),
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  }).catch((error) => {
    logger.warn({ error, guildId: params.guildId }, 'Guild channel access checks failed (non-fatal)');
    return new Set<string>();
  });

  const accessible = records.filter((record) => allowedChannelIds.has(record.channelId)).slice(0, limit);

  const items = accessible.map((record) =>
    formatAttachmentLookupItem({
      record,
      includeContent,
    }),
  );

  return {
    found: items.length > 0,
    guildId: params.guildId,
    count: items.length,
    query: params.query ?? null,
    messageId: params.messageId ?? null,
    filename: params.filename ?? null,
    includeContent,
    items,
    scope: 'guild_cached_files',
    guidance:
      items.length > 0
      ? 'Results are filtered to channels you can access. Use attachmentId with `discord_files` action read_attachment for paged stored text or send_attachment to resend the original attachment.'
        : 'No accessible cached attachments matched this query in the current server.',
  };
}

export async function readIngestedAttachmentText(params: {
  guildId: string | null | undefined;
  requesterUserId: string;
  attachmentId: string;
  startChar?: number;
  maxChars?: number;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      attachmentId: params.attachmentId,
      content: 'Attachment content lookup is unavailable in DM context.',
      scope: 'guild_cached_files',
    };
  }

  const attachmentId = params.attachmentId.trim();
  if (!attachmentId) {
    throw new Error('attachmentId must not be empty');
  }

  const maxChars = toInt(params.maxChars, 8_000, 200, 20_000);
  const startChar = toInt(params.startChar, 0, 0, 50_000_000);

  const record = (await listIngestedAttachmentsByIds([attachmentId]))[0] ?? null;
  if (!record) {
    return {
      found: false,
      attachmentId,
      content: 'Attachment not found in cached file store.',
      scope: 'guild_cached_files',
    };
  }

  if (record.guildId !== params.guildId) {
    return {
      found: false,
      attachmentId,
      content: 'Attachment was found but does not belong to the current server context.',
      scope: 'guild_cached_files',
    };
  }

  const allowedChannelIds = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: [record.channelId],
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  }).catch((error) => {
    logger.warn({ error, guildId: params.guildId, attachmentId }, 'Attachment access checks failed (non-fatal)');
    return new Set<string>();
  });

  if (!allowedChannelIds.has(record.channelId)) {
    return {
      found: false,
      attachmentId,
      content: 'Permission denied: you and the bot must have ViewChannel + ReadMessageHistory access to that channel to read this attachment.',
      scope: 'guild_cached_files',
    };
  }

  const page = buildStoredAttachmentPage({
    record,
    startChar,
    maxChars,
  });

  return {
    found: true,
    attachmentId: record.id,
    attachmentRef: `attachment:${record.id}`,
    attachmentType: inferAttachmentType(record),
    guildId: record.guildId,
    channelId: record.channelId,
    messageId: record.messageId,
    filename: record.filename,
    contentType: record.contentType,
    status: record.status,
    extractor: record.extractor,
    extractedTextChars: record.extractedTextChars,
    resendAvailable: true,
    readable: page.readable,
    startChar: page.startChar,
    maxChars: page.maxChars,
    returnedChars: page.returnedChars,
    totalChars: page.totalChars,
    hasMore: page.hasMore,
    nextStartChar: page.nextStartChar,
    content: page.content,
    guidance: page.guidance,
    ...(record.errorText ? { errorText: record.errorText } : {}),
  };
}

export async function sendCachedAttachment(params: {
  guildId: string | null | undefined;
  requesterUserId: string;
  requesterChannelId: string;
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  attachmentId: string;
  channelId?: string;
  content?: string;
  reason?: string;
  startChar?: number;
  maxChars?: number;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      attachmentId: params.attachmentId,
      content: 'Attachment resend is unavailable in DM context.',
      scope: 'guild_cached_files',
    };
  }

  const attachmentId = params.attachmentId.trim();
  if (!attachmentId) {
    throw new Error('attachmentId must not be empty');
  }

  const record = (await listIngestedAttachmentsByIds([attachmentId]))[0] ?? null;
  if (!record) {
    return {
      found: false,
      attachmentId,
      content: 'Attachment not found in cached file store.',
      scope: 'guild_cached_files',
    };
  }

  if (record.guildId !== params.guildId) {
    return {
      found: false,
      attachmentId,
      content: 'Attachment was found but does not belong to the current server context.',
      scope: 'guild_cached_files',
    };
  }

  const allowedSourceChannelIds = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: [record.channelId],
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  }).catch((error) => {
    logger.warn({ error, guildId: params.guildId, attachmentId }, 'Attachment source access checks failed (non-fatal)');
    return new Set<string>();
  });

  if (!allowedSourceChannelIds.has(record.channelId)) {
    return {
      found: false,
      attachmentId,
      content: 'Permission denied: you and the bot must have ViewChannel + ReadMessageHistory access to the source channel to resend this attachment.',
      scope: 'guild_cached_files',
    };
  }

  const targetChannelId = params.channelId?.trim() || params.requesterChannelId;
  const resolvedUrl = await resolveFreshAttachmentUrl(record);
  if (!resolvedUrl.trim()) {
    return {
      found: false,
      attachmentId,
      content: 'The cached attachment is missing a usable source URL, so it cannot be resent.',
      scope: 'guild_cached_files',
    };
  }
  const sendResult = await requestDiscordInteractionForTool({
    guildId: params.guildId,
    channelId: params.requesterChannelId,
    requestedBy: params.requesterUserId,
    invokedBy: params.invokedBy,
    request: {
      action: 'send_message',
      channelId: targetChannelId,
      content: params.content?.trim() || undefined,
      reason: params.reason?.trim() || undefined,
      files: [
        {
          filename: record.filename,
          contentType: record.contentType ?? undefined,
          source: {
            type: 'url',
            url: resolvedUrl,
          },
        },
      ],
    },
  });

  const page = buildStoredAttachmentPage({
    record,
    startChar: toInt(params.startChar, 0, 0, 50_000_000),
    maxChars: toInt(params.maxChars, 4_000, 200, 20_000),
  });

  return {
    found: true,
    attachmentId: record.id,
    attachmentRef: `attachment:${record.id}`,
    attachmentType: inferAttachmentType(record),
    sourceChannelId: record.channelId,
    targetChannelId,
    messageId: record.messageId,
    filename: record.filename,
    contentType: record.contentType,
    status: record.status,
    extractor: record.extractor,
    resendAvailable: true,
    sendResult,
    storedContentReadable: page.readable,
    storedContent: page.content,
    storedContentStartChar: page.startChar,
    storedContentReturnedChars: page.returnedChars,
    storedContentTotalChars: page.totalChars,
    storedContentHasMore: page.hasMore,
    storedContentNextStartChar: page.nextStartChar,
    storedContentGuidance: page.guidance,
    ...(record.errorText ? { errorText: record.errorText } : {}),
  };
}

function normalizeRepositoryUrl(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  let normalized = raw;
  normalized = normalized.replace(/^git\+/i, '');

  if (/^github:/i.test(normalized)) {
    normalized = normalized.replace(/^github:/i, 'https://github.com/');
  }

  if (/^git@github\.com:/i.test(normalized)) {
    normalized = normalized.replace(/^git@github\.com:/i, 'https://github.com/');
  }

  if (/^ssh:\/\/git@github\.com\//i.test(normalized)) {
    normalized = normalized.replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/');
  }

  if (/^git:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^git:\/\//i, 'https://');
  }

  normalized = normalized.replace(/\.git$/i, '');
  const sanitized = sanitizeUrl(normalized);
  if (!sanitized) return null;
  return sanitized.replace(/\/$/, '');
}

function extractGitHubRepoFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.trim().toLowerCase();
    if (hostname !== 'github.com' && hostname !== 'www.github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0]?.trim();
    const repo = parts[1]?.trim().replace(/\.git$/i, '');
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

export async function lookupNpmPackage(params: {
  packageName: string;
  version?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SCRAPE_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SCRAPE_TIMEOUT_MS, 5_000, 180_000);
  const payload = await fetchJson(
    `https://registry.npmjs.org/${encodeURIComponent(params.packageName)}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    timeoutMs,
    params.signal,
  );

  const distTags = payload['dist-tags'] && typeof payload['dist-tags'] === 'object' && !Array.isArray(payload['dist-tags'])
    ? (payload['dist-tags'] as Record<string, unknown>)
    : {};
  const versions = payload.versions && typeof payload.versions === 'object' && !Array.isArray(payload.versions)
    ? (payload.versions as Record<string, unknown>)
    : {};
  const chosenVersion = params.version?.trim() || (typeof distTags.latest === 'string' ? distTags.latest : '');
  if (!chosenVersion || !versions[chosenVersion] || typeof versions[chosenVersion] !== 'object') {
    throw new Error(`Version "${chosenVersion || 'latest'}" was not found for ${params.packageName}`);
  }

  const versionData = versions[chosenVersion] as Record<string, unknown>;
  const deps = versionData.dependencies && typeof versionData.dependencies === 'object' && !Array.isArray(versionData.dependencies)
    ? (versionData.dependencies as Record<string, unknown>)
    : {};
  const repo = versionData.repository && typeof versionData.repository === 'object' && !Array.isArray(versionData.repository)
    ? (versionData.repository as Record<string, unknown>)
    : null;
  const maintainers = Array.isArray(payload.maintainers)
    ? payload.maintainers
      .map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? pickString(entry as Record<string, unknown>, 'name') : null))
      .filter((name): name is string => typeof name === 'string')
    : [];
  const time = payload.time && typeof payload.time === 'object' && !Array.isArray(payload.time)
    ? (payload.time as Record<string, unknown>)
    : {};
  const repositoryUrl = repo ? pickString(repo, 'url') : null;
  const repositoryUrlNormalized = normalizeRepositoryUrl(repositoryUrl);
  const githubRepo = repositoryUrlNormalized ? extractGitHubRepoFromUrl(repositoryUrlNormalized) : null;

  return {
    packageName: params.packageName,
    version: chosenVersion,
    latestVersion: typeof distTags.latest === 'string' ? distTags.latest : null,
    description: pickString(versionData, 'description') ?? '',
    license: pickString(versionData, 'license') ?? null,
    homepage: pickString(versionData, 'homepage') ?? null,
    repositoryUrl,
    repositoryUrlNormalized,
    githubRepo,
    unpackedSize: versionData.dist && typeof versionData.dist === 'object' && !Array.isArray(versionData.dist)
      ? ((versionData.dist as Record<string, unknown>).unpackedSize as number | undefined) ?? null
      : null,
    dependencyCount: Object.keys(deps).length,
    dependencies: Object.keys(deps).slice(0, 60),
    maintainers: maintainers.slice(0, 10),
    publishedAt: typeof time[chosenVersion] === 'string' ? (time[chosenVersion] as string) : null,
  };
}

function normalizeWikipediaLanguage(lang: string | undefined): string {
  const raw = (lang ?? 'en').trim().toLowerCase();
  return /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/.test(raw) ? raw : 'en';
}

async function fetchWikipediaPages(params: {
  language: string;
  query: string;
  maxResults: number;
  timeoutMs: number;
}): Promise<Record<string, unknown>[]> {
  const endpoint = new URL(`https://${params.language}.wikipedia.org/w/rest.php/v1/search/page`);
  endpoint.searchParams.set('q', params.query);
  endpoint.searchParams.set('limit', String(params.maxResults));
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'SageAgent/1.0 (Wikipedia lookup)',
  };

  try {
    const payload = await fetchJson(
      endpoint.toString(),
      { method: 'GET', headers },
      params.timeoutMs,
    );
    return toRecordList(payload.pages).slice(0, params.maxResults);
  } catch (error) {
    if (error instanceof ToolDetailedError && error.details.httpStatus === 429) {
      throw new ToolDetailedError(
        'Wikipedia rate limited (HTTP 429). Retry later or use web action search.',
        { ...error.details, category: 'rate_limited', httpStatus: 429, provider: error.details.provider ?? 'wikipedia' },
        { cause: error },
      );
    }

    const restError = error instanceof Error ? error : new Error(String(error));
    if (restError.message.includes('HTTP 429')) {
      throw new ToolDetailedError(
        'Wikipedia rate limited (HTTP 429). Retry later or use web action search.',
        { category: 'rate_limited', httpStatus: 429, provider: 'wikipedia' },
        { cause: error },
      );
    }

    throw restError;
  }
}

export async function lookupWikipedia(params: {
  query: string;
  language?: string;
  maxResults?: number;
}): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SEARCH_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SEARCH_TIMEOUT_MS, 5_000, 180_000);
  const maxResults = toInt(params.maxResults, 5, 1, 10);
  const language = normalizeWikipediaLanguage(params.language);
  const results = (await fetchWikipediaPages({ language, query: params.query, maxResults, timeoutMs }))
    .slice(0, maxResults)
    .map((page) => {
      const title = pickString(page, 'title') ?? '';
      if (!title.trim()) return null;
      const key = pickString(page, 'key') ?? title.replace(/\s+/g, '_');
      const url = sanitizeUrl(`https://${language}.wikipedia.org/wiki/${encodeURIComponent(key)}`);
      if (!url) return null;
      const excerptRaw = pickString(page, 'excerpt') ?? pickString(page, 'description') ?? '';
      const excerpt = decodeHtmlEntities(stripHtml(excerptRaw)).trim();
      const entry: { title: string; url: string; snippet?: string } = excerpt ? { title, url, snippet: excerpt } : { title, url };
      return entry;
    })
    .filter((entry): entry is { title: string; url: string; snippet?: string } => entry !== null);

  if (results.length === 0) throw new Error(`Wikipedia returned no results for "${params.query}"`);

  return {
    query: params.query,
    language,
    checkedOn: new Date().toISOString().slice(0, 10),
    answer: summarizeLabeledList(results.map((entry) => ({ title: entry.title, detail: entry.snippet })), 'No concise answer returned.'),
    sourceUrls: results.map((entry) => entry.url),
    results,
  };
}

function unixSecondsToIso(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

export async function searchStackOverflow(params: {
  query: string;
  maxResults?: number;
  tagged?: string;
  includeAcceptedAnswer?: boolean;
}): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SEARCH_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SEARCH_TIMEOUT_MS, 5_000, 180_000);
  const maxResults = toInt(params.maxResults, 5, 1, 15);
  const includeAcceptedAnswer = params.includeAcceptedAnswer === true;
  const endpoint = new URL('https://api.stackexchange.com/2.3/search/advanced');
  endpoint.searchParams.set('order', 'desc');
  endpoint.searchParams.set('sort', 'relevance');
  endpoint.searchParams.set('site', 'stackoverflow');
  endpoint.searchParams.set('q', params.query);
  endpoint.searchParams.set('pagesize', String(maxResults));
  endpoint.searchParams.set('filter', 'default');
  if (params.tagged?.trim()) endpoint.searchParams.set('tagged', params.tagged.trim());

  const payload = await fetchJson(endpoint.toString(), { method: 'GET', headers: { Accept: 'application/json' } }, timeoutMs);
  const results = toRecordList(payload.items)
    .slice(0, maxResults)
    .map((item) => {
      const title = decodeHtmlEntities(stripHtml(pickString(item, 'title') ?? '')).trim();
      const url = sanitizeUrl(pickString(item, 'link') ?? '');
      const acceptedAnswerId = pickNumber(item, 'accepted_answer_id');
      if (!title || !url) return null;
      return {
        title,
        url,
        score: pickNumber(item, 'score'),
        answerCount: pickNumber(item, 'answer_count'),
        accepted: acceptedAnswerId !== null,
        acceptedAnswerId,
        isAnswered: item.is_answered === true,
        tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8) : [],
        creationDate: unixSecondsToIso(pickNumber(item, 'creation_date')),
        lastActivityDate: unixSecondsToIso(pickNumber(item, 'last_activity_date')),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        title: string;
        url: string;
        score: number | null;
        answerCount: number | null;
        accepted: boolean;
        acceptedAnswerId: number | null;
        isAnswered: boolean;
        tags: string[];
        creationDate: string | null;
        lastActivityDate: string | null;
      } => entry !== null,
    );

  if (results.length === 0) throw new Error(`Stack Overflow returned no results for "${params.query}"`);

  let acceptedAnswer: Record<string, unknown> | null = null;
  let acceptedAnswerError: string | null = null;

  if (includeAcceptedAnswer) {
    const acceptedCandidate = results.find((entry) => typeof entry.acceptedAnswerId === 'number' && Number.isFinite(entry.acceptedAnswerId));
    if (acceptedCandidate && typeof acceptedCandidate.acceptedAnswerId === 'number') {
      try {
        const answerEndpoint = new URL(`https://api.stackexchange.com/2.3/answers/${acceptedCandidate.acceptedAnswerId}`);
        answerEndpoint.searchParams.set('order', 'desc');
        answerEndpoint.searchParams.set('sort', 'activity');
        answerEndpoint.searchParams.set('site', 'stackoverflow');
        answerEndpoint.searchParams.set('filter', 'withbody');

        const answerPayload = await fetchJson(
          answerEndpoint.toString(),
          { method: 'GET', headers: { Accept: 'application/json' } },
          timeoutMs,
        );
        const answerItem = toRecordList(answerPayload.items)[0];
        if (answerItem) {
          const bodyHtml = pickString(answerItem, 'body') ?? '';
          const markdown = decodeHtmlEntities(
            bodyHtml
              .replace(/<pre[^>]*>\s*<code[^>]*>/gi, '\n\n```\n')
              .replace(/<\/code>\s*<\/pre>/gi, '\n```\n\n')
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/p\s*>/gi, '\n\n')
              .replace(/<p[^>]*>/gi, '')
              .replace(/<li[^>]*>/gi, '- ')
              .replace(/<\/li\s*>/gi, '\n')
              .replace(/<\/ul\s*>/gi, '\n')
              .replace(/<\/ol\s*>/gi, '\n')
              .replace(/<[^>]+>/g, ''),
          )
            .replace(/\r/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          acceptedAnswer = {
            answerId: acceptedCandidate.acceptedAnswerId,
            url: sanitizeUrl(pickString(answerItem, 'link') ?? ''),
            score: pickNumber(answerItem, 'score'),
            creationDate: unixSecondsToIso(pickNumber(answerItem, 'creation_date')),
            lastActivityDate: unixSecondsToIso(pickNumber(answerItem, 'last_activity_date')),
            body: markdown,
          };
        }
      } catch (error) {
        acceptedAnswerError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  const response: Record<string, unknown> = {
    query: params.query,
    tagged: params.tagged?.trim() || null,
    checkedOn: new Date().toISOString().slice(0, 10),
    provider: 'stack_overflow',
    answer: summarizeLabeledList(results.map((entry) => ({ title: entry.title, detail: `score=${entry.score ?? 0}, answers=${entry.answerCount ?? 0}` })), 'No concise answer returned.'),
    sourceUrls: results.map((entry) => entry.url),
    results,
  };

  if (includeAcceptedAnswer) {
    response.acceptedAnswer = acceptedAnswer;
    response.acceptedAnswerError = acceptedAnswerError;
  }

  return response;
}



function formatRelativeAge(updatedAt: Date, nowMs = Date.now()): string {
  const deltaMs = Math.max(0, nowMs - updatedAt.getTime());
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function normalizeToolText(value: string): string {
  return value.trim();
}

function formatWindow(windowStart: Date, windowEnd: Date): string {
  return `${windowStart.toISOString()} -> ${windowEnd.toISOString()}`;
}

function joinList(values: string[] | undefined, maxItems: number): string | null {
  if (!values || values.length === 0) return null;
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, maxItems)
    .join(', ');
}

function formatSummaryBlock(params: {
  label: string;
  summary: ChannelSummary;
  maxItemsPerList: number;
}): string[] {
  const { label, summary, maxItemsPerList } = params;
  const lines: string[] = [
    `${label} (window ${formatWindow(summary.windowStart, summary.windowEnd)}, updated ${formatRelativeAge(summary.updatedAt ?? summary.windowEnd)} ago):`,
    `- Summary: ${summary.summaryText.trim() || '(no summary text)'}`,
  ];
  const listFields: Array<{ key: string; values?: string[] }> = [
    { key: 'Topics', values: summary.topics },
    { key: 'Threads', values: summary.threads },
    { key: 'Decisions', values: summary.decisions },
    { key: 'Action Items', values: summary.actionItems },
    { key: 'Unresolved', values: summary.unresolved },
  ];
  for (const field of listFields) {
    const rendered = joinList(field.values, maxItemsPerList);
    if (!rendered) continue;
    lines.push(`- ${field.key}: ${rendered}`);
  }
  if (summary.sentiment?.trim()) {
    lines.push(`- Sentiment: ${summary.sentiment.trim()}`);
  }
  return lines;
}

function getArchiveWeekLabel(kind: string): string {
  return kind.startsWith('archive:') ? kind.slice('archive:'.length) : kind;
}

function lexicalArchiveScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const content = text.toLowerCase();
  if (!q) return 0;
  if (content.includes(q)) return 1;
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const matches = terms.filter((term) => content.includes(term)).length;
  return matches / terms.length;
}

function parseOptionalIsoDate(value: string | undefined, fieldName: string): Date | undefined {
  if (!value || !value.trim()) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO timestamp`);
  }
  return parsed;
}

function messageTimestampMs(value: string): number {
  const parsed = new Date(value);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function rrfFuseMessageSearchResults(params: {
  semantic: ChannelMessageSearchResult[];
  lexical: ChannelMessageSearchResult[];
  limit: number;
  k?: number;
}): ChannelMessageSearchResult[] {
  const k = params.k ?? 60;
  const byId = new Map<
    string,
    {
      item: ChannelMessageSearchResult;
      score: number;
      semanticScore?: number;
      lexicalScore?: number;
    }
  >();

  const merge = (rows: ChannelMessageSearchResult[], source: 'semantic' | 'lexical') => {
    rows.forEach((row, index) => {
      const rank = index + 1;
      const contribution = 1 / (k + rank);
      const existing = byId.get(row.messageId);
      if (!existing) {
        byId.set(row.messageId, {
          item: row,
          score: contribution,
          semanticScore: source === 'semantic' ? row.score : undefined,
          lexicalScore: source === 'lexical' ? row.score : undefined,
        });
        return;
      }
      existing.score += contribution;
      if (source === 'semantic') {
        existing.semanticScore = row.score;
      } else {
        existing.lexicalScore = row.score;
      }
      if (messageTimestampMs(row.timestamp) > messageTimestampMs(existing.item.timestamp)) {
        existing.item = row;
      }
    });
  };

  merge(params.semantic, 'semantic');
  merge(params.lexical, 'lexical');

  return Array.from(byId.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return messageTimestampMs(b.item.timestamp) - messageTimestampMs(a.item.timestamp);
    })
    .slice(0, params.limit)
    .map((entry) => ({
      ...entry.item,
      score: Number(entry.score.toFixed(6)),
    }));
}

export async function searchChannelMessages(params: {
  guildId: string | null;
  channelId: string;
  requesterUserId?: string;
  query: string;
  topK?: number;
  mode?: 'hybrid' | 'semantic' | 'lexical' | 'regex';
  regexPattern?: string;
  sinceIso?: string;
  untilIso?: string;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      query: params.query,
      content: 'Channel message history search is unavailable in DM context.',
      items: [],
      scope: 'raw_channel_messages',
    };
  }
  if (!config.MESSAGE_DB_STORAGE_ENABLED) {
    return {
      found: false,
      query: params.query,
      content:
        'Channel message history search is unavailable because MESSAGE_DB_STORAGE_ENABLED=false.',
      items: [],
      scope: 'raw_channel_messages',
      guidance: 'Enable DB transcript storage, then retry search.',
    };
  }

  if (params.requesterUserId) {
    const allowedChannelIds = await filterChannelIdsByMemberAccess({
      guildId: params.guildId,
      userId: params.requesterUserId,
      channelIds: [params.channelId],
      requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
    }).catch((error) => {
      logger.warn({ error, guildId: params.guildId, channelId: params.channelId }, 'Channel access checks failed (non-fatal)');
      return new Set<string>();
    });

    if (!allowedChannelIds.has(params.channelId)) {
      return {
        found: false,
        query: params.query,
        channelId: params.channelId,
        content: 'Permission denied: you and the bot must have ViewChannel + ReadMessageHistory access to search that channel.',
        items: [],
        scope: 'raw_channel_messages',
      };
    }
  }

  const query = params.query.trim();
  if (!query) {
    throw new Error('Query must not be empty');
  }

  const topK = toInt(params.topK, 5, 1, 20);
  const mode = params.mode ?? 'hybrid';
  const since = parseOptionalIsoDate(params.sinceIso, 'sinceIso');
  const until = parseOptionalIsoDate(params.untilIso, 'untilIso');
  const retrievalLimit = Math.max(10, topK * 4);
  const historyStats = await getChannelMessageHistoryStats({
    guildId: params.guildId,
    channelId: params.channelId,
  });

  let modeUsed: string;
  const semanticAvailable = await supportsChannelMessageSemanticSearch();
  let rows: ChannelMessageSearchResult[];

  if (mode === 'regex') {
    modeUsed = 'regex';
    const pattern = params.regexPattern?.trim();
    if (!pattern) {
      throw new Error('regexPattern is required when mode="regex"');
    }
    rows = await searchChannelMessagesRegex({
      guildId: params.guildId,
      channelId: params.channelId,
      pattern,
      topK,
      since,
      until,
    });
  } else if (mode === 'lexical') {
    modeUsed = 'lexical';
    rows = await searchChannelMessagesLexical({
      guildId: params.guildId,
      channelId: params.channelId,
      query,
      topK,
      since,
      until,
    });
  } else if (mode === 'semantic') {
    modeUsed = 'semantic';
    if (!semanticAvailable) {
      return {
        found: false,
        query,
        guildId: params.guildId,
        channelId: params.channelId,
        modeRequested: mode,
        modeUsed: 'semantic_unavailable',
        semanticAvailable: false,
        historyStats,
        content: 'Semantic search is unavailable because message embedding vectors are not available.',
        items: [],
        scope: 'raw_channel_messages',
        guidance: 'Use mode=lexical or mode=hybrid while pgvector embeddings are unavailable.',
      };
    }
    rows = await searchChannelMessagesSemantic({
      guildId: params.guildId,
      channelId: params.channelId,
      query,
      topK,
      since,
      until,
    });
  } else {
    const lexicalRows = await searchChannelMessagesLexical({
      guildId: params.guildId,
      channelId: params.channelId,
      query,
      topK: retrievalLimit,
      since,
      until,
    });
    if (!semanticAvailable) {
      rows = lexicalRows.slice(0, topK);
      modeUsed = 'lexical';
    } else {
      modeUsed = 'hybrid';
      const semanticRows = await searchChannelMessagesSemantic({
        guildId: params.guildId,
        channelId: params.channelId,
        query,
        topK: retrievalLimit,
        since,
        until,
      });
      rows = rrfFuseMessageSearchResults({
        semantic: semanticRows,
        lexical: lexicalRows,
        limit: topK,
      });
    }
  }

  if (rows.length === 0) {
    return {
      found: false,
      query,
      guildId: params.guildId,
      channelId: params.channelId,
      modeRequested: mode,
      modeUsed,
      semanticAvailable,
      historyStats,
      content: 'No matching raw channel messages were found for this query.',
      items: [],
      scope: 'raw_channel_messages',
    };
  }

  const items = rows.slice(0, topK).map((row) => {
    return {
      messageId: row.messageId,
      guildId: row.guildId,
      channelId: row.channelId,
      authorId: row.authorId,
      authorDisplayName: row.authorDisplayName,
      authorIsBot: row.authorIsBot,
      timestamp: row.timestamp,
      score: Number.isFinite(row.score) ? Number(row.score.toFixed(6)) : row.score,
      content: row.content,
    };
  });

  return {
    found: true,
    query,
    guildId: params.guildId,
    channelId: params.channelId,
    modeRequested: mode,
    modeUsed,
    semanticAvailable,
    historyStats,
    resultCount: items.length,
    items,
    scope: 'raw_channel_messages',
    guidance:
      'Use `discord_messages` action get_context with messageId to fetch surrounding messages before finalizing a precise answer.',
  };
}

type GuildMessageSearchRow = {
  messageId: string;
  channelId: string;
  authorId: string;
  authorDisplayName: string;
  authorIsBot: boolean;
  timestamp: Date | string;
  content: string;
  score: number;
};

type GuildMessageSearchResult = {
  messageId: string;
  channelId: string;
  authorId: string;
  authorDisplayName: string;
  authorIsBot: boolean;
  timestamp: string;
  content: string;
  score: number;
};

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  return parsed.toISOString();
}

function mapGuildSearchRows(rows: GuildMessageSearchRow[]): GuildMessageSearchResult[] {
  return rows.map((row) => ({
    messageId: row.messageId,
    channelId: row.channelId,
    authorId: row.authorId,
    authorDisplayName: row.authorDisplayName,
    authorIsBot: !!row.authorIsBot,
    timestamp: toIso(row.timestamp),
    content: row.content,
    score: Number.isFinite(row.score) ? Number(row.score) : 0,
  }));
}

async function searchGuildMessagesLexical(params: {
  guildId: string;
  query: string;
  topK: number;
  since?: Date;
  until?: Date;
}): Promise<GuildMessageSearchResult[]> {
  const limit = toInt(params.topK, 10, 1, 200);
  const rows = await prisma.$queryRaw<GuildMessageSearchRow[]>`
    SELECT
      m."messageId",
      m."channelId",
      m."authorId",
      m."authorDisplayName",
      m."authorIsBot",
      m."timestamp",
      m."content",
      ts_rank_cd(
        to_tsvector('simple', m."content"),
        websearch_to_tsquery('simple', ${params.query})
      ) AS "score"
    FROM "ChannelMessage" m
    WHERE m."guildId" = ${params.guildId}
      AND (${params.since ?? null}::timestamp IS NULL OR m."timestamp" >= ${params.since ?? null})
      AND (${params.until ?? null}::timestamp IS NULL OR m."timestamp" <= ${params.until ?? null})
      AND to_tsvector('simple', m."content") @@ websearch_to_tsquery('simple', ${params.query})
    ORDER BY "score" DESC, m."timestamp" DESC
    LIMIT ${limit}
  `;
  return mapGuildSearchRows(rows);
}

async function searchGuildMessagesRegex(params: {
  guildId: string;
  pattern: string;
  topK: number;
  since?: Date;
  until?: Date;
}): Promise<GuildMessageSearchResult[]> {
  const limit = toInt(params.topK, 10, 1, 200);
  const rows = await prisma.$queryRaw<GuildMessageSearchRow[]>`
    SELECT
      m."messageId",
      m."channelId",
      m."authorId",
      m."authorDisplayName",
      m."authorIsBot",
      m."timestamp",
      m."content",
      1.0 AS "score"
    FROM "ChannelMessage" m
    WHERE m."guildId" = ${params.guildId}
      AND (${params.since ?? null}::timestamp IS NULL OR m."timestamp" >= ${params.since ?? null})
      AND (${params.until ?? null}::timestamp IS NULL OR m."timestamp" <= ${params.until ?? null})
      AND m."content" ~* ${params.pattern}
    ORDER BY m."timestamp" DESC
    LIMIT ${limit}
  `;
  return mapGuildSearchRows(rows);
}

async function searchGuildMessagesSemantic(params: {
  guildId: string;
  query: string;
  topK: number;
  since?: Date;
  until?: Date;
}): Promise<GuildMessageSearchResult[]> {
  const semanticAvailable = await supportsChannelMessageSemanticSearch();
  if (!semanticAvailable) {
    return [];
  }

  const limit = toInt(params.topK, 10, 1, 200);
  const queryVector = await embedText(params.query, 'query');
  const vectorString = `[${queryVector.join(',')}]`;
  const rows = await prisma.$queryRaw<GuildMessageSearchRow[]>`
    SELECT
      m."messageId",
      m."channelId",
      m."authorId",
      m."authorDisplayName",
      m."authorIsBot",
      m."timestamp",
      m."content",
      1 - (e."embedding" <=> ${vectorString}::vector) AS "score"
    FROM "ChannelMessageEmbedding" e
    JOIN "ChannelMessage" m ON m."messageId" = e."messageId"
    WHERE e."embedding" IS NOT NULL
      AND e."guildId" = ${params.guildId}
      AND (${params.since ?? null}::timestamp IS NULL OR m."timestamp" >= ${params.since ?? null})
      AND (${params.until ?? null}::timestamp IS NULL OR m."timestamp" <= ${params.until ?? null})
    ORDER BY e."embedding" <=> ${vectorString}::vector
    LIMIT ${limit}
  `;
  return mapGuildSearchRows(rows);
}

function rrfFuseGuildMessageSearchResults(params: {
  semantic: GuildMessageSearchResult[];
  lexical: GuildMessageSearchResult[];
  limit: number;
  k?: number;
}): GuildMessageSearchResult[] {
  const k = params.k ?? 60;
  const byId = new Map<
    string,
    {
      item: GuildMessageSearchResult;
      score: number;
      semanticScore?: number;
      lexicalScore?: number;
    }
  >();

  const merge = (rows: GuildMessageSearchResult[], source: 'semantic' | 'lexical') => {
    rows.forEach((row, index) => {
      const rank = index + 1;
      const contribution = 1 / (k + rank);
      const existing = byId.get(row.messageId);
      if (!existing) {
        byId.set(row.messageId, {
          item: row,
          score: contribution,
          semanticScore: source === 'semantic' ? row.score : undefined,
          lexicalScore: source === 'lexical' ? row.score : undefined,
        });
        return;
      }
      existing.score += contribution;
      if (source === 'semantic') {
        existing.semanticScore = row.score;
      } else {
        existing.lexicalScore = row.score;
      }
      if (messageTimestampMs(row.timestamp) > messageTimestampMs(existing.item.timestamp)) {
        existing.item = row;
      }
    });
  };

  merge(params.semantic, 'semantic');
  merge(params.lexical, 'lexical');

  return Array.from(byId.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return messageTimestampMs(b.item.timestamp) - messageTimestampMs(a.item.timestamp);
    })
    .slice(0, params.limit)
    .map((entry) => ({
      ...entry.item,
      score: Number(entry.score.toFixed(6)),
    }));
}

export async function searchGuildMessages(params: {
  guildId: string | null;
  requesterUserId: string;
  query: string;
  topK?: number;
  mode?: 'hybrid' | 'semantic' | 'lexical' | 'regex';
  regexPattern?: string;
  sinceIso?: string;
  untilIso?: string;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      query: params.query,
      content: 'Guild message search is unavailable in DM context.',
      items: [],
      scope: 'raw_guild_messages',
    };
  }
  if (!config.MESSAGE_DB_STORAGE_ENABLED) {
    return {
      found: false,
      query: params.query,
      content: 'Guild message search is unavailable because MESSAGE_DB_STORAGE_ENABLED=false.',
      items: [],
      scope: 'raw_guild_messages',
      guidance: 'Enable DB transcript storage, then retry search.',
    };
  }

  const query = params.query.trim();
  if (!query) {
    throw new Error('Query must not be empty');
  }

  const topK = toInt(params.topK, 5, 1, 20);
  const mode = params.mode ?? 'hybrid';
  const since = parseOptionalIsoDate(params.sinceIso, 'sinceIso');
  const until = parseOptionalIsoDate(params.untilIso, 'untilIso');
  const retrievalLimit = Math.min(200, Math.max(20, topK * 12));
  const semanticAvailable = await supportsChannelMessageSemanticSearch();

  let modeUsed: string;
  let rows: GuildMessageSearchResult[];

  if (mode === 'regex') {
    modeUsed = 'regex';
    const pattern = params.regexPattern?.trim();
    if (!pattern) {
      throw new Error('regexPattern is required when mode="regex"');
    }
    rows = await searchGuildMessagesRegex({
      guildId: params.guildId,
      pattern,
      topK: retrievalLimit,
      since,
      until,
    });
  } else if (mode === 'lexical') {
    modeUsed = 'lexical';
    rows = await searchGuildMessagesLexical({
      guildId: params.guildId,
      query,
      topK: retrievalLimit,
      since,
      until,
    });
  } else if (mode === 'semantic') {
    modeUsed = 'semantic';
    if (!semanticAvailable) {
      return {
        found: false,
        query,
        guildId: params.guildId,
        modeRequested: mode,
        modeUsed: 'semantic_unavailable',
        semanticAvailable: false,
        content: 'Semantic search is unavailable because message embedding vectors are not available.',
        items: [],
        scope: 'raw_guild_messages',
        guidance: 'Use mode=lexical or mode=hybrid while pgvector embeddings are unavailable.',
      };
    }
    rows = await searchGuildMessagesSemantic({
      guildId: params.guildId,
      query,
      topK: retrievalLimit,
      since,
      until,
    });
  } else {
    const lexicalRows = await searchGuildMessagesLexical({
      guildId: params.guildId,
      query,
      topK: retrievalLimit,
      since,
      until,
    });
    if (!semanticAvailable) {
      modeUsed = 'lexical';
      rows = lexicalRows;
    } else {
      modeUsed = 'hybrid';
      const semanticRows = await searchGuildMessagesSemantic({
        guildId: params.guildId,
        query,
        topK: retrievalLimit,
        since,
        until,
      });
      rows = rrfFuseGuildMessageSearchResults({
        semantic: semanticRows,
        lexical: lexicalRows,
        limit: retrievalLimit,
      });
    }
  }

  if (rows.length === 0) {
    return {
      found: false,
      query,
      guildId: params.guildId,
      modeRequested: mode,
      modeUsed,
      semanticAvailable,
      content: 'No matching raw guild messages were found for this query.',
      items: [],
      scope: 'raw_guild_messages',
    };
  }

  const candidateChannelIds = Array.from(new Set(rows.map((row) => row.channelId)));
  const allowedChannelIds = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: candidateChannelIds,
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  }).catch((error) => {
    logger.warn({ error, guildId: params.guildId }, 'Guild channel access checks failed (non-fatal)');
    return new Set<string>();
  });

  const filtered = rows.filter((row) => allowedChannelIds.has(row.channelId));
  if (filtered.length === 0) {
    return {
      found: false,
      query,
      guildId: params.guildId,
      modeRequested: mode,
      modeUsed,
      semanticAvailable,
      content: 'No accessible channel messages matched this query in the current server.',
      items: [],
      scope: 'raw_guild_messages',
    };
  }

  const items = filtered.slice(0, topK).map((row) => {
    return {
      messageId: row.messageId,
      channelId: row.channelId,
      authorId: row.authorId,
      authorDisplayName: row.authorDisplayName,
      authorIsBot: row.authorIsBot,
      timestamp: row.timestamp,
      score: Number.isFinite(row.score) ? Number(row.score.toFixed(6)) : row.score,
      content: row.content,
    };
  });

  return {
    found: true,
    query,
    guildId: params.guildId,
    modeRequested: mode,
    modeUsed,
    semanticAvailable,
    resultCount: items.length,
    items,
    scope: 'raw_guild_messages',
    guidance:
      'Use `discord_messages` action get_context with channelId + messageId to fetch surrounding messages before quoting precisely.',
  };
}

export async function lookupUserMessageTimeline(params: {
  guildId: string | null;
  requesterUserId: string;
  userId: string;
  limit?: number;
  sinceIso?: string;
  untilIso?: string;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      content: 'User timeline is unavailable in DM context.',
      items: [],
      scope: 'raw_guild_messages',
    };
  }
  if (!config.MESSAGE_DB_STORAGE_ENABLED) {
    return {
      found: false,
      content: 'User timeline is unavailable because MESSAGE_DB_STORAGE_ENABLED=false.',
      items: [],
      scope: 'raw_guild_messages',
    };
  }

  const limit = toInt(params.limit, 12, 1, 50);
  const since = parseOptionalIsoDate(params.sinceIso, 'sinceIso');
  const until = parseOptionalIsoDate(params.untilIso, 'untilIso');

  const rows = await prisma.$queryRaw<GuildMessageSearchRow[]>`
    SELECT
      m."messageId",
      m."channelId",
      m."authorId",
      m."authorDisplayName",
      m."authorIsBot",
      m."timestamp",
      m."content",
      1.0 AS "score"
    FROM "ChannelMessage" m
    WHERE m."guildId" = ${params.guildId}
      AND m."authorId" = ${params.userId}
      AND (${since ?? null}::timestamp IS NULL OR m."timestamp" >= ${since ?? null})
      AND (${until ?? null}::timestamp IS NULL OR m."timestamp" <= ${until ?? null})
    ORDER BY m."timestamp" DESC
    LIMIT ${Math.min(200, limit * 10)}
  `;

  const mapped = mapGuildSearchRows(rows);
  if (mapped.length === 0) {
    return {
      found: false,
      guildId: params.guildId,
      userId: params.userId,
      content: 'No stored messages were found for this user in the current server.',
      items: [],
      scope: 'raw_guild_messages',
    };
  }

  const candidateChannelIds = Array.from(new Set(mapped.map((row) => row.channelId)));
  const allowedChannelIds = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: candidateChannelIds,
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  }).catch((error) => {
    logger.warn({ error, guildId: params.guildId }, 'Guild channel access checks failed (non-fatal)');
    return new Set<string>();
  });

  const filtered = mapped.filter((row) => allowedChannelIds.has(row.channelId)).slice(0, limit);
  if (filtered.length === 0) {
    return {
      found: false,
      guildId: params.guildId,
      userId: params.userId,
      content: 'No accessible stored messages were found for this user in the current server.',
      items: [],
      scope: 'raw_guild_messages',
    };
  }

  const items = filtered.map((row) => {
    return {
      messageId: row.messageId,
      channelId: row.channelId,
      authorId: row.authorId,
      authorDisplayName: row.authorDisplayName,
      authorIsBot: row.authorIsBot,
      timestamp: row.timestamp,
      content: row.content,
    };
  });

  return {
    found: true,
    guildId: params.guildId,
    userId: params.userId,
    limit,
    sinceIso: since ? since.toISOString() : null,
    untilIso: until ? until.toISOString() : null,
    resultCount: items.length,
    items,
    scope: 'raw_guild_messages',
    guidance:
      'Use `discord_messages` action get_context with channelId + messageId for exact surrounding context when needed.',
  };
}

export async function lookupChannelMessage(params: {
  guildId: string | null;
  channelId: string;
  requesterUserId?: string;
  messageId: string;
  before?: number;
  after?: number;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      messageId: params.messageId,
      content: 'Channel message lookup is unavailable in DM context.',
      items: [],
      scope: 'raw_channel_messages',
    };
  }
  if (!config.MESSAGE_DB_STORAGE_ENABLED) {
    return {
      found: false,
      messageId: params.messageId,
      content: 'Channel message lookup is unavailable because MESSAGE_DB_STORAGE_ENABLED=false.',
      items: [],
      scope: 'raw_channel_messages',
    guidance: 'Enable DB transcript storage to use `discord_messages` action get_context.',
    };
  }

  if (params.requesterUserId) {
    const allowedChannelIds = await filterChannelIdsByMemberAccess({
      guildId: params.guildId,
      userId: params.requesterUserId,
      channelIds: [params.channelId],
      requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
    }).catch((error) => {
      logger.warn({ error, guildId: params.guildId, channelId: params.channelId }, 'Channel access checks failed (non-fatal)');
      return new Set<string>();
    });

    if (!allowedChannelIds.has(params.channelId)) {
      return {
        found: false,
        channelId: params.channelId,
        messageId: params.messageId,
        content: 'Permission denied: you and the bot must have ViewChannel + ReadMessageHistory access to lookup that channel.',
        items: [],
        scope: 'raw_channel_messages',
      };
    }
  }

  const messageId = params.messageId.trim();
  if (!messageId) {
    throw new Error('messageId must not be empty');
  }

  const before = toInt(params.before, 3, 0, 20);
  const after = toInt(params.after, 3, 0, 20);
  const rows = await getChannelMessageWindowById({
    guildId: params.guildId,
    channelId: params.channelId,
    messageId,
    before,
    after,
  });

  if (rows.length === 0) {
    return {
      found: false,
      guildId: params.guildId,
      channelId: params.channelId,
      messageId,
      content: 'Message not found in stored channel history for this channel.',
      items: [],
      scope: 'raw_channel_messages',
    };
  }

  const lines = ['Channel message window (raw channel history):'];
  for (const row of rows) {
    const marker = row.messageId === messageId ? '*' : '-';
    const normalizedContent = row.content.replace(/\s+/g, ' ').trim();
    lines.push(
      `${marker} [${row.timestamp}] @${row.authorDisplayName} (id:${row.authorId}, bot=${row.authorIsBot}, guild:${row.guildId ?? '@me'} ch:${row.channelId} msg:${row.messageId}): ${normalizedContent}`,
    );
  }

  return {
    found: true,
    guildId: params.guildId,
    channelId: params.channelId,
    messageId,
    before,
    after,
    itemCount: rows.length,
    content: normalizeToolText(lines.join('\n')),
    items: rows,
    scope: 'raw_channel_messages',
  };
}

export async function searchAttachmentChunksInChannel(params: {
  guildId: string | null;
  channelId: string;
  query: string;
  topK?: number;
}): Promise<Record<string, unknown>> {
  const topK = toInt(params.topK, 5, 1, 20);
  const query = params.query.trim();
  if (!query) {
    throw new Error('Query must not be empty');
  }

  const rows = await searchAttachmentChunks(query, topK, {
    guildId: params.guildId,
    channelId: params.channelId,
  });

  if (rows.length === 0) {
    return {
      found: false,
      query,
      channelId: params.channelId,
      content: 'No matching attachment chunks found for this channel.',
      items: [],
    };
  }

  const attachmentIds = Array.from(new Set(rows.map((row) => row.attachmentId)));
  const attachments = await listIngestedAttachmentsByIds(attachmentIds);
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));

  const items = rows.map((row) => {
    const attachment = attachmentById.get(row.attachmentId);
    return {
      chunkId: row.chunkId,
      attachmentId: row.attachmentId,
      attachmentRef: `attachment:${row.attachmentId}`,
      attachmentType: attachment ? inferAttachmentType(attachment) : null,
      channelId: params.channelId,
      messageId: attachment?.messageId ?? null,
      filename: attachment?.filename ?? null,
      score: Number.isFinite(row.score) ? Number(row.score.toFixed(4)) : row.score,
      content: row.content,
    };
  });

  return {
    found: true,
    query,
    channelId: params.channelId,
    resultCount: items.length,
    items,
    guidance: 'Use attachmentId with `discord_files` action read_attachment for paged stored text or send_attachment to resend the original attachment.',
  };
}

export async function searchAttachmentChunksInGuild(params: {
  guildId: string | null;
  requesterUserId: string;
  query: string;
  topK?: number;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      query: params.query,
      content: 'Server file search is unavailable in DM context.',
      items: [],
      scope: 'guild_attachment_chunks',
    };
  }

  const topK = toInt(params.topK, 5, 1, 20);
  const query = params.query.trim();
  if (!query) {
    throw new Error('Query must not be empty');
  }

  const rows = await searchAttachmentChunks(query, Math.min(20, Math.max(5, topK * 4)), {
    guildId: params.guildId,
  });

  if (rows.length === 0) {
    return {
      found: false,
      query,
      content: 'No matching attachment chunks found in the current server.',
      items: [],
      scope: 'guild_attachment_chunks',
    };
  }

  const attachmentIds = Array.from(new Set(rows.map((row) => row.attachmentId)));
  const attachments = await listIngestedAttachmentsByIds(attachmentIds);
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));

  const allowedChannelIds = await filterChannelIdsByMemberAccess({
    guildId: params.guildId,
    userId: params.requesterUserId,
    channelIds: attachments.map((attachment) => attachment.channelId),
    requirements: CHANNEL_ACCESS_REQUIREMENTS_READ_HISTORY,
  }).catch((error) => {
    logger.warn({ error, guildId: params.guildId }, 'Guild channel access checks failed (non-fatal)');
    return new Set<string>();
  });

  const items = rows
    .map((row) => {
      const attachment = attachmentById.get(row.attachmentId);
      if (!attachment) return null;
      if (!allowedChannelIds.has(attachment.channelId)) return null;
      return {
        chunkId: row.chunkId,
        attachmentId: row.attachmentId,
        attachmentRef: `attachment:${row.attachmentId}`,
        attachmentType: inferAttachmentType(attachment),
        channelId: attachment.channelId,
        messageId: attachment.messageId,
        filename: attachment.filename,
        score: Number.isFinite(row.score) ? Number(row.score.toFixed(4)) : row.score,
        content: row.content,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, topK);

  if (items.length === 0) {
    return {
      found: false,
      query,
      content: 'No accessible attachment chunks matched this query in the current server.',
      items: [],
      scope: 'guild_attachment_chunks',
    };
  }

  return {
    found: true,
    query,
    guildId: params.guildId,
    resultCount: items.length,
    items,
    scope: 'guild_attachment_chunks',
    guidance: 'Use attachmentId with `discord_files` action read_attachment for paged stored text or send_attachment to resend the original attachment.',
  };
}

export async function searchChannelArchives(params: {
  guildId: string | null;
  channelId: string;
  query: string;
  topK?: number;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      query: params.query,
      content: 'Channel archive search is unavailable in DM context.',
      items: [],
      scope: 'channel_archive_profiles',
    };
  }

  const query = params.query.trim();
  if (!query) {
    throw new Error('Query must not be empty');
  }

  const topK = toInt(params.topK, 5, 1, 20);
  const summaryStore = getChannelSummaryStore();
  const archives = await summaryStore.listArchiveSummaries({
    guildId: params.guildId,
    channelId: params.channelId,
    limit: Math.max(20, topK * 4),
  });

  if (archives.length === 0) {
    return {
      found: false,
      query,
      content:
        'No archived weekly channel summary snapshots were found for this channel (this tool does not search raw messages).',
      items: [],
      scope: 'channel_archive_profiles',
      guidance:
      'Use `discord_messages` action search_history for raw historical message retrieval when transcript-level evidence is needed.',
    };
  }

  let ranked: Array<{ archive: ChannelSummary; score: number }>;
  try {
    const [queryVector, archiveVectors] = await Promise.all([
      embedText(query, 'query'),
      embedTexts(
        archives.map((archive) => archive.summaryText?.trim() || '(empty archive summary)'),
        'document',
      ),
    ]);

    ranked = archives.map((archive, index) => ({
      archive,
      score: cosineSimilarity(queryVector, archiveVectors[index]),
    }));
  } catch (error) {
    logger.warn({ error }, 'Archive semantic search unavailable, using lexical fallback');
    ranked = archives.map((archive) => ({
      archive,
      score: lexicalArchiveScore(query, archive.summaryText ?? ''),
    }));
  }

  ranked.sort((a, b) => b.score - a.score);
  const items = ranked.slice(0, topK).map(({ archive, score }) => {
    return {
      kind: archive.kind,
      week: getArchiveWeekLabel(archive.kind),
      score: Number.isFinite(score) ? Number(score.toFixed(4)) : score,
      windowStart: archive.windowStart.toISOString(),
      windowEnd: archive.windowEnd.toISOString(),
      content: archive.summaryText,
    };
  });

  return {
    found: true,
    query,
    channelId: params.channelId,
    archiveCount: archives.length,
    resultCount: items.length,
    items,
    scope: 'channel_archive_profiles',
    guidance:
      'Archive results are weekly channel summary snapshots, not raw message transcripts. Use `discord_messages` action search_history for exact historical messages.',
  };
}

export async function lookupUserMemory(params: {
  userId: string;
  maxItemsPerSection?: number;
}): Promise<Record<string, unknown>> {
  const maxItemsPerSection = toInt(params.maxItemsPerSection, 3, 1, 10);
  const profile = await getUserProfileRecord(params.userId);
  const summary = profile?.summary?.trim() ?? '';

  if (!summary) {
    return {
      found: false,
      content:
        'User profile: no stored best-effort personalization profile yet. Use this turn only and ask clarifying questions when needed.',
      updatedAt: null,
    };
  }

  const parsed = parseUserProfileSummary(summary);
  const preferences = parsed?.preferences ?? [];
  const activeFocus = parsed?.activeFocus ?? [];
  const background = parsed?.background ?? [];
  const lines: string[] = ['User profile:'];
  if (preferences.length > 0) lines.push(`- Preferences: ${preferences.slice(0, maxItemsPerSection).join(' | ')}`);
  if (activeFocus.length > 0) lines.push(`- Active focus: ${activeFocus.slice(0, maxItemsPerSection).join(' | ')}`);
  if (background.length > 0) lines.push(`- Background: ${background.slice(0, maxItemsPerSection).join(' | ')}`);
  if (preferences.length === 0 && activeFocus.length === 0 && background.length === 0) {
    lines.push(`- Notes: ${summary.replace(/\s+/g, ' ').slice(0, 500)}`);
  }
  if (profile?.updatedAt) {
    lines.push(`- Freshness: profile updated ${formatRelativeAge(profile.updatedAt)} ago.`);
  }
  lines.push('- Guidance: treat these as soft personalization cues: durable preferences/background plus current-but-fallible active focus. Prioritize explicit user instructions in this turn.');
  return {
    found: true,
    content: normalizeToolText(lines.join('\n')),
    updatedAt: profile?.updatedAt?.toISOString() ?? null,
    preferences,
    activeFocus,
    background,
  };
}

export async function lookupChannelMemory(params: {
  guildId: string | null;
  channelId: string;
  maxItemsPerList?: number;
  maxRecentFiles?: number;
}): Promise<Record<string, unknown>> {
  if (!params.guildId) {
    return {
      found: false,
      content: 'Channel summary is unavailable in DM context.',
      scope: 'channel_summary',
    };
  }

  const maxItemsPerList = toInt(params.maxItemsPerList, 5, 1, 10);
  const maxRecentFiles = toInt(params.maxRecentFiles, 5, 1, 20);
  const summaryStore = getChannelSummaryStore();
  const [rollingSummary, profileSummary, recentAttachments] = await Promise.all([
    summaryStore.getLatestSummary({ guildId: params.guildId, channelId: params.channelId, kind: 'rolling' }),
    summaryStore.getLatestSummary({ guildId: params.guildId, channelId: params.channelId, kind: 'profile' }),
    listRecentIngestedAttachments({ guildId: params.guildId, channelId: params.channelId, limit: maxRecentFiles }),
  ]);

  const parts: string[] = [];
  if (rollingSummary) {
    parts.push(...formatSummaryBlock({ label: 'Short-term summary', summary: rollingSummary, maxItemsPerList }));
  }
  if (profileSummary) {
    if (parts.length > 0) parts.push('');
    parts.push(...formatSummaryBlock({ label: 'Long-term summary', summary: profileSummary, maxItemsPerList }));
  }
  if (recentAttachments.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('Recent cached attachments (read stored text with `discord_files` action read_attachment or resend originals with `discord_files` action send_attachment when needed):');
    for (const attachment of recentAttachments.slice(0, maxRecentFiles)) {
      parts.push(
        `- ${attachment.filename} (attachment:${attachment.id}, guild:${params.guildId ?? '@me'} ch:${params.channelId} msg:${attachment.messageId}, status=${attachment.status}, extractor=${attachment.extractor ?? 'none'}, cached ${formatRelativeAge(attachment.createdAt)} ago)`,
      );
    }
  }

  if (parts.length === 0) {
    return {
      found: false,
      content:
        'Channel summary: no stored rolling or long-term channel summary context is available yet. This tool does not return raw message history.',
      recentAttachmentCount: 0,
      scope: 'channel_summary',
      guidance:
        'Use `discord_messages` action search_history for raw historical transcript retrieval when you need exact message-level evidence.',
    };
  }

  const built = [
    'Channel summary:',
    'Scope: rolling and long-term channel summary context plus recent cached attachment pointers only (not raw message transcripts).',
    ...parts,
  ].join('\n');
  return {
    found: true,
    content: normalizeToolText(built),
    hasRolling: !!rollingSummary,
    hasProfile: !!profileSummary,
    recentAttachmentCount: recentAttachments.length,
    recentAttachments: recentAttachments.slice(0, maxRecentFiles).map((attachment) => ({
      filename: attachment.filename,
      messageId: attachment.messageId,
      status: attachment.status,
      extractor: attachment.extractor,
      createdAt: attachment.createdAt.toISOString(),
    })),
    scope: 'channel_summary',
    guidance:
      'For exact historical messages, use `discord_messages` actions search_history and then get_context.',
  };
}

function normalizeImageBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim();
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (normalized.endsWith('/v1')) normalized = normalized.slice(0, -3);
  return normalized;
}

function getImageExtensionFromContentType(contentType?: string | null): string | null {
  if (!contentType) return null;
  const normalized = contentType.split(';')[0]?.trim().toLowerCase();
  if (!normalized || !normalized.startsWith('image/')) return null;
  switch (normalized) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return null;
  }
}

function buildSafeFilename(prompt: string, seed: number, extension: string): string {
  const safePrompt = prompt.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
  return `sage_${safePrompt}_${seed}.${extension}`;
}

async function safeReadResponseText(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const isTextual = contentType.includes('text') || contentType.includes('json');
  if (!isTextual) return null;
  try {
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return null;
    const maxLength = 500;
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
  } catch {
    return null;
  }
}

export async function generateImage(params: {
  prompt: string;
  model?: string;
  seed?: number;
  width?: number;
  height?: number;
  referenceImageUrl?: string;
  apiKey?: string;
}): Promise<Record<string, unknown>> {
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error('Prompt must not be empty.');
  const seed = Number.isFinite(params.seed) ? Math.max(0, Math.floor(params.seed as number)) : Math.floor(Math.random() * 1_000_000);
  const model = params.model?.trim() || config.IMAGE_PROVIDER_MODEL.trim();
  const imageBaseUrl = normalizeImageBaseUrl(config.IMAGE_PROVIDER_BASE_URL);
  const apiKey = params.apiKey?.trim() || config.IMAGE_PROVIDER_API_KEY || '';
  const encodedPrompt = encodeURIComponent(prompt);
  const requestUrl = new URL(`${imageBaseUrl}/image/${encodedPrompt}`);
  requestUrl.searchParams.set('model', model);
  requestUrl.searchParams.set('nologo', 'true');
  requestUrl.searchParams.set('seed', String(seed));
  if (typeof params.width === 'number') requestUrl.searchParams.set('width', String(Math.max(64, Math.floor(params.width))));
  if (typeof params.height === 'number') requestUrl.searchParams.set('height', String(Math.max(64, Math.floor(params.height))));
  if (params.referenceImageUrl?.trim()) {
    const sanitizedImageUrl = sanitizePublicUrl(params.referenceImageUrl);
    if (!sanitizedImageUrl) {
      throw new Error('referenceImageUrl must be a valid public HTTP(S) URL.');
    }
    requestUrl.searchParams.set('image', sanitizedImageUrl);
  }
  if (apiKey) {
    requestUrl.searchParams.set('key', apiKey);
  }
  const logUrl = new URL(requestUrl.toString());
  if (logUrl.searchParams.has('key')) logUrl.searchParams.set('key', '[redacted]');

  logger.info({ model, seed, imageBaseUrl, promptLength: prompt.length }, 'image_generate: requesting image from configured image provider');
  const response = await fetchWithTimeout(
    requestUrl.toString(),
    { method: 'GET' },
    DEFAULT_IMAGE_GEN_TIMEOUT_MS,
  );
  if (!response.ok) {
    const details = await safeReadResponseText(response);
    throw new Error(`Image generation failed with status ${response.status} ${response.statusText}${details ? `: ${details}` : ''}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('Image generation response was empty.');
  }
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type');
  const extension = getImageExtensionFromContentType(contentType) ?? 'bin';
  const filename = buildSafeFilename(prompt, seed, extension);
  const mimetype = contentType?.split(';')[0]?.trim() || 'application/octet-stream';

  return {
    provider: 'image_provider',
    model,
    seed,
    prompt,
    imageUrl: logUrl.toString(),
    artifacts: [
      {
        kind: 'file',
        data: buffer,
        filename,
        mimetype,
        visibleSummary: `Created image artifact ${filename}.`,
      },
    ],
  };
}

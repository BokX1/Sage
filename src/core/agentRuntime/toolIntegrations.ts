import { config } from '../../config';
import { isPrivateOrLocalHostname } from '../../shared/config/env';
import { createLLMClient } from '../llm';
import { logger } from '../utils/logger';
import { findIngestedAttachmentsForLookup } from '../attachments/ingestedAttachmentRepo';

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 45_000;
const DEFAULT_WEB_SCRAPE_TIMEOUT_MS = 45_000;
const DEFAULT_WEB_SCRAPE_MAX_CHARS = 12_000;
const DEFAULT_WEB_SEARCH_MAX_RESULTS = 6;
const DEFAULT_TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const DEFAULT_EXA_SEARCH_URL = 'https://api.exa.ai/search';
const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v1';
const DEFAULT_JINA_READER_BASE_URL = 'https://r.jina.ai/http://';

export type SearchDepth = 'quick' | 'balanced' | 'deep';
type SearchProviderId = 'tavily' | 'exa' | 'searxng' | 'pollinations';
type ScrapeProviderId = 'firecrawl' | 'crawl4ai' | 'jina' | 'raw_fetch';

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

function toInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

function pickString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function pickNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function toBoundedFloat(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value as number));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'");
}

function extractAnswerSection(content: string): string {
  const match = content.match(/answer:\s*([\s\S]*?)(?:\nsource urls?:|\nchecked on:|$)/i);
  const answer = match?.[1]?.trim();
  return answer && answer.length > 0 ? answer : content.trim();
}

function truncateWithNotice(text: string, maxChars: number): { text: string; truncated: boolean } {
  const max = Math.max(500, Math.floor(maxChars));
  if (text.length <= max) return { text, truncated: false };
  const head = Math.max(250, Math.floor(max * 0.75));
  const tail = Math.max(120, Math.floor(max * 0.2));
  return {
    text: `${text.slice(0, head).trimEnd()}\n\n[... ${Math.max(0, text.length - head - tail).toLocaleString()} chars omitted ...]\n\n${text.slice(-tail).trimStart()}`,
    truncated: true,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 240)}`);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON payload is not an object');
  }
  return parsed as Record<string, unknown>;
}

function parseSearchProviderOrder(
  csv: string | undefined,
  options?: {
    preferredOrder?: SearchProviderId[];
    allowPollinationsFallback?: boolean;
  },
): SearchProviderId[] {
  const allowPollinationsFallback = options?.allowPollinationsFallback !== false;
  const fallback: SearchProviderId[] = allowPollinationsFallback
    ? ['tavily', 'exa', 'searxng', 'pollinations']
    : ['tavily', 'exa', 'searxng'];
  const valid = new Set<SearchProviderId>(
    allowPollinationsFallback
      ? ['tavily', 'exa', 'searxng', 'pollinations']
      : ['tavily', 'exa', 'searxng'],
  );
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
  if (allowPollinationsFallback && !seen.has('pollinations')) {
    deduped.push('pollinations');
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

async function searchWithTavily(query: string, depth: SearchDepth, maxResults: number, timeoutMs: number): Promise<SearchOutcome> {
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
  );
  const results = normalizeSearchResults(toRecordList(payload.results));
  return {
    provider: 'tavily',
    answer: pickString(payload, 'answer')?.trim() || summarizeResults(results),
    sourceUrls: results.map((entry) => entry.url),
    results,
  };
}

async function searchWithExa(query: string, depth: SearchDepth, maxResults: number, timeoutMs: number): Promise<SearchOutcome> {
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

async function searchWithSearxng(query: string, maxResults: number, timeoutMs: number): Promise<SearchOutcome> {
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

  let jsonError: Error | null = null;
  try {
    const payload = await fetchJson(
      buildEndpoint('json').toString(),
      { method: 'GET', headers: { Accept: 'application/json' } },
      timeoutMs,
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
    jsonError = error instanceof Error ? error : new Error(String(error));
    logger.warn({ error: jsonError }, 'searxng json endpoint failed; trying html fallback');
  }

  const htmlEndpoint = buildEndpoint('html');
  const htmlResponse = await fetchWithTimeout(
    htmlEndpoint.toString(),
    { method: 'GET', headers: { Accept: 'text/html' } },
    timeoutMs,
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

async function searchWithPollinations(
  query: string,
  depth: SearchDepth,
  timeoutMs: number,
  maxOutputTokens: number,
  apiKey?: string,
): Promise<SearchOutcome> {
  const today = new Date().toISOString().slice(0, 10);
  const models =
    depth === 'quick'
      ? ['gemini-search', 'perplexity-fast']
      : depth === 'deep'
        ? ['perplexity-reasoning', 'perplexity-fast', 'gemini-search']
        : ['perplexity-fast', 'gemini-search', 'perplexity-reasoning'];
  let lastContent = '';
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const client = createLLMClient('pollinations', { chatModel: model });
      const response = await client.chat({
        model,
        apiKey,
        temperature: 0.2,
        maxTokens: maxOutputTokens,
        timeout: timeoutMs,
        messages: [
          {
            role: 'system',
            content:
              'You are a search tool. Return plain text only with this exact structure:\n' +
              'Answer: <concise factual answer>\n' +
              'Source URLs: <one or more URLs>\n' +
              'Checked on: <YYYY-MM-DD>\n' +
              'Use only sources you can cite with URLs.',
          },
          {
            role: 'user',
            content: `Search query: ${query}\nCurrent date: ${today}`,
          },
        ],
      });

      const content = (response.content ?? '').trim();
      lastContent = content;
      const sourceUrls = uniqueUrls(content);
      if (sourceUrls.length === 0 && model !== models[models.length - 1]) continue;

      return {
        provider: 'pollinations',
        model,
        answer: extractAnswerSection(content),
        sourceUrls,
        results: sourceUrls.map((url) => ({ title: url, url })),
        rawContent: content,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn({ error: lastError, model }, 'web_search pollinations attempt failed; trying next model');
    }
  }

  if (lastContent.trim()) {
    const sourceUrls = uniqueUrls(lastContent);
    return {
      provider: 'pollinations',
      model: models[models.length - 1],
      answer: extractAnswerSection(lastContent),
      sourceUrls,
      results: sourceUrls.map((url) => ({ title: url, url })),
      rawContent: lastContent,
    };
  }

  throw new Error(lastError ? `Pollinations fallback failed: ${lastError.message}` : 'Pollinations fallback failed');
}

export async function runWebSearch(params: {
  query: string;
  depth: SearchDepth;
  maxResults?: number;
  apiKey?: string;
  providerOrder?: SearchProviderId[];
  allowLlmFallback?: boolean;
}): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SEARCH_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SEARCH_TIMEOUT_MS, 5_000, 180_000);
  const maxOutputTokens = toInt((config.AGENTIC_TOOL_MAX_OUTPUT_TOKENS as number | undefined), 1_200, 128, 8_000);
  const configuredMaxResults = toInt((config.TOOL_WEB_SEARCH_MAX_RESULTS as number | undefined), DEFAULT_WEB_SEARCH_MAX_RESULTS, 1, 10);
  const maxResults = toInt(params.maxResults ?? configuredMaxResults, configuredMaxResults, 1, 10);
  const allowLlmFallback = params.allowLlmFallback !== false;
  const providerOrder = parseSearchProviderOrder(
    config.TOOL_WEB_SEARCH_PROVIDER_ORDER as string | undefined,
    {
      preferredOrder: params.providerOrder,
      allowPollinationsFallback: allowLlmFallback,
    },
  );
  const providersTried: string[] = [];
  const errors: string[] = [];

  for (const provider of providerOrder) {
    providersTried.push(provider);
    try {
      const outcome =
        provider === 'tavily'
          ? await searchWithTavily(params.query, params.depth, maxResults, timeoutMs)
          : provider === 'exa'
            ? await searchWithExa(params.query, params.depth, maxResults, timeoutMs)
            : provider === 'searxng'
              ? await searchWithSearxng(params.query, maxResults, timeoutMs)
              : await searchWithPollinations(params.query, params.depth, timeoutMs, maxOutputTokens, params.apiKey);

      return {
        query: params.query,
        depth: params.depth,
        checkedOn: new Date().toISOString().slice(0, 10),
        provider: outcome.provider,
        providersTried,
        sourceUrls: outcome.sourceUrls,
        answer: outcome.answer,
        results: outcome.results.slice(0, maxResults),
        model: outcome.model,
        rawContent: outcome.rawContent,
      };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`web_search failed. Providers attempted: ${providersTried.join(', ')}. ${errors.join(' | ')}`);
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

async function scrapeWithFirecrawl(url: string, maxChars: number, timeoutMs: number): Promise<{ provider: string; title?: string; content: string; truncated: boolean }> {
  const apiKey = (config.FIRECRAWL_API_KEY as string | undefined)?.trim();
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not configured');
  const baseUrl = (config.FIRECRAWL_BASE_URL as string | undefined)?.trim() || DEFAULT_FIRECRAWL_BASE_URL;
  const endpoint = baseUrl.endsWith('/scrape') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/scrape`;
  const payload = await fetchJson(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    },
    timeoutMs,
  );
  const extracted = extractScrapeContent(payload);
  if (!extracted) throw new Error('Firecrawl returned empty content');
  const truncated = truncateWithNotice(extracted.content, maxChars);
  return { provider: 'firecrawl', title: extracted.title, content: truncated.text, truncated: truncated.truncated };
}

async function scrapeWithCrawl4ai(url: string, maxChars: number, timeoutMs: number): Promise<{ provider: string; title?: string; content: string; truncated: boolean }> {
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
  const truncated = truncateWithNotice(extracted.content, maxChars);
  return { provider: 'crawl4ai', title: extracted.title, content: truncated.text, truncated: truncated.truncated };
}

async function scrapeWithJina(url: string, maxChars: number, timeoutMs: number): Promise<{ provider: string; content: string; truncated: boolean }> {
  const readerBase = ((config.JINA_READER_BASE_URL as string | undefined)?.trim() || DEFAULT_JINA_READER_BASE_URL).replace(/\/+$/, '/');
  const readerUrl = `${readerBase}${url.replace(/^https?:\/\//i, '')}`;
  const response = await fetchWithTimeout(readerUrl, { method: 'GET', headers: { Accept: 'text/plain' } }, timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new Error(`Jina reader failed with status ${response.status}`);
  if (!text.trim()) throw new Error('Jina reader returned empty content');
  const truncated = truncateWithNotice(text.trim(), maxChars);
  return { provider: 'jina', content: truncated.text, truncated: truncated.truncated };
}

async function scrapeWithRawFetch(url: string, maxChars: number, timeoutMs: number): Promise<{ provider: string; content: string; truncated: boolean }> {
  const response = await fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'SageAgent/1.0 (+https://github.com)' } }, timeoutMs);
  const body = await response.text();
  if (!response.ok) throw new Error(`Raw fetch failed with status ${response.status}`);
  const stripped = stripHtml(body);
  if (!stripped.trim()) throw new Error('Raw fetch extracted no readable content');
  const truncated = truncateWithNotice(stripped, maxChars);
  return { provider: 'raw_fetch', content: truncated.text, truncated: truncated.truncated };
}

export async function scrapeWebPage(params: {
  url: string;
  maxChars?: number;
  providerOrder?: ScrapeProviderId[];
}): Promise<Record<string, unknown>> {
  const sanitizedUrl = sanitizePublicUrl(params.url);
  if (!sanitizedUrl) {
    throw new Error('URL must be a public HTTP(S) URL.');
  }
  const timeoutMs = toInt((config.TOOL_WEB_SCRAPE_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SCRAPE_TIMEOUT_MS, 5_000, 180_000);
  const configuredMaxChars = toInt((config.TOOL_WEB_SCRAPE_MAX_CHARS as number | undefined), DEFAULT_WEB_SCRAPE_MAX_CHARS, 500, 50_000);
  const maxChars = toInt(params.maxChars ?? configuredMaxChars, configuredMaxChars, 500, 50_000);
  const source = (config.TOOL_WEB_SCRAPE_PROVIDER_ORDER as string | undefined)?.trim() || 'firecrawl,crawl4ai,jina,raw_fetch';
  const configuredProviderOrder = source
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ScrapeProviderId => ['firecrawl', 'crawl4ai', 'jina', 'raw_fetch'].includes(value));
  const fallbackOrder: ScrapeProviderId[] = ['firecrawl', 'crawl4ai', 'jina', 'raw_fetch'];
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
  for (const provider of finalOrder) {
    try {
      const outcome =
        provider === 'firecrawl'
          ? await scrapeWithFirecrawl(sanitizedUrl, maxChars, timeoutMs)
          : provider === 'crawl4ai'
            ? await scrapeWithCrawl4ai(sanitizedUrl, maxChars, timeoutMs)
            : provider === 'jina'
              ? await scrapeWithJina(sanitizedUrl, maxChars, timeoutMs)
              : await scrapeWithRawFetch(sanitizedUrl, maxChars, timeoutMs);
      return {
        url: sanitizedUrl,
        provider: outcome.provider,
        title: 'title' in outcome ? outcome.title : undefined,
        content: outcome.content,
        truncated: outcome.truncated,
      };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`web_scrape failed: ${errors.join(' | ')}`);
}

function buildGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SageAgent/1.0',
  };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

export async function lookupGitHubRepo(params: { repo: string; includeReadme?: boolean }): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SCRAPE_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SCRAPE_TIMEOUT_MS, 5_000, 180_000);
  const token = (config.GITHUB_TOKEN as string | undefined)?.trim();
  const headers = buildGitHubHeaders(token);
  const repoUrl = `https://api.github.com/repos/${params.repo}`;
  const payload = await fetchJson(repoUrl, { method: 'GET', headers }, timeoutMs);

  const fullName = pickString(payload, 'full_name') ?? params.repo;
  const description = pickString(payload, 'description') ?? '';
  const homepage = pickString(payload, 'homepage') ?? null;
  const htmlUrl = pickString(payload, 'html_url') ?? `https://github.com/${params.repo}`;
  const language = pickString(payload, 'language') ?? null;
  const defaultBranch = pickString(payload, 'default_branch') ?? null;
  const updatedAt = pickString(payload, 'updated_at') ?? null;
  const pushedAt = pickString(payload, 'pushed_at') ?? null;
  const stars = pickNumber(payload, 'stargazers_count');
  const forks = pickNumber(payload, 'forks_count');
  const openIssues = pickNumber(payload, 'open_issues_count');
  const topics = Array.isArray(payload.topics) ? payload.topics.filter((topic): topic is string => typeof topic === 'string').slice(0, 12) : [];
  const licenseObj = payload.license && typeof payload.license === 'object' && !Array.isArray(payload.license)
    ? (payload.license as Record<string, unknown>)
    : null;
  const license = licenseObj ? pickString(licenseObj, 'spdx_id') ?? pickString(licenseObj, 'name') : null;

  let readme: string | null = null;
  if (params.includeReadme) {
    try {
      const readmePayload = await fetchJson(`${repoUrl}/readme`, { method: 'GET', headers }, timeoutMs);
      const encoded = pickString(readmePayload, 'content') ?? '';
      if (encoded) {
        readme = truncateWithNotice(Buffer.from(encoded.replace(/\n/g, ''), 'base64').toString('utf8'), 8_000).text;
      }
    } catch (error) {
      logger.warn({ error, repo: params.repo }, 'github_repo_lookup: failed to fetch README; returning metadata only');
    }
  }

  return {
    fullName,
    description,
    homepage,
    htmlUrl,
    language,
    defaultBranch,
    stars,
    forks,
    openIssues,
    topics,
    license,
    updatedAt,
    pushedAt,
    readme,
  };
}

export async function lookupGitHubFile(params: { repo: string; path: string; ref?: string; maxChars?: number }): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SCRAPE_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SCRAPE_TIMEOUT_MS, 5_000, 180_000);
  const configuredMaxChars = toInt((config.TOOL_WEB_SCRAPE_MAX_CHARS as number | undefined), DEFAULT_WEB_SCRAPE_MAX_CHARS, 500, 50_000);
  const maxChars = toInt(params.maxChars ?? configuredMaxChars, configuredMaxChars, 500, 50_000);

  const token = (config.GITHUB_TOKEN as string | undefined)?.trim();
  const headers = buildGitHubHeaders(token);
  const encodedPath = params.path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const endpoint = new URL(`https://api.github.com/repos/${params.repo}/contents/${encodedPath}`);
  if (params.ref?.trim()) endpoint.searchParams.set('ref', params.ref.trim());

  const payload = await fetchJson(endpoint.toString(), { method: 'GET', headers }, timeoutMs);
  if (Array.isArray(payload)) throw new Error('Path resolved to a directory. github_file_lookup expects a file path.');
  const type = pickString(payload, 'type') ?? 'file';
  if (type !== 'file') throw new Error(`Path resolved to "${type}", not a file.`);

  const encoding = pickString(payload, 'encoding') ?? null;
  const encodedContent = pickString(payload, 'content') ?? '';
  let decoded = '';
  if (encoding === 'base64' && encodedContent) {
    decoded = Buffer.from(encodedContent.replace(/\n/g, ''), 'base64').toString('utf8');
  } else if (encodedContent) {
    decoded = encodedContent;
  }

  const downloadUrl = sanitizeUrl(pickString(payload, 'download_url') ?? '');
  if (!decoded.trim() && downloadUrl) {
    const rawResponse = await fetchWithTimeout(
      downloadUrl,
      { method: 'GET', headers: { 'User-Agent': 'SageAgent/1.0', Accept: 'text/plain' } },
      timeoutMs,
    );
    const rawText = await rawResponse.text();
    if (rawResponse.ok && rawText.trim()) decoded = rawText;
  }
  if (!decoded.trim()) throw new Error('GitHub file content was empty.');

  const truncated = truncateWithNotice(decoded, maxChars);
  return {
    repo: params.repo,
    path: params.path,
    ref: params.ref?.trim() || null,
    sha: pickString(payload, 'sha') ?? null,
    size: pickNumber(payload, 'size'),
    encoding,
    htmlUrl: pickString(payload, 'html_url') ?? null,
    downloadUrl,
    content: truncated.text,
    truncated: truncated.truncated,
    lineCount: decoded.split(/\r?\n/).length,
  };
}

export async function lookupChannelFileCache(params: {
  guildId: string | null | undefined;
  channelId: string;
  messageId?: string;
  filename?: string;
  query?: string;
  limit?: number;
  includeContent?: boolean;
  maxChars?: number;
}): Promise<Record<string, unknown>> {
  const limit = toInt(params.limit, 3, 1, 10);
  const includeContent = params.includeContent !== false;
  const maxChars = toInt(
    params.maxChars ?? (config.TOOL_WEB_SCRAPE_MAX_CHARS as number | undefined),
    DEFAULT_WEB_SCRAPE_MAX_CHARS,
    500,
    50_000,
  );

  const records = await findIngestedAttachmentsForLookup({
    guildId: params.guildId ?? null,
    channelId: params.channelId,
    messageId: params.messageId?.trim() || undefined,
    filename: params.filename?.trim() || undefined,
    query: params.query?.trim() || undefined,
    limit,
  });

  const items = records.map((record) => {
    const truncated = truncateWithNotice(record.extractedText ?? '', maxChars);
    return {
      id: record.id,
      messageId: record.messageId,
      filename: record.filename,
      contentType: record.contentType,
      status: record.status,
      extractor: record.extractor,
      declaredSizeBytes: record.declaredSizeBytes,
      readSizeBytes: record.readSizeBytes,
      extractedTextChars: record.extractedTextChars,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      ...(includeContent
        ? { content: truncated.text, contentTruncated: truncated.truncated }
        : {
            snippet: truncated.text.slice(0, Math.min(400, truncated.text.length)),
            contentIncluded: false,
          }),
      ...(record.errorText ? { errorText: record.errorText } : {}),
    };
  });

  return {
    guildId: params.guildId ?? null,
    channelId: params.channelId,
    count: items.length,
    query: params.query ?? null,
    messageId: params.messageId ?? null,
    filename: params.filename ?? null,
    includeContent,
    maxChars,
    items,
    guidance:
      items.length > 0
        ? 'Use filename/messageId to target a specific cached file. Ask follow-up questions after retrieval for analysis.'
        : 'No cached files matched this query in the current channel.',
  };
}

export async function lookupNpmPackage(params: { packageName: string; version?: string }): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SCRAPE_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SCRAPE_TIMEOUT_MS, 5_000, 180_000);
  const payload = await fetchJson(
    `https://registry.npmjs.org/${encodeURIComponent(params.packageName)}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    timeoutMs,
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

  return {
    packageName: params.packageName,
    version: chosenVersion,
    latestVersion: typeof distTags.latest === 'string' ? distTags.latest : null,
    description: pickString(versionData, 'description') ?? '',
    license: pickString(versionData, 'license') ?? null,
    homepage: pickString(versionData, 'homepage') ?? null,
    repositoryUrl: repo ? pickString(repo, 'url') : null,
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

  let restError: Error | null = null;
  try {
    const payload = await fetchJson(
      endpoint.toString(),
      { method: 'GET', headers },
      params.timeoutMs,
    );
    const pages = toRecordList(payload.pages).slice(0, params.maxResults);
    if (pages.length > 0) {
      return pages;
    }
  } catch (error) {
    restError = error instanceof Error ? error : new Error(String(error));
    logger.warn({ error, query: params.query }, 'wikipedia_lookup rest endpoint failed; trying legacy api');
  }

  const legacyEndpoint = new URL(`https://${params.language}.wikipedia.org/w/api.php`);
  legacyEndpoint.searchParams.set('action', 'query');
  legacyEndpoint.searchParams.set('list', 'search');
  legacyEndpoint.searchParams.set('srsearch', params.query);
  legacyEndpoint.searchParams.set('srlimit', String(params.maxResults));
  legacyEndpoint.searchParams.set('format', 'json');
  legacyEndpoint.searchParams.set('utf8', '1');
  legacyEndpoint.searchParams.set('origin', '*');

  try {
    const legacyPayload = await fetchJson(
      legacyEndpoint.toString(),
      { method: 'GET', headers },
      params.timeoutMs,
    );
    const queryObj =
      legacyPayload.query && typeof legacyPayload.query === 'object' && !Array.isArray(legacyPayload.query)
        ? (legacyPayload.query as Record<string, unknown>)
        : {};
    return toRecordList(queryObj.search).slice(0, params.maxResults);
  } catch (legacyError) {
    const legacyErr = legacyError instanceof Error ? legacyError : new Error(String(legacyError));
    const rest429 = restError?.message.includes('HTTP 429') ?? false;
    const legacy429 = legacyErr.message.includes('HTTP 429');
    if (rest429 || legacy429) {
      throw new Error('Wikipedia rate limited (HTTP 429). Retry later or use web_search.');
    }
    throw legacyErr;
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
}): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SEARCH_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SEARCH_TIMEOUT_MS, 5_000, 180_000);
  const maxResults = toInt(params.maxResults, 5, 1, 15);
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
      if (!title || !url) return null;
      return {
        title,
        url,
        score: pickNumber(item, 'score'),
        answerCount: pickNumber(item, 'answer_count'),
        accepted: item.accepted_answer_id !== undefined,
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
        isAnswered: boolean;
        tags: string[];
        creationDate: string | null;
        lastActivityDate: string | null;
      } => entry !== null,
    );

  if (results.length === 0) throw new Error(`Stack Overflow returned no results for "${params.query}"`);

  return {
    query: params.query,
    tagged: params.tagged?.trim() || null,
    checkedOn: new Date().toISOString().slice(0, 10),
    provider: 'stack_overflow',
    answer: summarizeLabeledList(results.map((entry) => ({ title: entry.title, detail: `score=${entry.score ?? 0}, answers=${entry.answerCount ?? 0}` })), 'No concise answer returned.'),
    sourceUrls: results.map((entry) => entry.url),
    results,
  };
}

function resolveOllamaBaseUrl(): string {
  return (config.OLLAMA_BASE_URL as string | undefined)?.trim() || 'http://127.0.0.1:11434';
}

export async function listLocalOllamaModels(): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SEARCH_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SEARCH_TIMEOUT_MS, 5_000, 180_000);
  const payload = await fetchJson(buildBaseUrl(resolveOllamaBaseUrl(), '/api/tags'), { method: 'GET', headers: { Accept: 'application/json' } }, timeoutMs);
  const models = toRecordList(payload.models).map((entry) => ({
    name: pickString(entry, 'name') ?? 'unknown',
    size: pickNumber(entry, 'size'),
    modifiedAt: pickString(entry, 'modified_at') ?? null,
    digest: pickString(entry, 'digest') ?? null,
  }));
  return { provider: 'ollama', baseUrl: resolveOllamaBaseUrl(), modelCount: models.length, models };
}

export async function runLocalLlmInfer(params: {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<Record<string, unknown>> {
  const timeoutMs = toInt((config.TOOL_WEB_SEARCH_TIMEOUT_MS as number | undefined), DEFAULT_WEB_SEARCH_TIMEOUT_MS, 5_000, 300_000);
  const endpoint = buildBaseUrl(resolveOllamaBaseUrl(), '/api/generate');
  const model = params.model?.trim() || (config.OLLAMA_MODEL as string | undefined)?.trim() || 'llama3.1:8b';
  const maxTokens = toInt(params.maxTokens, 512, 64, 4_096);
  const temperature = toBoundedFloat(params.temperature, 0.2, 0, 2);

  const payload = await fetchJson(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        system: params.system?.trim() || undefined,
        stream: false,
        options: { temperature, num_predict: maxTokens },
      }),
    },
    timeoutMs,
  );

  const response = pickString(payload, 'response') ?? '';
  if (!response.trim()) throw new Error('Ollama returned an empty response');

  const truncated = truncateWithNotice(response, 8_000);
  return {
    provider: 'ollama',
    model,
    response: truncated.text,
    truncated: truncated.truncated,
    totalDurationNs: pickNumber(payload, 'total_duration'),
    evalCount: pickNumber(payload, 'eval_count'),
    done: payload.done === true,
  };
}

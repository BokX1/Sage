import { z } from 'zod';
import { buildToolMemoScopeKey, globalToolMemoStore } from './toolMemoStore';
import { globalPagedTextStore } from './pagedTextStore';
import { defineToolSpecV2 } from './toolRegistry';
import {
  type SearchDepth,
  runWebSearch,
  scrapeWebPage,
  sanitizePublicUrl,
} from './toolIntegrations';

const WEB_SEARCH_MEMO_TTL_MS = 60_000;
const WEB_READ_MEMO_TTL_MS = 5 * 60_000;
const WEB_READ_PAGE_MAX_CHARS = 4_000;

function computeAgeDays(publishedDate: string | null | undefined, now = new Date()): number | null {
  if (!publishedDate) return null;
  const parsed = new Date(publishedDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const deltaMs = now.getTime() - parsed.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return null;
  return Math.floor(deltaMs / (24 * 60 * 60 * 1000));
}

function getWebSearchProfile(): { depth: SearchDepth } {
  return { depth: 'balanced' };
}

const urlSchema = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://');

const webSearchInput = z.object({
  query: z.string().trim().min(2).max(400).describe('The specific explicit search query to run.'),
  depth: z.enum(['quick', 'balanced', 'deep']).optional(),
  maxResults: z.number().int().min(1).max(10).optional(),
});

const webReadInput = z.object({
  url: urlSchema,
});

const webReadPageInput = z.object({
  url: urlSchema,
  contentId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe('Continuation token from a previous web_read_page call.'),
  startChar: z.number().int().min(0).max(50_000_000).optional(),
});

function readStructuredContent(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const envelope = result as { structuredContent?: unknown };
  if (!envelope.structuredContent || typeof envelope.structuredContent !== 'object' || Array.isArray(envelope.structuredContent)) {
    return null;
  }
  return envelope.structuredContent as Record<string, unknown>;
}

function buildWebReadEnvelope(structuredContent: Record<string, unknown>) {
  return {
    structuredContent,
  };
}

export const webSearchTool = defineToolSpecV2({
  name: 'web_search',
  title: 'Web Search',
  description: 'Search the public web and return recent source-grounded results.',
  input: webSearchInput,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    parallelSafe: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'default',
    capabilityTags: ['web', 'search', 'grounding'],
  },
  prompt: {
    summary: 'Use for current public-web searching when you need fresh sources, especially for latest/current/recent facts, not a single known page.',
    whenToUse: ['Prefer this before direct reads when you need discovery, source selection, or current-state verification.'],
    whenNotToUse: ['Do not use for a URL you already know; use `web_read` or `web_read_page` instead.'],
  },
  smoke: {
    mode: 'optional',
    args: { query: 'OpenAI latest docs', maxResults: 3 },
  },
  validationHint: 'Provide a concrete search query and keep maxResults small unless breadth is truly needed.',
  execute: async (args, ctx) => {
    const scopeKey = buildToolMemoScopeKey('web_search', ctx);
    const memoHit = globalToolMemoStore.get(scopeKey, 'web_search', args);
    if (memoHit && memoHit.result && typeof memoHit.result === 'object' && !Array.isArray(memoHit.result)) {
      return memoHit.result as {
        structuredContent: Record<string, unknown>;
        modelSummary?: string;
      };
    }

    const search = await runWebSearch({
      query: args.query,
      depth: args.depth ?? getWebSearchProfile().depth,
      maxResults: args.maxResults,
      apiKey: ctx.apiKey,
      signal: ctx.signal,
    });

    const results = Array.isArray(search.results) ? (search.results as unknown[]) : [];
    const enrichedResults = results.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const record = item as Record<string, unknown>;
      const publishedDate = typeof record.publishedDate === 'string' ? record.publishedDate : undefined;
      return {
        ...record,
        ageDays: computeAgeDays(publishedDate),
      };
    });

    const envelope = {
      structuredContent: {
        ...search,
        results: enrichedResults,
      },
      modelSummary: JSON.stringify({
        provider: (search as Record<string, unknown>).provider ?? 'unknown',
        results: enrichedResults,
      }),
    };

    globalToolMemoStore.set(scopeKey, 'web_search', args, envelope, {
      ttlMs: WEB_SEARCH_MEMO_TTL_MS,
    });
    return envelope;
  },
});

export const webReadTool = defineToolSpecV2({
  name: 'web_read',
  title: 'Web Read',
  description: 'Fetch and extract the main content from one public URL.',
  input: webReadInput,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    parallelSafe: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'large',
    capabilityTags: ['web', 'read'],
  },
  prompt: {
    summary: 'Use for reading one known URL after discovery is already done, including current docs behavior on an exact page.',
    whenToUse: ['Use this when the user gave a URL or when a prior search already found the page, especially for exact-page current-state verification.'],
    whenNotToUse: ['Do not use when you still need discovery across multiple possible sources or when you need bounded continuation over a very large page.'],
  },
  smoke: {
    mode: 'optional',
    args: { url: 'https://openai.com' },
  },
  validationHint: 'Pass one public http(s) URL.',
  execute: async (args, ctx) => {
    const sanitizedUrl = sanitizePublicUrl(args.url);
    if (!sanitizedUrl) {
      throw new Error('Invalid URL');
    }

    const scopeKey = buildToolMemoScopeKey('web_read', ctx);
    const memoArgs = { url: sanitizedUrl };
    const memoHit = globalToolMemoStore.get(scopeKey, 'web_read', memoArgs);
    if (memoHit && memoHit.result && typeof memoHit.result === 'object' && !Array.isArray(memoHit.result)) {
      return memoHit.result as {
        structuredContent: Record<string, unknown>;
      };
    }

    const result = await scrapeWebPage({
      url: sanitizedUrl,
      signal: ctx.signal,
    });
    const envelope = buildWebReadEnvelope(result);
    globalToolMemoStore.set(scopeKey, 'web_read', memoArgs, envelope, {
      ttlMs: WEB_READ_MEMO_TTL_MS,
    });
    return envelope;
  },
});

export const webReadPageTool = defineToolSpecV2({
  name: 'web_read_page',
  title: 'Web Read Page',
  description: 'Read a large page in bounded chunks with continuation fields.',
  input: webReadPageInput,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    parallelSafe: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'large',
    capabilityTags: ['web', 'read', 'paging'],
  },
  prompt: {
    summary: 'Use for very large known pages when you need bounded reads instead of one huge extraction.',
    whenToUse: ['Use this after `web_read` or in place of it when the page is too large to consume in one pass.'],
    whenNotToUse: ['Do not use when you still need source discovery; start with `web_search` instead.'],
  },
  smoke: {
    mode: 'skip',
    reason: 'Requires multi-step paging context.',
  },
  validationHint: 'Reuse contentId from a previous `web_read_page` call or start from the beginning with just the URL.',
  execute: async (args, ctx) => {
    const sanitizedUrl = sanitizePublicUrl(args.url);
    if (!sanitizedUrl) {
      throw new Error('Invalid URL');
    }

    const scopeKey = buildToolMemoScopeKey('web_read_page', ctx);
    const webReadScopeKey = buildToolMemoScopeKey('web_read', ctx);
    const startChar = Math.max(0, Math.floor(args.startChar ?? 0));

    let contentId = args.contentId?.trim() || null;
    let entry = contentId ? globalPagedTextStore.get(contentId, scopeKey) : null;

    if (!entry) {
      const webReadMemoHit = globalToolMemoStore.get(webReadScopeKey, 'web_read', { url: sanitizedUrl });
      const cachedRead = webReadMemoHit ? readStructuredContent(webReadMemoHit.result) : null;
      const fetchedAtIso =
        typeof cachedRead?.fetchedAtIso === 'string'
          ? cachedRead.fetchedAtIso
          : new Date().toISOString();
      const extracted = cachedRead ?? await scrapeWebPage({
        url: sanitizedUrl,
        signal: ctx.signal,
      });
      const content = typeof extracted.content === 'string' ? extracted.content : '';

      const created = globalPagedTextStore.create(scopeKey, content, {
        url: sanitizedUrl,
        provider: typeof extracted.provider === 'string' ? extracted.provider : null,
        title: typeof extracted.title === 'string' ? extracted.title : null,
        providersTried: Array.isArray(extracted.providersTried) ? extracted.providersTried : undefined,
        fetchedAtIso,
      });

      if (!created) {
        const boundedStart = Math.max(0, Math.min(startChar, content.length));
        const endChar = Math.min(content.length, boundedStart + WEB_READ_PAGE_MAX_CHARS);
        const page = content.slice(boundedStart, endChar);
        return {
          structuredContent: {
            found: true,
            url: sanitizedUrl,
            contentId: null,
            startChar: boundedStart,
            maxChars: WEB_READ_PAGE_MAX_CHARS,
            returnedChars: page.length,
            totalChars: content.length,
            hasMore: endChar < content.length,
            nextStartChar: endChar < content.length ? endChar : null,
            content: page,
            guidance: 'Paging store was unavailable for this page. Retry later or use web_read.',
          },
        };
      }

      entry = created;
      contentId = created.id;
    }

    const text = entry.text;
    const totalChars = text.length;
    const boundedStart = Math.max(0, Math.min(startChar, totalChars));
    const endChar = Math.min(totalChars, boundedStart + WEB_READ_PAGE_MAX_CHARS);
    const page = text.slice(boundedStart, endChar);
    const nextStartChar = endChar < totalChars ? endChar : null;
    const meta = entry.meta ?? {};

    return {
      structuredContent: {
        found: true,
        url: sanitizedUrl,
        contentId,
        startChar: boundedStart,
        maxChars: WEB_READ_PAGE_MAX_CHARS,
        returnedChars: page.length,
        totalChars,
        hasMore: nextStartChar !== null,
        nextStartChar,
        content: page,
        fetchedAtIso: typeof meta.fetchedAtIso === 'string' ? meta.fetchedAtIso : null,
        provider: typeof meta.provider === 'string' ? meta.provider : null,
        title: typeof meta.title === 'string' ? meta.title : null,
        providersTried: Array.isArray(meta.providersTried) ? meta.providersTried : [],
      },
    };
  },
});

export const webTools = [
  webSearchTool,
  webReadTool,
  webReadPageTool,
];

import { z } from 'zod';
import { buildToolMemoScopeKey } from './toolMemoStore';
import { globalPagedTextStore } from './pagedTextStore';
import { defineToolSpecV2 } from './toolRegistry';
import {
  type SearchDepth,
  runWebSearch,
  scrapeWebPage,
  runAgenticWebScrape,
  sanitizePublicUrl,
} from './toolIntegrations';

function dedupeSanitizedUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const url of urls) {
    const sanitized = sanitizePublicUrl(url);
    if (!sanitized) continue;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(sanitized);
  }
  return deduped;
}

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

const webExtractInput = z.object({
  url: urlSchema,
  instruction: z
    .string()
    .trim()
    .min(5)
    .max(1_000)
    .describe('Specific instructions for what data to extract or how to interpret the webpage.'),
});

const webResearchInput = z.object({
  query: z.string().trim().min(2).max(400).describe('The specific explicit search query to run.'),
  depth: z.enum(['quick', 'balanced', 'deep']).optional(),
  maxResults: z.number().int().min(1).max(10).optional(),
  maxSources: z.number().int().min(1).max(5).optional(),
  followLinks: z
    .boolean()
    .optional()
    .describe('If true, follow a small number of links found in the read sources.'),
  maxFollowedLinks: z.number().int().min(1).max(10).optional(),
  maxFollowedLinksPerSource: z.number().int().min(1).max(5).optional(),
  followSameDomainOnly: z.boolean().optional(),
});

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
    summary: 'Use for current public-web searching when you need fresh sources, not a single known page.',
    whenToUse: ['Prefer this before direct reads when you need discovery or source selection.'],
    whenNotToUse: ['Do not use for a URL you already know; use `web_read` or `web_extract` instead.'],
  },
  smoke: {
    mode: 'optional',
    args: { query: 'OpenAI latest docs', maxResults: 3 },
  },
  validationHint: 'Provide a concrete search query and keep maxResults small unless breadth is truly needed.',
  execute: async (args, ctx) => {
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

    return {
      structuredContent: {
        ...search,
        results: enrichedResults,
      },
      modelSummary: JSON.stringify({
        provider: (search as Record<string, unknown>).provider ?? 'unknown',
        results: enrichedResults,
      }),
    };
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
    summary: 'Use for reading one known URL after discovery is already done.',
    whenToUse: ['Use this when the user gave a URL or when a prior search already found the page.'],
    whenNotToUse: ['Do not use for targeted extraction; use `web_extract` when you need specific fields only.'],
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
    const result = await scrapeWebPage({
      url: sanitizedUrl,
      signal: ctx.signal,
    });
    return {
      structuredContent: result,
    };
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
    summary: 'Use for very large pages when you need bounded reads instead of one huge extraction.',
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
    const startChar = Math.max(0, Math.floor(args.startChar ?? 0));
    const pageMaxChars = 4_000;

    let contentId = args.contentId?.trim() || null;
    let entry = contentId ? globalPagedTextStore.get(contentId, scopeKey) : null;

    if (!entry) {
      const fetchedAtIso = new Date().toISOString();
      const extracted = await scrapeWebPage({
        url: sanitizedUrl,
        signal: ctx.signal,
      });
      const extractedRecord = extracted && typeof extracted === 'object' && !Array.isArray(extracted)
        ? (extracted as Record<string, unknown>)
        : {};
      const content = typeof extractedRecord.content === 'string' ? extractedRecord.content : '';

      const created = globalPagedTextStore.create(scopeKey, content, {
        url: sanitizedUrl,
        provider: typeof extractedRecord.provider === 'string' ? extractedRecord.provider : null,
        title: typeof extractedRecord.title === 'string' ? extractedRecord.title : null,
        providersTried: Array.isArray(extractedRecord.providersTried) ? extractedRecord.providersTried : undefined,
        fetchedAtIso,
      });

      if (!created) {
        const boundedStart = Math.max(0, Math.min(startChar, content.length));
        const endChar = Math.min(content.length, boundedStart + pageMaxChars);
        const page = content.slice(boundedStart, endChar);
        return {
          structuredContent: {
            found: true,
            url: sanitizedUrl,
            contentId: null,
            startChar: boundedStart,
            maxChars: pageMaxChars,
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
    const endChar = Math.min(totalChars, boundedStart + pageMaxChars);
    const page = text.slice(boundedStart, endChar);
    const nextStartChar = endChar < totalChars ? endChar : null;
    const meta = entry.meta ?? {};

    return {
      structuredContent: {
        found: true,
        url: sanitizedUrl,
        contentId,
        startChar: boundedStart,
        maxChars: pageMaxChars,
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

export const webExtractTool = defineToolSpecV2({
  name: 'web_extract',
  title: 'Web Extract',
  description: 'Read one public URL and extract only the requested fields or facts.',
  input: webExtractInput,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'default',
    capabilityTags: ['web', 'extract'],
  },
  prompt: {
    summary: 'Use when you need structured extraction from a known URL instead of a general read.',
  },
  smoke: {
    mode: 'skip',
    reason: 'Extraction quality is instruction-dependent.',
  },
  validationHint: 'Give one URL plus explicit extraction instructions.',
  execute: async (args, ctx) => {
    const sanitizedUrl = sanitizePublicUrl(args.url);
    if (!sanitizedUrl) {
      throw new Error('Invalid URL');
    }
    const result = await runAgenticWebScrape({
      url: sanitizedUrl,
      instruction: args.instruction,
      signal: ctx.signal,
    });
    return {
      structuredContent: result,
    };
  },
});

export const webResearchTool = defineToolSpecV2({
  name: 'web_research',
  title: 'Web Research',
  description: 'Run one bounded search-plus-read research bundle over public sources.',
  input: webResearchInput,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  runtime: {
    class: 'query',
    readOnly: true,
    observationPolicy: 'large',
    capabilityTags: ['web', 'research'],
  },
  prompt: {
    summary: 'Use when a single bounded research pass is better than chaining separate web tools.',
    whenNotToUse: ['Avoid when you only need one known URL or a simple search result list.'],
  },
  smoke: {
    mode: 'optional',
    args: { query: 'OpenAI latest docs', maxResults: 3, maxSources: 2 },
  },
  validationHint: 'Use this for bounded multi-source research, not unbounded crawling.',
  execute: async (args, ctx) => {
    const search = await runWebSearch({
      query: args.query,
      depth: args.depth ?? getWebSearchProfile().depth,
      maxResults: args.maxResults,
      apiKey: ctx.apiKey,
      signal: ctx.signal,
    });
    const rawResults = Array.isArray(search.results) ? search.results : [];
    const uniqueResultUrls = dedupeSanitizedUrls(
      rawResults
        .map((entry) =>
          entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).url === 'string'
            ? ((entry as Record<string, unknown>).url as string)
            : null,
        )
        .filter((value): value is string => Boolean(value)),
    );
    const sourceLimit = Math.max(1, Math.min(args.maxSources ?? 3, uniqueResultUrls.length || 1));
    const sourceUrls = uniqueResultUrls.slice(0, sourceLimit);
    const sourceReads = await Promise.all(
      sourceUrls.map(async (url) => ({
        url,
        read: await scrapeWebPage({ url, signal: ctx.signal }),
      })),
    );

    return {
      structuredContent: {
        query: args.query,
        search,
        sourceUrls,
        sourceReads,
        followLinksRequested: args.followLinks ?? false,
        uniqueSourceUrls: sourceUrls,
      },
    };
  },
});

export const webTools = [
  webSearchTool,
  webReadTool,
  webReadPageTool,
  webExtractTool,
  webResearchTool,
];

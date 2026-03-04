import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from './toolRegistry';
import { buildToolMemoScopeKey } from './toolMemoStore';
import { globalPagedTextStore } from './pagedTextStore';
import {
  type SearchDepth,
  runWebSearch,
  scrapeWebPage,
  runAgenticWebScrape,
  sanitizePublicUrl,
  uniqueUrls,
} from './toolIntegrations';

type WebSearchProviderId = 'tavily' | 'exa' | 'searxng' | 'pollinations';
type WebScrapeProviderId = 'firecrawl' | 'crawl4ai' | 'jina' | 'raw_fetch' | 'nomnom';

const requiredThinkField = z
  .string()
  .describe(
    'Mandatory internal reasoning explaining exactly why you are generating this payload and how it fulfills the active goal.',
  );

const COMPLEX_SEARCH_WEB_PROVIDER_ORDER = ['searxng', 'tavily', 'exa'] as const;
const COMPLEX_SEARCH_SCRAPE_PROVIDER_ORDER = ['crawl4ai', 'jina', 'raw_fetch', 'firecrawl'] as const;

function computeAgeDays(publishedDate: string | null | undefined, now = new Date()): number | null {
  if (!publishedDate) return null;
  const parsed = new Date(publishedDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const deltaMs = now.getTime() - parsed.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return null;
  return Math.floor(deltaMs / (24 * 60 * 60 * 1000));
}

function getWebSearchProfile(ctx: ToolExecutionContext): {
  depth: SearchDepth;
  providerOrder?: WebSearchProviderId[];
  allowLlmFallback?: boolean;
  scrapeProviderOrder?: WebScrapeProviderId[];
} {
  const useHighSearchProfile =
    ctx.routeKind === 'search' && ctx.toolExecutionProfile === 'search_high';
  return {
    depth: useHighSearchProfile ? 'deep' : 'balanced',
    providerOrder: useHighSearchProfile ? [...COMPLEX_SEARCH_WEB_PROVIDER_ORDER] : undefined,
    allowLlmFallback: useHighSearchProfile ? false : undefined,
    scrapeProviderOrder: useHighSearchProfile ? [...COMPLEX_SEARCH_SCRAPE_PROVIDER_ORDER] : undefined,
  };
}

const webToolSchema = z.discriminatedUnion('action', [
  z.object({
    think: requiredThinkField,
    action: z.literal('search').describe('Search the web and return source-grounded results.'),
    query: z.string().trim().min(2).max(400).describe('The specific explicit search query to run.'),
    depth: z.enum(['quick', 'balanced', 'deep']).optional(),
    maxResults: z.number().int().min(1).max(10).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('read').describe('Fetch and extract the main content from a URL.'),
    url: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://'),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z
      .literal('read.page')
      .describe('Read a URL in pages, returning continuation fields so large pages are not all-or-nothing.'),
    url: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://'),
    contentId: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe('Continuation token from a previous web read.page call.'),
    startChar: z.number().int().min(0).max(50_000_000).optional(),
    maxChars: z
      .number()
      .int()
      .min(200)
      .max(8_000)
      .optional()
      .describe('Maximum characters to return for this page.'),
    fetchMaxChars: z
      .number()
      .int()
      .min(500)
      .max(50_000)
      .optional()
      .describe('Maximum characters to fetch/store on the initial call (bounded by TOOL_WEB_SCRAPE_MAX_CHARS).'),
  }),

  z.object({
    think: requiredThinkField,
    action: z.literal('extract').describe('Extract specific data from a URL using explicit instructions.'),
    url: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://'),
    instruction: z
      .string()
      .trim()
      .min(5)
      .max(1_000)
      .describe('Specific instructions for what data to extract or how to interpret the webpage.'),
    maxChars: z.number().int().min(500).max(50_000).optional(),
  }),

  z.object({
    think: requiredThinkField,
    action: z
      .literal('research')
      .describe('One-shot web research: search + read top sources (pagination via repeated calls).'),
    query: z.string().trim().min(2).max(400).describe('The specific explicit search query to run.'),
    depth: z.enum(['quick', 'balanced', 'deep']).optional(),
    maxResults: z.number().int().min(1).max(10).optional(),
    maxSources: z.number().int().min(1).max(5).optional(),
    perSourceMaxChars: z.number().int().min(500).max(20_000).optional(),
    followLinks: z
      .boolean()
      .optional()
      .describe('If true, follow a small number of links found in the read sources (bounded; no streaming).'),
    maxFollowedLinks: z.number().int().min(1).max(10).optional(),
    maxFollowedLinksPerSource: z.number().int().min(1).max(5).optional(),
    followSameDomainOnly: z
      .boolean()
      .optional()
      .describe('If true (default), only follow links on the same domain as the source page.'),
    perFollowMaxChars: z.number().int().min(500).max(10_000).optional(),
  }),
]);

export const webTool: ToolDefinition<z.infer<typeof webToolSchema>> = {
  name: 'web',
  description:
    [
      'Unified web research tool with action-based calls.',
      'Actions:',
      '- search: web search with provider fallback',
      '- read: extract main content from a URL',
      '- read.page: paged reads with continuation fields',
      '- extract: targeted extraction from a URL using instructions',
      '- research: search + read top sources in one call',
      '<USE_ONLY_WHEN> You need up-to-date or source-grounded public internet information. </USE_ONLY_WHEN>',
    ].join('\n'),
  schema: webToolSchema,
  metadata: { readOnly: true },
  execute: async (args, ctx) => {
    const profile = getWebSearchProfile(ctx);
    const now = new Date();

    switch (args.action) {
      case 'search': {
        const search = await runWebSearch({
          query: args.query,
          depth: args.depth ?? profile.depth,
          maxResults: args.maxResults,
          apiKey: ctx.apiKey,
          providerOrder: profile.providerOrder,
          allowLlmFallback: profile.allowLlmFallback,
        });

        const results = Array.isArray(search.results) ? (search.results as unknown[]) : [];
        const enrichedResults = results.map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
          const record = item as Record<string, unknown>;
          const publishedDate =
            typeof record.publishedDate === 'string' ? record.publishedDate : undefined;
          return {
            ...record,
            ageDays: computeAgeDays(publishedDate, now),
          };
        });

        return {
          ...search,
          results: enrichedResults,
        };
      }

      case 'read': {
        const sanitizedUrl = sanitizePublicUrl(args.url);
        if (!sanitizedUrl) {
          throw new Error('Invalid URL');
        }
        return scrapeWebPage({
          url: sanitizedUrl,
          maxChars: args.maxChars,
          providerOrder: profile.scrapeProviderOrder,
        });
      }

      case 'read.page': {
        const sanitizedUrl = sanitizePublicUrl(args.url);
        if (!sanitizedUrl) {
          throw new Error('Invalid URL');
        }

        const scopeKey = buildToolMemoScopeKey('web', ctx);
        const startChar = Math.max(0, Math.floor(args.startChar ?? 0));
        const pageMaxChars = Math.max(200, Math.min(8_000, Math.floor(args.maxChars ?? 4_000)));
        const fetchMaxChars = Math.max(500, Math.min(50_000, Math.floor(args.fetchMaxChars ?? 50_000)));

        let contentId = args.contentId?.trim() || null;
        let entry = contentId ? globalPagedTextStore.get(contentId, scopeKey) : null;

        if (!entry) {
          const fetchedAtIso = new Date().toISOString();
          const extracted = await scrapeWebPage({
            url: sanitizedUrl,
            maxChars: fetchMaxChars,
            providerOrder: profile.scrapeProviderOrder,
          });
          const extractedRecord = extracted && typeof extracted === 'object' && !Array.isArray(extracted)
            ? (extracted as Record<string, unknown>)
            : {};
          const content = typeof extractedRecord.content === 'string' ? extractedRecord.content : '';

          const created = globalPagedTextStore.create(scopeKey, content, {
            url: sanitizedUrl,
            provider: typeof extractedRecord.provider === 'string' ? extractedRecord.provider : null,
            title: typeof extractedRecord.title === 'string' ? extractedRecord.title : null,
            truncatedAtSource: extractedRecord.truncated === true,
            providersTried: Array.isArray(extractedRecord.providersTried) ? extractedRecord.providersTried : undefined,
            fetchedAtIso,
          });

          if (!created) {
            const boundedStart = Math.max(0, Math.min(startChar, content.length));
            const endChar = Math.min(content.length, boundedStart + pageMaxChars);
            const page = content.slice(boundedStart, endChar);
            return {
              found: true,
              action: 'read.page',
              url: sanitizedUrl,
              contentId: null,
              startChar: boundedStart,
              maxChars: pageMaxChars,
              returnedChars: page.length,
              totalChars: content.length,
              hasMore: endChar < content.length,
              nextStartChar: endChar < content.length ? endChar : null,
              content: page,
              truncatedAtSource: extractedRecord.truncated === true,
              guidance:
                'Paging store was unavailable for this page. Retry with a smaller fetchMaxChars or use web.read.',
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
          found: true,
          action: 'read.page',
          url: sanitizedUrl,
          contentId,
          provider: typeof meta.provider === 'string' ? meta.provider : null,
          title: typeof meta.title === 'string' ? meta.title : null,
          fetchedAtIso: typeof meta.fetchedAtIso === 'string' ? meta.fetchedAtIso : null,
          truncatedAtSource: meta.truncatedAtSource === true,
          startChar: boundedStart,
          maxChars: pageMaxChars,
          returnedChars: page.length,
          totalChars,
          hasMore: nextStartChar !== null,
          nextStartChar,
          content: page,
          guidance:
            nextStartChar !== null
              ? 'Call web action read.page again with the same url + contentId and startChar=nextStartChar.'
              : 'End of paged content.',
        };
      }

      case 'extract': {
        const sanitizedUrl = sanitizePublicUrl(args.url);
        if (!sanitizedUrl) {
          throw new Error('Invalid URL');
        }
        return runAgenticWebScrape({
          url: sanitizedUrl,
          instruction: args.instruction,
          maxChars: args.maxChars,
        });
      }

      case 'research': {
        const maxSources = args.maxSources ?? 3;
        const perSourceMaxChars = args.perSourceMaxChars ?? 6_000;
        const followLinks = args.followLinks === true;
        const maxFollowedLinks = followLinks ? (args.maxFollowedLinks ?? 3) : 0;
        const maxFollowedLinksPerSource = followLinks ? (args.maxFollowedLinksPerSource ?? 1) : 0;
        const followSameDomainOnly = args.followSameDomainOnly !== false;
        const perFollowMaxChars = followLinks
          ? (args.perFollowMaxChars ?? Math.max(500, Math.min(3_000, perSourceMaxChars)))
          : 0;
        const search = await runWebSearch({
          query: args.query,
          depth: args.depth ?? profile.depth,
          maxResults: args.maxResults,
          apiKey: ctx.apiKey,
          providerOrder: profile.providerOrder,
          allowLlmFallback: profile.allowLlmFallback,
        });

        const results = Array.isArray(search.results) ? (search.results as Record<string, unknown>[]) : [];
        const sources = results
          .map((item) => ({
            title: typeof item.title === 'string' ? item.title : null,
            url: typeof item.url === 'string' ? item.url : null,
            publishedDate: typeof item.publishedDate === 'string' ? item.publishedDate : null,
          }))
          .filter((item) => typeof item.url === 'string' && item.url.length > 0)
          .slice(0, maxSources);

        const reads: Array<Record<string, unknown>> = [];
        for (const source of sources) {
          const url = source.url!;
          const sanitizedUrl = sanitizePublicUrl(url);
          if (!sanitizedUrl) continue;
          try {
            const extracted = await scrapeWebPage({
              url: sanitizedUrl,
              maxChars: perSourceMaxChars,
              providerOrder: profile.scrapeProviderOrder,
            });
            reads.push({
              ...source,
              ageDays: computeAgeDays(source.publishedDate, now),
              fetchedAtIso: now.toISOString(),
              read: extracted,
            });
          } catch (error) {
            reads.push({
              ...source,
              ageDays: computeAgeDays(source.publishedDate, now),
              fetchedAtIso: now.toISOString(),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const payload: Record<string, unknown> = {
          ...search,
          maxSources,
          perSourceMaxChars,
          sourcesRead: reads.length,
          sources: reads,
        };

        if (followLinks && maxFollowedLinks > 0) {
          const followed: Array<Record<string, unknown>> = [];
          const followQueue: Array<Record<string, unknown>> = [];
          const visited = new Set<string>();
          for (const source of sources) {
            const sanitized = source.url ? sanitizePublicUrl(source.url) : null;
            if (!sanitized) continue;
            visited.add(sanitized.toLowerCase());
          }

          for (const entry of reads) {
            if (followed.length >= maxFollowedLinks) break;
            const sourceUrlRaw = typeof entry.url === 'string' ? entry.url : null;
            const sourceUrl = sourceUrlRaw ? sanitizePublicUrl(sourceUrlRaw) : null;
            if (!sourceUrl) continue;
            const sourceHost = (() => {
              try {
                return new URL(sourceUrl).hostname.toLowerCase();
              } catch {
                return null;
              }
            })();
            const readRecord =
              entry.read && typeof entry.read === 'object' && !Array.isArray(entry.read)
                ? (entry.read as Record<string, unknown>)
                : null;
            const content = typeof readRecord?.content === 'string' ? readRecord.content : '';
            if (!content.trim()) continue;

            const candidates = uniqueUrls(content);
            const eligible: string[] = [];
            const maxEligiblePerSource = Math.max(10, maxFollowedLinksPerSource * 4);
            for (const candidate of candidates) {
              if (eligible.length >= maxEligiblePerSource) break;
              const key = candidate.toLowerCase();
              if (visited.has(key)) continue;
              if (followSameDomainOnly && sourceHost) {
                try {
                  const candidateHost = new URL(candidate).hostname.toLowerCase();
                  if (candidateHost !== sourceHost) continue;
                } catch {
                  continue;
                }
              }
              visited.add(key);
              eligible.push(candidate);
            }

            let followedForSource = 0;
            for (const candidate of eligible) {
              if (followed.length >= maxFollowedLinks) {
                if (followQueue.length < 20) followQueue.push({ sourceUrl, url: candidate });
                continue;
              }
              if (followedForSource >= maxFollowedLinksPerSource) {
                if (followQueue.length < 20) followQueue.push({ sourceUrl, url: candidate });
                continue;
              }
              followedForSource += 1;
              try {
                const extracted = await scrapeWebPage({
                  url: candidate,
                  maxChars: perFollowMaxChars,
                  providerOrder: profile.scrapeProviderOrder,
                });
                followed.push({
                  sourceUrl,
                  url: candidate,
                  fetchedAtIso: now.toISOString(),
                  read: extracted,
                });
              } catch (error) {
                followed.push({
                  sourceUrl,
                  url: candidate,
                  fetchedAtIso: now.toISOString(),
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }

          payload.followLinks = true;
          payload.followSameDomainOnly = followSameDomainOnly;
          payload.maxFollowedLinks = maxFollowedLinks;
          payload.maxFollowedLinksPerSource = maxFollowedLinksPerSource;
          payload.perFollowMaxChars = perFollowMaxChars;
          payload.followedCount = followed.length;
          payload.followed = followed;
          payload.followQueueCount = followQueue.length;
          payload.followQueue = followQueue;
          payload.followGuidance =
            followQueue.length > 0
              ? 'Some links were discovered but not followed due to limits. Use web.read or web.read.page on followQueue URLs.'
              : 'Link-follow completed within configured limits.';
        }

        return payload;
      }
    }
  },
};

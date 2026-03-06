import { config } from '../config/env';
import { logger } from '../logging/logger';
import { getModelBudgetConfig } from './model-budget-config';

/**
 * Represents the ModelCaps type.
 */
export type ModelCaps = {
  vision?: boolean;
  audioIn?: boolean;
  audioOut?: boolean;
  tools?: boolean;
  search?: boolean;
  reasoning?: boolean;
  codeExec?: boolean;
};

/**
 * Represents the ModelInfo type.
 */
export type ModelInfo = {
  id: string;
  displayName?: string;
  caps: ModelCaps;
  inputModalities?: string[];
  outputModalities?: string[];
  raw?: unknown;
};

type CatalogState = {
  fetchedAt?: number;
  lastError?: string | null;
  source: 'runtime' | 'fallback';
};

const MANUAL_CAPABILITY_OVERRIDES: Record<string, ModelCaps> = {
  'gemini-search': { vision: true, search: true, reasoning: false, audioIn: false, audioOut: false },
  'deepseek': { vision: false, search: false, reasoning: true, audioIn: false, audioOut: false },
  'perplexity-fast': { vision: false, search: true, reasoning: false, audioIn: false, audioOut: false },
  'perplexity-reasoning': { vision: false, search: true, reasoning: true, audioIn: false, audioOut: false },
  'kimi': { vision: true, search: false, reasoning: true, audioIn: false, audioOut: false },
  'glm': { vision: false, search: false, reasoning: true, audioIn: false, audioOut: false },
  'nomnom': { vision: false, search: true, reasoning: false, audioIn: false, audioOut: false },
};

const normalizedDefaultModel = (config.CHAT_MODEL || 'kimi').trim().toLowerCase();

/**
 * Declares exported bindings: defaultModelId.
 */
export const defaultModelId = normalizedDefaultModel || 'kimi';

let catalogCache: Record<string, ModelInfo> | null = null;
let catalogState: CatalogState = { source: 'fallback', lastError: null };
let pendingFetch: Promise<Record<string, ModelInfo>> | null = null;

const MODEL_CATALOG_TIMEOUT_MS = 30_000;

function assertSafeCatalogBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:') {
    throw new Error('Model catalog base URL must use HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
}

function normalizeModalities(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().toLowerCase())
      .filter((item) => item.length > 0);
  }
  return undefined;
}

function parseFallbackHintModelIds(): string[] {
  const raw = config.LLM_MODEL_LIMITS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.keys(parsed).map((id) => normalizeModelId(id));
  } catch (error) {
    logger.warn({ error }, '[ModelCatalog] Failed to parse fallback model hints.');
    return [];
  }
}

function buildFallbackCatalog(): Record<string, ModelInfo> {
  const budgetConfig = getModelBudgetConfig(defaultModelId);
  const visionEnabled = !!budgetConfig.visionEnabled;
  const fallbackHints = parseFallbackHintModelIds();

  const catalog: Record<string, ModelInfo> = {
    [defaultModelId]: {
      id: defaultModelId,
      displayName: defaultModelId,
      caps: {
        vision: visionEnabled,
      },
      inputModalities: visionEnabled ? ['text', 'image'] : ['text'],
      outputModalities: ['text'],
      raw: { fallbackHint: true },
    },
  };

  for (const hintId of fallbackHints) {
    if (!hintId || catalog[hintId]) continue;
    const manualCaps = MANUAL_CAPABILITY_OVERRIDES[hintId] || {};
    catalog[hintId] = {
      id: hintId,
      displayName: hintId,
      caps: {
        vision: manualCaps.vision,
        reasoning: manualCaps.reasoning,
        audioIn: manualCaps.audioIn,
        audioOut: manualCaps.audioOut,
        search: manualCaps.search,
      },
      raw: { fallbackHint: true },
    };
  }

  return catalog;
}

async function fetchRuntimeCatalog(): Promise<Record<string, ModelInfo>> {
  const baseUrl = assertSafeCatalogBaseUrl(config.LLM_BASE_URL || 'https://gen.pollinations.ai/v1');
  const url = `${baseUrl}/models`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);
  timeoutId.unref?.();
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
  if (!response.ok) {
    throw new Error(`Model catalog fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as unknown;
  const items: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] })?.data)
      ? ((payload as { data?: unknown[] }).data as unknown[])
      : Array.isArray((payload as { models?: unknown[] })?.models)
        ? ((payload as { models?: unknown[] }).models as unknown[])
        : [];

  const catalog: Record<string, ModelInfo> = {};
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const idValue = raw.id ?? raw.name ?? raw.model;
    if (!idValue) continue;
    const id = normalizeModelId(String(idValue));
    if (!id) continue;

    const manualCaps = MANUAL_CAPABILITY_OVERRIDES[id] || {};

    const info: ModelInfo = {
      id,
      displayName: (raw.display_name ?? raw.displayName ?? raw.name) as string | undefined,
      caps: {
        vision: manualCaps.vision,
        audioIn: manualCaps.audioIn,
        audioOut: manualCaps.audioOut,
        tools: manualCaps.tools,
        search: manualCaps.search,
        reasoning: manualCaps.reasoning,
        codeExec: manualCaps.codeExec,
      },
      inputModalities: normalizeModalities(raw.input_modalities ?? raw.inputModalities),
      outputModalities: normalizeModalities(raw.output_modalities ?? raw.outputModalities),
      raw,
    };

    catalog[id] = info;
  }

  return catalog;
}

export function getDefaultModelId(): string {
  return defaultModelId;
}

export async function loadModelCatalog(): Promise<Record<string, ModelInfo>> {
  if (catalogCache) return catalogCache;
  if (pendingFetch) return pendingFetch;

  const fallback = buildFallbackCatalog();

  pendingFetch = (async () => {
    try {
      const runtimeCatalog = await fetchRuntimeCatalog();
      const merged = { ...fallback, ...runtimeCatalog };
      catalogCache = merged;
      catalogState = {
        source: 'runtime',
        fetchedAt: Date.now(),
        lastError: null,
      };
      return merged;
    } catch (error) {
      catalogCache = fallback;
      catalogState = {
        source: 'fallback',
        fetchedAt: Date.now(),
        lastError: error instanceof Error ? error.message : String(error),
      };
      logger.warn({ error: catalogState.lastError }, '[ModelCatalog] Failed to fetch runtime catalog. Using fallback.');
      return fallback;
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

export async function refreshModelCatalog(): Promise<Record<string, ModelInfo>> {
  catalogCache = null;
  return loadModelCatalog();
}

export function getModelCatalogState(): CatalogState {
  return { ...catalogState };
}

type FindModelCatalogOptions = {
  refreshIfMissing?: boolean;
  loadCatalog?: () => Promise<Record<string, ModelInfo>>;
  refreshCatalog?: () => Promise<Record<string, ModelInfo>>;
};

export async function findModelInCatalog(
  modelId: string,
  options: FindModelCatalogOptions = {},
): Promise<{ model: ModelInfo | null; catalog: Record<string, ModelInfo>; refreshed: boolean }> {
  const normalized = normalizeModelId(modelId);
  const loadCatalog = options.loadCatalog ?? loadModelCatalog;
  const refreshCatalog = options.refreshCatalog ?? refreshModelCatalog;

  let catalog = await loadCatalog();
  let model = catalog[normalized] ?? null;
  let refreshed = false;

  if (!model && options.refreshIfMissing) {
    catalog = await refreshCatalog();
    refreshed = true;
    model = catalog[normalized] ?? null;
  }

  return { model, catalog, refreshed };
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

export function suggestModelIds(
  query: string,
  catalog: Record<string, ModelInfo>,
  limit = 3,
): string[] {
  const normalized = normalizeModelId(query);
  if (!normalized) return [];

  const threshold = Math.max(2, Math.floor(normalized.length / 2));

  const scored = Object.keys(catalog).map((id) => {
    const candidate = normalizeModelId(id);
    const startsWith = candidate.startsWith(normalized);
    const includes = candidate.includes(normalized);
    const distance = levenshteinDistance(normalized, candidate);
    const score = distance - (startsWith ? 2 : includes ? 1 : 0);
    return { id, score, startsWith, includes };
  });

  return scored
    .filter((entry) => entry.startsWith || entry.includes || entry.score <= threshold)
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((entry) => entry.id);
}

export async function getModelInfo(id: string): Promise<ModelInfo | null> {
  const catalog = await loadModelCatalog();
  const normalized = normalizeModelId(id);
  return catalog[normalized] ?? null;
}

export async function isKnownModel(id: string): Promise<boolean> {
  const info = await getModelInfo(id);
  return !!info;
}

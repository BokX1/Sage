import { config } from '../config/env';
import { logger } from '../../utils/logger';
import { getModelBudgetConfig } from './models';

export type ModelCaps = {
  vision?: boolean;
  audioIn?: boolean;
  audioOut?: boolean;
  tools?: boolean;
  search?: boolean;
  reasoning?: boolean;
  codeExec?: boolean;
};

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

const normalizedDefaultModel = (config.pollinationsModel || 'gemini').trim().toLowerCase();

export const defaultModelId = normalizedDefaultModel || 'gemini';

let catalogCache: Record<string, ModelInfo> | null = null;
let catalogState: CatalogState = { source: 'fallback', lastError: null };
let pendingFetch: Promise<Record<string, ModelInfo>> | null = null;

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

function readBoolean(raw: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (key in raw) {
      const value = coerceBoolean(raw[key]);
      if (value !== undefined) return value;
    }
  }
  const caps = raw.capabilities;
  if (caps && typeof caps === 'object') {
    for (const key of keys) {
      if (key in (caps as Record<string, unknown>)) {
        const value = coerceBoolean((caps as Record<string, unknown>)[key]);
        if (value !== undefined) return value;
      }
    }
  }
  return undefined;
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
  const raw = config.llmModelLimitsJson?.trim();
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
    catalog[hintId] = {
      id: hintId,
      displayName: hintId,
      caps: {},
      raw: { fallbackHint: true },
    };
  }

  return catalog;
}

async function fetchRuntimeCatalog(): Promise<Record<string, ModelInfo>> {
  const baseUrl = normalizeBaseUrl(config.pollinationsBaseUrl || 'https://gen.pollinations.ai/v1');
  const url = `${baseUrl}/models`;
  const response = await fetch(url);
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

    const info: ModelInfo = {
      id,
      displayName: (raw.display_name ?? raw.displayName ?? raw.name) as string | undefined,
      caps: {
        vision: readBoolean(raw, ['vision', 'vision_enabled']),
        audioIn: readBoolean(raw, ['audio_in', 'audioIn']),
        audioOut: readBoolean(raw, ['audio_out', 'audioOut']),
        tools: readBoolean(raw, ['tools', 'tool_calls', 'toolCalls']),
        search: readBoolean(raw, ['search', 'web_search', 'webSearch']),
        reasoning: readBoolean(raw, ['reasoning']),
        codeExec: readBoolean(raw, ['code_exec', 'codeExec']),
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

export function modelSupports(
  info: ModelInfo,
  required: Partial<ModelCaps> & { inputModalities?: string[]; outputModalities?: string[] },
): boolean {
  if (required.vision) {
    const visionCap = info.caps.vision === true;
    const modalities = info.inputModalities?.map((item) => item.toLowerCase()) ?? [];
    if (!visionCap && !modalities.includes('image')) {
      return false;
    }
  }

  if (required.audioIn) {
    const modalities = info.inputModalities?.map((item) => item.toLowerCase()) ?? [];
    if (info.caps.audioIn !== true && !modalities.includes('audio')) {
      return false;
    }
  }

  if (required.audioOut) {
    const modalities = info.outputModalities?.map((item) => item.toLowerCase()) ?? [];
    if (info.caps.audioOut !== true && !modalities.includes('audio')) {
      return false;
    }
  }

  if (required.tools && info.caps.tools !== true) {
    return false;
  }

  if (required.search && info.caps.search !== true) {
    return false;
  }

  if (required.reasoning && info.caps.reasoning !== true) {
    return false;
  }

  if (required.codeExec && info.caps.codeExec !== true) {
    return false;
  }

  if (required.inputModalities) {
    const available = new Set(info.inputModalities?.map((item) => item.toLowerCase()) ?? []);
    for (const modality of required.inputModalities) {
      if (!available.has(modality.toLowerCase())) return false;
    }
  }

  if (required.outputModalities) {
    const available = new Set(info.outputModalities?.map((item) => item.toLowerCase()) ?? []);
    for (const modality of required.outputModalities) {
      if (!available.has(modality.toLowerCase())) return false;
    }
  }

  return true;
}

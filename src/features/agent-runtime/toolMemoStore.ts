import type { ToolExecutionContext } from './toolRegistry';
import { buildToolCacheKey } from './toolCache';
import { normalizeBoundedInt } from '../../shared/utils/numbers';

export type ToolMemoCacheKind = 'global';

export interface ToolMemoEntry {
  key: string;
  scopeKey: string;
  toolName: string;
  createdAtMs: number;
  result: unknown;
  resultJsonChars: number;
}

export interface ToolMemoStoreConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  maxResultJsonChars: number;
}

export interface ToolMemoStoreStats {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  maxResultJsonChars: number;
  entryCount: number;
  oldestEntryAgeMs: number | null;
  newestEntryAgeMs: number | null;
}

const DEFAULT_CONFIG: ToolMemoStoreConfig = {
  enabled: true,
  ttlMs: 15 * 60_000,
  maxEntries: 250,
  maxResultJsonChars: 200_000,
};

function safeJsonStringify(value: unknown): { ok: true; json: string } | { ok: false } {
  try {
    return { ok: true, json: JSON.stringify(value) };
  } catch {
    return { ok: false };
  }
}

export function buildToolMemoScopeKey(toolName: string, ctx: ToolExecutionContext): string {
  const normalizedTool = toolName.trim().toLowerCase();
  const guildId = (ctx.guildId ?? 'dm').trim();
  const profile = (ctx.toolExecutionProfile ?? 'default').trim();

  if (normalizedTool === 'discord') {
    return `discord::${guildId}::${ctx.channelId.trim()}::${ctx.userId.trim()}::${profile}`;
  }

  if (normalizedTool === 'web' || normalizedTool === 'github') {
    return `${normalizedTool}::${guildId}::${profile}`;
  }

  return `${normalizedTool}::${guildId}::${profile}`;
}

export class ToolMemoStore {
  private config: ToolMemoStoreConfig;
  private readonly entries = new Map<string, ToolMemoEntry>();

  constructor(config?: Partial<ToolMemoStoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  configure(config?: Partial<ToolMemoStoreConfig>): void {
    const next: ToolMemoStoreConfig = {
      enabled: config?.enabled ?? this.config.enabled,
      ttlMs: normalizeBoundedInt(config?.ttlMs, this.config.ttlMs, 1_000, 6 * 60 * 60_000),
      maxEntries: normalizeBoundedInt(config?.maxEntries, this.config.maxEntries, 1, 5_000),
      maxResultJsonChars: normalizeBoundedInt(
        config?.maxResultJsonChars,
        this.config.maxResultJsonChars,
        1_000,
        2_000_000,
      ),
    };
    this.config = next;
    this.pruneExpired();
    this.pruneToMaxEntries();
  }

  clear(): void {
    this.entries.clear();
  }

  stats(nowMs = Date.now()): ToolMemoStoreStats {
    this.pruneExpired(nowMs);
    const entryCount = this.entries.size;
    let oldestEntryAgeMs: number | null = null;
    let newestEntryAgeMs: number | null = null;
    for (const entry of this.entries.values()) {
      const ageMs = Math.max(0, nowMs - entry.createdAtMs);
      oldestEntryAgeMs = oldestEntryAgeMs === null ? ageMs : Math.max(oldestEntryAgeMs, ageMs);
      newestEntryAgeMs = newestEntryAgeMs === null ? ageMs : Math.min(newestEntryAgeMs, ageMs);
    }

    return {
      enabled: this.config.enabled,
      ttlMs: this.config.ttlMs,
      maxEntries: this.config.maxEntries,
      maxResultJsonChars: this.config.maxResultJsonChars,
      entryCount,
      oldestEntryAgeMs,
      newestEntryAgeMs,
    };
  }

  private pruneExpired(nowMs = Date.now()): void {
    if (!this.config.enabled) return;
    for (const [key, entry] of this.entries.entries()) {
      if (nowMs - entry.createdAtMs > this.config.ttlMs) {
        this.entries.delete(key);
      }
    }
  }

  private pruneToMaxEntries(): void {
    if (!this.config.enabled) return;
    while (this.entries.size > this.config.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  get(scopeKey: string, toolName: string, args: unknown): ToolMemoEntry | null {
    if (!this.config.enabled) return null;
    this.pruneExpired();
    const cacheKey = `${scopeKey}::${buildToolCacheKey(toolName, args)}`;
    const entry = this.entries.get(cacheKey);
    if (!entry) return null;

    // LRU bump: delete + re-set to update insertion order.
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return entry;
  }

  set(scopeKey: string, toolName: string, args: unknown, result: unknown): ToolMemoEntry | null {
    if (!this.config.enabled) return null;
    this.pruneExpired();

    const serialized = safeJsonStringify(result);
    if (!serialized.ok) return null;
    const resultJsonChars = serialized.json.length;
    if (resultJsonChars > this.config.maxResultJsonChars) {
      return null;
    }

    const cacheKey = `${scopeKey}::${buildToolCacheKey(toolName, args)}`;
    const entry: ToolMemoEntry = {
      key: cacheKey,
      scopeKey,
      toolName,
      createdAtMs: Date.now(),
      result,
      resultJsonChars,
    };

    this.entries.set(cacheKey, entry);
    this.pruneToMaxEntries();
    return entry;
  }
}

export const globalToolMemoStore = new ToolMemoStore();

export function __resetToolMemoStoreForTests(): void {
  globalToolMemoStore.clear();
  globalToolMemoStore.configure(DEFAULT_CONFIG);
}

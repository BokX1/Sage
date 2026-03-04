import { randomUUID } from 'node:crypto';
import { normalizeBoundedInt } from '../utils/numbers';

export interface PagedTextStoreConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  maxTextChars: number;
}

export interface PagedTextEntry {
  id: string;
  scopeKey: string;
  createdAtMs: number;
  text: string;
  meta?: Record<string, unknown>;
}

export interface PagedTextStoreStats {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  maxTextChars: number;
  entryCount: number;
  totalTextChars: number;
  oldestEntryAgeMs: number | null;
  newestEntryAgeMs: number | null;
}

const DEFAULT_CONFIG: PagedTextStoreConfig = {
  enabled: true,
  ttlMs: 15 * 60_000,
  maxEntries: 200,
  maxTextChars: 60_000,
};

export class PagedTextStore {
  private config: PagedTextStoreConfig;
  private readonly entries = new Map<string, PagedTextEntry>();

  constructor(config?: Partial<PagedTextStoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  configure(config?: Partial<PagedTextStoreConfig>): void {
    const next: PagedTextStoreConfig = {
      enabled: config?.enabled ?? this.config.enabled,
      ttlMs: normalizeBoundedInt(config?.ttlMs, this.config.ttlMs, 1_000, 6 * 60 * 60_000),
      maxEntries: normalizeBoundedInt(config?.maxEntries, this.config.maxEntries, 1, 5_000),
      maxTextChars: normalizeBoundedInt(config?.maxTextChars, this.config.maxTextChars, 1_000, 500_000),
    };
    this.config = next;
    this.pruneExpired();
    this.pruneToMaxEntries();
  }

  clear(): void {
    this.entries.clear();
  }

  stats(nowMs = Date.now()): PagedTextStoreStats {
    this.pruneExpired(nowMs);
    const entryCount = this.entries.size;
    let totalTextChars = 0;
    let oldestEntryAgeMs: number | null = null;
    let newestEntryAgeMs: number | null = null;
    for (const entry of this.entries.values()) {
      totalTextChars += entry.text.length;
      const ageMs = Math.max(0, nowMs - entry.createdAtMs);
      oldestEntryAgeMs = oldestEntryAgeMs === null ? ageMs : Math.max(oldestEntryAgeMs, ageMs);
      newestEntryAgeMs = newestEntryAgeMs === null ? ageMs : Math.min(newestEntryAgeMs, ageMs);
    }

    return {
      enabled: this.config.enabled,
      ttlMs: this.config.ttlMs,
      maxEntries: this.config.maxEntries,
      maxTextChars: this.config.maxTextChars,
      entryCount,
      totalTextChars,
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

  get(id: string, scopeKey: string): PagedTextEntry | null {
    if (!this.config.enabled) return null;
    this.pruneExpired();
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.scopeKey !== scopeKey) return null;

    // LRU bump: delete + re-set to update insertion order.
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  create(scopeKey: string, text: string, meta?: Record<string, unknown>): PagedTextEntry | null {
    if (!this.config.enabled) return null;
    this.pruneExpired();

    if (text.length > this.config.maxTextChars) {
      return null;
    }

    const id = randomUUID();
    const entry: PagedTextEntry = {
      id,
      scopeKey,
      createdAtMs: Date.now(),
      text,
      meta,
    };

    this.entries.set(id, entry);
    this.pruneToMaxEntries();
    return entry;
  }
}

export const globalPagedTextStore = new PagedTextStore();

export function __resetPagedTextStoreForTests(): void {
  globalPagedTextStore.clear();
  globalPagedTextStore.configure(DEFAULT_CONFIG);
}

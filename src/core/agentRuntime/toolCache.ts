export interface ToolCacheEntry {
  key: string;
  name: string;
  result: unknown;
  createdAt: number;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

export function buildToolCacheKey(name: string, args: unknown): string {
  return `${name}::${stableStringify(args)}`;
}

export class ToolResultCache {
  private readonly maxEntries: number;
  private readonly entries: Map<string, ToolCacheEntry>;

  constructor(maxEntries = 50) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.entries = new Map();
  }

  get(name: string, args: unknown): ToolCacheEntry | null {
    const key = buildToolCacheKey(name, args);
    return this.entries.get(key) ?? null;
  }

  set(name: string, args: unknown, result: unknown): ToolCacheEntry {
    const key = buildToolCacheKey(name, args);
    const entry: ToolCacheEntry = {
      key,
      name,
      result,
      createdAt: Date.now(),
    };

    this.entries.set(key, entry);

    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    return entry;
  }
}

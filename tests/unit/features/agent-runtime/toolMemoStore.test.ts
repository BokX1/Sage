import { describe, expect, it } from 'vitest';
import { ToolMemoStore } from '../../../../src/features/agent-runtime/toolMemoStore';

describe('toolMemoStore', () => {
  it('supports per-entry ttl overrides', () => {
    const store = new ToolMemoStore({
      enabled: true,
      ttlMs: 60_000,
      maxEntries: 10,
      maxResultJsonChars: 10_000,
    });

    const entry = store.set('web_search::guild-1', 'web_search', { query: 'latest docs' }, { ok: true }, { ttlMs: 2_000 });
    expect(entry).not.toBeNull();
    if (!entry) {
      throw new Error('Expected memo entry');
    }

    expect(store.get('web_search::guild-1', 'web_search', { query: 'latest docs' })?.result).toEqual({ ok: true });

    const originalDateNow = Date.now;
    Date.now = () => entry.expiresAtMs + 1;

    try {
      expect(store.get('web_search::guild-1', 'web_search', { query: 'latest docs' })).toBeNull();
    } finally {
      Date.now = originalDateNow;
    }
  });
});

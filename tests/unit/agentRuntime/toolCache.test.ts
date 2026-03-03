import { describe, expect, it } from 'vitest';
import { ToolResultCache, buildToolCacheKey } from '../../../src/core/agentRuntime/toolCache';

describe('toolCache', () => {
  it('builds stable keys for object args regardless of key order', () => {
    const a = buildToolCacheKey('sum', { b: 2, a: 1 });
    const b = buildToolCacheKey('sum', { a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('ignores think fields when building keys', () => {
    const a = buildToolCacheKey('web_search', {
      query: 'release notes',
      think: 'plan A',
      nested: { think: 'plan B', page: 1 },
    });
    const b = buildToolCacheKey('web_search', {
      query: 'release notes',
      think: 'plan C',
      nested: { think: 'plan D', page: 1 },
    });
    expect(a).toBe(b);
  });

  it('stores and retrieves cached results', () => {
    const cache = new ToolResultCache(3);
    cache.set('get_time', {}, { time: '12:00 PM' });
    const hit = cache.get('get_time', {});
    expect(hit?.result).toEqual({ time: '12:00 PM' });
  });

  it('evicts oldest entries when max size is reached', () => {
    const cache = new ToolResultCache(2);
    cache.set('a', {}, 1);
    cache.set('b', {}, 2);
    cache.set('c', {}, 3);

    expect(cache.get('a', {})).toBeNull();
    expect(cache.get('b', {})?.result).toBe(2);
    expect(cache.get('c', {})?.result).toBe(3);
  });

  it('expires entries older than the configured TTL', () => {
    const ttlMs = 5_000;
    const cache = new ToolResultCache(10, ttlMs);
    const now = Date.now();

    // Manually inject an entry with a past createdAt
    cache.set('get_time', {}, { time: '12:00 PM' });

    // Immediately available
    expect(cache.get('get_time', {})?.result).toEqual({ time: '12:00 PM' });

    // Stub Date.now to simulate time passing beyond TTL
    const originalDateNow = Date.now;
    Date.now = () => now + ttlMs + 1;

    try {
      expect(cache.get('get_time', {})).toBeNull();
    } finally {
      Date.now = originalDateNow;
    }
  });
});

import { describe, expect, it } from 'vitest';
import { ToolResultCache, buildToolCacheKey } from '../../../src/core/agentRuntime/toolCache';

describe('toolCache', () => {
  it('builds stable keys for object args regardless of key order', () => {
    const a = buildToolCacheKey('sum', { b: 2, a: 1 });
    const b = buildToolCacheKey('sum', { a: 1, b: 2 });
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
});

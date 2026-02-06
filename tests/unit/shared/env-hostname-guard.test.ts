import { describe, expect, it } from 'vitest';
import { isPrivateOrLocalHostname } from '../../../src/shared/config/env';

describe('isPrivateOrLocalHostname', () => {
  it('rejects IPv4 loopback range beyond 127.0.0.1', () => {
    expect(isPrivateOrLocalHostname('127.0.1.1')).toBe(true);
  });

  it('rejects bracketed IPv6 loopback form', () => {
    expect(isPrivateOrLocalHostname('[::1]')).toBe(true);
  });

  it('rejects IPv6-mapped IPv4 loopback form', () => {
    expect(isPrivateOrLocalHostname('::ffff:127.0.0.1')).toBe(true);
  });

  it('allows public hosts', () => {
    expect(isPrivateOrLocalHostname('gen.pollinations.ai')).toBe(false);
  });
});

/**
 * @module tests/unit/shared/env-hostname-guard.test
 * @description Defines the env hostname guard.test module.
 */
import { describe, expect, it } from 'vitest';
import { isPrivateOrLocalHostname } from '../../../src/shared/config/env';

describe('isPrivateOrLocalHostname', () => {
  it('rejects IPv4 loopback range beyond 127.0.0.1', () => {
    expect(isPrivateOrLocalHostname('127.0.1.1')).toBe(true);
  });

  it('rejects IPv4 link-local ranges (e.g. cloud metadata)', () => {
    expect(isPrivateOrLocalHostname('169.254.169.254')).toBe(true);
  });

  it('rejects IPv4 CGNAT ranges', () => {
    expect(isPrivateOrLocalHostname('100.64.0.1')).toBe(true);
  });

  it('rejects IPv4 documentation ranges', () => {
    expect(isPrivateOrLocalHostname('192.0.2.1')).toBe(true);
  });

  it('rejects bracketed IPv6 loopback form', () => {
    expect(isPrivateOrLocalHostname('[::1]')).toBe(true);
  });

  it('rejects IPv6-mapped IPv4 loopback form', () => {
    expect(isPrivateOrLocalHostname('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects IPv6 unique-local and link-local ranges', () => {
    expect(isPrivateOrLocalHostname('fd00::1')).toBe(true);
    expect(isPrivateOrLocalHostname('fe80::1')).toBe(true);
  });

  it('rejects IPv6 documentation ranges', () => {
    expect(isPrivateOrLocalHostname('2001:db8::1')).toBe(true);
  });

  it('allows public hosts', () => {
    expect(isPrivateOrLocalHostname('gen.pollinations.ai')).toBe(false);
  });

  it('allows public IPs', () => {
    expect(isPrivateOrLocalHostname('8.8.8.8')).toBe(false);
    expect(isPrivateOrLocalHostname('2606:4700:4700::1111')).toBe(false);
  });
});

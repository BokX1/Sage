import { describe, expect, it } from 'vitest';
import { isPrivateOrLocalHostname } from '../../../../src/platform/config/env';

describe('isPrivateOrLocalHostname', () => {
  it('rejects IPv4 loopback range beyond 127.0.0.1', () => {
    expect({
      loopback: isPrivateOrLocalHostname('127.0.1.1'),
      publicHost: isPrivateOrLocalHostname('8.8.8.8'),
    }).toEqual({
      loopback: true,
      publicHost: false,
    });
  });

  it('rejects IPv4 link-local ranges (e.g. cloud metadata)', () => {
    expect({
      linkLocal: isPrivateOrLocalHostname('169.254.169.254'),
      publicHost: isPrivateOrLocalHostname('8.8.8.8'),
    }).toEqual({
      linkLocal: true,
      publicHost: false,
    });
  });

  it('rejects IPv4 CGNAT ranges', () => {
    expect({
      carrierGradeNat: isPrivateOrLocalHostname('100.64.0.1'),
      publicHost: isPrivateOrLocalHostname('1.1.1.1'),
    }).toEqual({
      carrierGradeNat: true,
      publicHost: false,
    });
  });

  it('rejects IPv4 documentation ranges', () => {
    expect({
      documentationRange: isPrivateOrLocalHostname('192.0.2.1'),
      publicHost: isPrivateOrLocalHostname('9.9.9.9'),
    }).toEqual({
      documentationRange: true,
      publicHost: false,
    });
  });

  it('rejects bracketed IPv6 loopback form', () => {
    expect({
      loopback: isPrivateOrLocalHostname('[::1]'),
      publicHost: isPrivateOrLocalHostname('2606:4700:4700::1111'),
    }).toEqual({
      loopback: true,
      publicHost: false,
    });
  });

  it('rejects IPv6-mapped IPv4 loopback form', () => {
    expect({
      mappedLoopback: isPrivateOrLocalHostname('::ffff:127.0.0.1'),
      publicHost: isPrivateOrLocalHostname('2606:4700:4700::1111'),
    }).toEqual({
      mappedLoopback: true,
      publicHost: false,
    });
  });

  it('rejects IPv6 unique-local and link-local ranges', () => {
    expect({
      uniqueLocal: isPrivateOrLocalHostname('fd00::1'),
      linkLocal: isPrivateOrLocalHostname('fe80::1'),
      publicHost: isPrivateOrLocalHostname('2606:4700:4700::1111'),
    }).toEqual({
      uniqueLocal: true,
      linkLocal: true,
      publicHost: false,
    });
  });

  it('rejects IPv6 documentation ranges', () => {
    expect({
      documentationRange: isPrivateOrLocalHostname('2001:db8::1'),
      publicHost: isPrivateOrLocalHostname('2606:4700:4700::1111'),
    }).toEqual({
      documentationRange: true,
      publicHost: false,
    });
  });

  it('allows public hosts', () => {
    expect({
      publicHost: isPrivateOrLocalHostname('gen.pollinations.ai'),
      loopback: isPrivateOrLocalHostname('127.0.0.1'),
    }).toEqual({
      publicHost: false,
      loopback: true,
    });
  });

  it('allows public IPs', () => {
    expect({
      ipv4Public: isPrivateOrLocalHostname('8.8.8.8'),
      ipv6Public: isPrivateOrLocalHostname('2606:4700:4700::1111'),
      loopback: isPrivateOrLocalHostname('::1'),
    }).toEqual({
      ipv4Public: false,
      ipv6Public: false,
      loopback: true,
    });
  });
});
